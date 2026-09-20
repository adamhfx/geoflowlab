"""Durable PostgreSQL queue worker.

The worker never trusts a completed child process by itself: publication is
fenced by the current, unexpired lease token in the same transaction.
"""
from __future__ import annotations

import hashlib, json, os, secrets, subprocess, sys, tempfile, time
from pathlib import Path
from typing import Any

import psycopg
import requests

ROOT = Path(__file__).resolve().parents[1]
# Covers fifteen isolated recalculations, storage I/O, and publication.
LEASE_SECONDS = 2100
MAX_RUNTIME_SECONDS = 1800
MAX_ATTEMPTS = 2

class JobError(Exception):
    pass

def _db_url() -> str:
    return os.environ.get("DATABASE_URL") or os.environ["SUPABASE_DB_URL"]

def connect():
    return psycopg.connect(_db_url(), autocommit=False)

def requeue_expired(conn) -> None:
    """Recover leases, never allowing a job to be attempted more than twice."""
    conn.execute("""
      update jobs set state='queued', worker_id=null, lease_token=null,
             lease_until=null, available_at=now()
       where state='running' and lease_until < now() and attempts < %s
    """, (MAX_ATTEMPTS,))
    conn.execute("""
      update jobs set state='failed', worker_id=null, lease_token=null, lease_until=null
       where state='running' and lease_until < now() and attempts >= %s
    """, (MAX_ATTEMPTS,))
    conn.execute("""
      update runs r set status='failed', error_code='LEASE_EXPIRED', finished_at=now()
       from jobs j where j.run_id=r.id and j.state='failed' and r.status <> 'succeeded'
    """)

def claim(conn, worker_id: str) -> dict[str, Any] | None:
    """Claim one queued/expired row using SKIP LOCKED and a fresh UUID token."""
    with conn.transaction():
        requeue_expired(conn)
        row = conn.execute("""
          with candidate as (
            select id from jobs
             where state='queued' and available_at <= now()
             order by created_at, id for update skip locked limit 1
          )
          update jobs j set state='running', attempts=j.attempts+1,
             worker_id=%s, lease_token=gen_random_uuid(),
             lease_until=now() + make_interval(secs => %s)
            from candidate c where j.id=c.id
          returning j.id, j.run_id, j.lease_token, j.lease_until
        """, (worker_id, LEASE_SECONDS)).fetchone()
        if not row:
            return None
        job_id, run_id, token, lease_until = row
        rec = conn.execute("""
          select r.id,r.user_id,r.calculator_id,r.calculator_version,r.inputs,
                 cv.manifest,cv.template_path,cv.template_sha256,cv.approved
            from runs r join calculator_versions cv
              on cv.calculator_id=r.calculator_id and cv.version=r.calculator_version
           where r.id=%s for update
        """, (run_id,)).fetchone()
        if not rec or not rec[-1]:
            conn.execute("update jobs set state='failed' where id=%s", (job_id,))
            conn.execute("update runs set status='failed',error_code='MODEL_REVIEW_REQUIRED',finished_at=now() where id=%s and status <> 'succeeded'", (run_id,))
            return None
        conn.execute("update runs set status='running',started_at=coalesce(started_at,now()) where id=%s and status='queued'", (run_id,))
        return dict(zip(('job_id','run_id','lease_token','lease_until','user_id','calculator_id','calculator_version','inputs','manifest','template_path','template_sha256'), (job_id,run_id,token,lease_until,*rec[1:-1])))

def _storage_headers() -> dict[str,str]:
    key=os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    # New sb_secret_* keys are API keys, not JWTs. Sending them as Bearer
    # credentials causes Supabase to reject otherwise valid storage requests.
    if key.startswith("sb_secret_"):
        return {"apikey": key}
    return {"Authorization": f"Bearer {key}", "apikey": key}

def storage_download(bucket: str, path: str, target: Path) -> None:
    base=os.environ["SUPABASE_URL"].rstrip('/')
    url=f"{base}/storage/v1/object/authenticated/{bucket}/{path.lstrip('/')}"
    with requests.get(url,headers=_storage_headers(),stream=True,timeout=60) as response:
        response.raise_for_status()
        with target.open('wb') as out:
            for chunk in response.iter_content(1024*1024):
                if chunk: out.write(chunk)

def storage_upload(bucket: str, path: str, source: Path) -> None:
    base=os.environ["SUPABASE_URL"].rstrip('/')
    url=f"{base}/storage/v1/object/{bucket}/{path.lstrip('/')}"
    with source.open('rb') as stream:
        response=requests.post(url,headers={**_storage_headers(),"Content-Type":"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet","x-upsert":"false"},data=stream,timeout=60)
    response.raise_for_status()

