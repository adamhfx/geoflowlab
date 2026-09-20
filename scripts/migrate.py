"""Apply reviewed SQL migrations with an immutable checksum ledger."""
from pathlib import Path
import os,hashlib,psycopg
root=Path(__file__).resolve().parents[1]
with psycopg.connect(os.environ['DATABASE_URL'],autocommit=True) as db:
 db.execute('create schema if not exists geoflow_internal')
 db.execute('create table if not exists geoflow_internal.migrations(name text primary key,sha256 text not null,applied_at timestamptz not null default now())')
 for path in sorted((root/'supabase/migrations').glob('*.sql')):
  sql=path.read_text();sha=hashlib.sha256(sql.encode()).hexdigest();existing=db.execute('select sha256 from geoflow_internal.migrations where name=%s',(path.name,)).fetchone()
  if existing:
   if existing[0]!=sha:raise ValueError('Applied migration changed: '+path.name)
   continue
  with db.transaction():
   # Migration files contain their own transaction wrappers for SQL Editor use.
   body=sql.strip().removeprefix('begin;').removesuffix('commit;')
   db.execute(body)
   db.execute('insert into geoflow_internal.migrations(name,sha256) values(%s,%s)',(path.name,sha))
  print('Applied '+path.name)
