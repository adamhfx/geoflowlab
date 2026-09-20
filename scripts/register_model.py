"""Owner-only registration: private template upload + immutable candidate record.

Requires DATABASE_URL, SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY. Never approves
a release; approval is a separate recorded owner action after the parity report.
"""
from pathlib import Path
import argparse,hashlib,json,os,sys
import requests,psycopg
from psycopg.types.json import Jsonb

root=Path(__file__).resolve().parents[1]
p=argparse.ArgumentParser();p.add_argument('--manifest',type=Path,default=root/'models/state-rent/1.0.0-candidate.1.json');p.add_argument('--template',type=Path,default=root/'private/models/state-rent/1.0.0-candidate.1.xlsx');a=p.parse_args()
m=json.loads(a.manifest.read_text());data=a.template.read_bytes();sha=hashlib.sha256(data).hexdigest()
if sha!=m['runtimeSha256']:sys.exit('Model checksum mismatch.')
path=f"{m['id']}/{m['version']}/{sha}.xlsx"
key=os.environ['SUPABASE_SERVICE_ROLE_KEY'];url=os.environ['SUPABASE_URL'].rstrip('/')
headers={'apikey':key,'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','x-upsert':'false'}
if not key.startswith('sb_secret_'):headers['Authorization']='Bearer '+key
response=requests.post(url+'/storage/v1/object/model-templates/'+path,data=data,headers=headers,timeout=60)
if response.status_code not in (200,201,409):sys.exit('Private model upload failed; verify configuration.')
with psycopg.connect(os.environ['DATABASE_URL']) as db:
 with db.cursor() as c:
  c.execute('insert into public.calculators(id,name,description,current_version) values(%s,%s,%s,%s) on conflict(id) do nothing',(m['id'],m['name'],m['description'],m['version']))
  c.execute('select template_sha256 from public.calculator_versions where calculator_id=%s and version=%s',(m['id'],m['version']));existing=c.fetchone()
  if existing and existing[0]!=sha:raise ValueError('Version already exists with a different checksum')
  c.execute('insert into public.calculator_versions(calculator_id,version,manifest,template_path,template_sha256,approved) values(%s,%s,%s,%s,%s,false) on conflict(calculator_id,version) do nothing',(m['id'],m['version'],Jsonb(m),path,sha))
print('Private model registered as a review candidate. Customer execution remains disabled.')