def _child(job: dict[str,Any], template: Path, out: Path, scratch: Path) -> dict[str,Any]:
    manifest=scratch/'manifest.json'; inputs=scratch/'inputs.json'
    manifest.write_text(json.dumps(job['manifest']),encoding='utf-8')
    inputs.write_text(json.dumps(job['inputs']),encoding='utf-8')
    env={k:v for k,v in os.environ.items() if k in {'PATH','SOFFICE_BIN','LANG','LC_ALL'}}
    env.update({'PYTHONUNBUFFERED':'1','TMPDIR':str(scratch),'TEMP':str(scratch),'TMP':str(scratch)})
    command=[sys.executable,'-m','worker.engine','--manifest',str(manifest),'--template',str(template),'--inputs',str(inputs),'--output',str(out)]
    started=time.monotonic()
    try:
        result=subprocess.run(command,cwd=str(ROOT),env=env,stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,timeout=MAX_RUNTIME_SECONDS)
    except subprocess.TimeoutExpired as exc:
        raise JobError('ENGINE_TIMEOUT') from exc
    if result.returncode != 0 or not out.exists(): raise JobError('ENGINE_FAILED')
    if time.monotonic()-started > MAX_RUNTIME_SECONDS: raise JobError('ENGINE_TIMEOUT')
    return json.loads(out.with_suffix('.json').read_text(encoding='utf-8'))

def _fenced(conn, job, status: str, *, error: str|None=None, export_path: str|None=None, result: dict|None=None) -> bool:
    """Publish only while the exact lease remains ours and unexpired."""
    params=[status,error,export_path,json.dumps(result) if result is not None else None,job['run_id'],job['job_id'],job['lease_token']]
    with conn.transaction():
        # Reclaimers and publishers take the jobs row lock first. This closes
        # the READ COMMITTED race where a lease could be reclaimed between a
        # predicate check and the run update.
        lease=conn.execute("select state,lease_token,lease_until from jobs where id=%s for update", (job['job_id'],)).fetchone()
        if not lease or lease[0] != 'running' or lease[1] != job['lease_token'] or lease[2] is None:
            return False
        cur=conn.execute("""
          update runs r set status=%s,error_code=%s,export_path=%s,result=%s,finished_at=now()
           where r.id=%s and r.status='running' and exists (
             select 1 from jobs j where j.id=%s and j.run_id=r.id and j.state='running'
               and j.lease_token=%s and j.lease_until > now())
        """,params)
        if cur.rowcount != 1: return False
        conn.execute("update jobs set state=%s,worker_id=null,lease_token=null,lease_until=null where id=%s and lease_token=%s", ('done' if status=='succeeded' else 'failed',job['job_id'],job['lease_token']))
    return True

def process_one(conn, worker_id: str) -> bool:
    job=claim(conn,worker_id)
    if not job: conn.commit(); return False
    started=time.monotonic()
    print(json.dumps({'event':'calculation_started','run_id':str(job['run_id'])}),flush=True)
    try:
        with tempfile.TemporaryDirectory(prefix='modeldesk-worker-') as temp:
            scratch=Path(temp); template=scratch/'template.xlsx'; output=scratch/'result.xlsx'
            storage_download('model-templates',job['template_path'],template)
            expected=job['template_sha256']
            if hashlib.sha256(template.read_bytes()).hexdigest() != expected or expected != job['manifest'].get('runtimeSha256'):
                raise JobError('MODEL_CHECKSUM_MISMATCH')
            result=_child(job,template,output,scratch)
            export_path=f"{job['user_id']}/{job['run_id']}/{job['lease_token']}.xlsx"
            storage_upload('calculation-exports',export_path,output)
            if not _fenced(conn,job,'succeeded',export_path=export_path,result=result):
                print(json.dumps({'event':'calculation_lease_lost','run_id':str(job['run_id'])}),flush=True)
                return False
            print(json.dumps({'event':'calculation_succeeded','run_id':str(job['run_id']),'duration_seconds':round(time.monotonic()-started,3)}),flush=True)
    except (JobError,requests.RequestException,Exception) as exc:
        code=exc.args[0] if isinstance(exc,JobError) and exc.args else 'WORKER_FAILED'
        _fenced(conn,job,'failed',error=str(code)[:80])
        print(json.dumps({'event':'calculation_failed','run_id':str(job['run_id']),'code':str(code)[:80],'duration_seconds':round(time.monotonic()-started,3)}),flush=True)
    return True

def main() -> None:
    worker_id=f"worker-{secrets.token_hex(8)}"
    backoff=1.0
    while True:
        try:
            with connect() as conn:
                if not process_one(conn,worker_id):
                    time.sleep(float(os.environ.get('POLL_SECONDS','2')))
            backoff=1.0
        except Exception:
            # Keep the worker alive across transient DB/network failures and
            # emit no inputs, formulas, credentials, or provider error text.
            print(json.dumps({'event':'worker_connection_failure','retry_seconds':backoff}),flush=True)
            time.sleep(backoff)
            backoff=min(backoff*2, 30.0)

if __name__=='__main__': main()
