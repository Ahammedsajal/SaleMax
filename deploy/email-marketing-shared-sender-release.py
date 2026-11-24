#!/usr/bin/env python3
"""Guarded app-only release for explicitly shared SES sender identities."""
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import time
from datetime import datetime, timezone

ROOT=Path('/opt/salemax'); APP='salemax-app-1'; DB='salemax-db-1'
BASE='/opt/salemax/releases/training-pipeline-correction-v3-9867ca72-20261104'
IMAGE='salemax-app:email-marketing-21a07cc41fa9-20261112'
IMAGE_ID='sha256:753d77d421b3160872df0812e7b38505a1db7104cdb9d6c8b17415b2420de667'
MIGRATION='database/migrations/20270213_email_sender_domain_shares.sql'
VERSION='20261124-email-domain-share1'
FILES=('modules/platform/email-marketing.js','modules/platform/email-marketing-router.js',
       'modules/platform/email-marketing-worker.js','modules/platform/email-marketing-inbox.js',
       'client/public/email-marketing-workspace.js',MIGRATION)
PREIMAGE={
 'modules/platform/email-marketing.js':'fac470911b3ae6d19c10a14952ced7d690dbabc275ffdb94370e3a7cddeb4458',
 'modules/platform/email-marketing-router.js':'52c1b518a0496dac2caae39fa8d5803cde6a75fb8726e77b5825849cc604ddbb',
 'modules/platform/email-marketing-worker.js':'a697ff8cf7c675c631d716dc0368b85bfae58a5de27f85e15fc96420388209a7',
 'modules/platform/email-marketing-inbox.js':'c64ba55bcc10785ce4188d4e0b273748e771fb7fc5dd998c43e9b93e7f3905ef',
 'client/public/email-marketing-workspace.js':'8d0e2760a6b0ad31f908f5908aba3e841695c7ddf05d5f8c1f059fdae96dd326',
}

def run(*args,env=None,input_text=None,timeout=900):
 r=subprocess.run(args,env=env,input=input_text,capture_output=True,text=True,timeout=timeout)
 if r.returncode: raise RuntimeError(Path(args[0]).name+' failed')
 return r.stdout
def sha(data): return hashlib.sha256(data).hexdigest()
def write_private(path,value):
 p=Path(path);p.parent.mkdir(mode=0o700,parents=True,exist_ok=True);p.write_text(value if isinstance(value,str) else json.dumps(value,indent=2)+'\n');p.chmod(0o600)
def inspect(name): return json.loads(run('docker','inspect',name))[0]
def compose_context(app):
 labels=app.get('Config',{}).get('Labels') or {};files=labels.get('com.docker.compose.project.config_files','').split(',');envs=labels.get('com.docker.compose.project.environment_file','').split(',');workdir=labels.get('com.docker.compose.project.working_dir')
 if labels.get('com.docker.compose.project')!='salemax' or labels.get('com.docker.compose.service')!='app' or not workdir or not all(Path(p).is_file() for p in files+envs): raise RuntimeError('Active Compose inputs changed or incomplete')
 return files,envs,workdir
def compose_args(files,envs,workdir):
 a=['docker','compose','--project-name','salemax','--project-directory',workdir]
 for p in envs:a+=['--env-file',p]
 for p in files:a+=['-f',p]
 return a
def input_env(app,files,envs):
 refs=set();supplied=set()
 for p in files: refs.update(re.findall(r'\$\{([A-Za-z_][A-Za-z0-9_]*)',Path(p).read_text()))
 for p in envs: supplied.update(re.findall(r'^\s*([A-Za-z_][A-Za-z0-9_]*)=',Path(p).read_text(),re.M))
 live=dict(x.split('=',1) for x in app['Config'].get('Env',[]) if '=' in x)
 manual_path=ROOT/'shared/rollback-private-inventory-84644fdfebee/compose-manual-vars.json'
 manual=json.loads(manual_path.read_text()) if manual_path.is_file() else {}
 vals={k:(manual[k] if k in manual else live[k]) for k in refs-supplied if k in manual or k in live}
 if set(vals)!=refs-supplied: raise RuntimeError('Compose inputs cannot be resolved safely')
 env=dict(os.environ)
 for k in refs:env.pop(k,None)
 env.update(vals);return env
def inventory(): return {n:inspect(n)['Id'] for n in run('docker','ps','-a','--filter','label=com.docker.compose.project=salemax','--format','{{.Names}}').splitlines()}
def require_lock():
 if os.geteuid()!=0 or os.environ.get('SALEMAX_DEPLOY_LOCK_HELD')!='1' or run('hostname').strip()!='carsqatar-prod-01' or os.path.realpath(ROOT/'current')!=BASE: raise RuntimeError('Protected production lock or active release check failed')
def stage(source,stage_path,commit):
 source=Path(source).resolve();stage=Path(stage_path).absolute()
 if stage.exists() or stage.is_symlink() or not re.fullmatch('[a-f0-9]{40}',commit):raise RuntimeError('Invalid stage path or source commit')
 if run('git','-C',str(source),'rev-parse','HEAD').strip()!=commit:raise RuntimeError('Checkout does not match commit')
 stage.mkdir(mode=0o700,parents=True);manifest={'sourceCommit':commit,'files':{}}
 try:
  for name in (*FILES,'deploy/email-marketing-shared-sender-release.py'):
   data=subprocess.check_output(['git','-C',str(source),'show',f'{commit}:{name}']);p=stage/'source'/name;p.parent.mkdir(mode=0o700,parents=True,exist_ok=True);p.write_bytes(data);p.chmod(0o600);manifest['files'][name]=sha(data)
  write_private(stage/'manifest.json',manifest)
 except Exception:shutil.rmtree(stage,ignore_errors=True);raise
 print(json.dumps({'stage':str(stage),'commit':commit,'files':manifest['files']}))
def validate_stage(stage,commit):
 stage=Path(stage).resolve();m=json.loads((stage/'manifest.json').read_text());expected=set((*FILES,'deploy/email-marketing-shared-sender-release.py'))
 if stage.is_symlink() or m.get('sourceCommit')!=commit or set(m.get('files',{}))!=expected:raise RuntimeError('Stage manifest mismatch')
 for n,digest in m['files'].items():
  p=stage/'source'/n
  if p.is_symlink() or not p.is_file() or sha(p.read_bytes())!=digest:raise RuntimeError('Staged source hash mismatch')
 return stage,m
def apply_migration(sql):
 script="""let s='';process.stdin.on('data',x=>s+=x);process.stdin.on('end',async()=>{let c;try{const x=JSON.parse(s),r=require('/app/database/migration-runner'),mysql=require('mysql2/promise'),crypto=require('node:crypto'),ms=r.discover('/app/database/migrations'),sum=crypto.createHash('sha256').update(x.sql).digest('hex');ms.push({file:x.file,checksum:sum,statements:r.splitSql(x.sql)});ms.sort((a,b)=>a.file.localeCompare(b.file));c=await mysql.createConnection({host:process.env.DBHOST,port:Number(process.env.DBPORT||3306),user:process.env.DBUSER,password:process.env.DBPASS,database:process.env.DBNAME,multipleStatements:false});const applied=await r.applyMigrations(c,ms,{only:x.file});const [rows]=await c.query('SELECT migration_name,checksum,status,statement_count,statements_completed FROM salemax_schema_migrations WHERE migration_name=?',[x.file]);console.log(JSON.stringify({applied,row:rows[0]}));}catch(e){console.log(JSON.stringify({error:e.code||e.name||'MIGRATION_FAILED'}));process.exitCode=1}finally{await c?.end()}})"""
 out=run('docker','exec','-i',APP,'node','-e',script,input_text=json.dumps({'file':Path(MIGRATION).name,'sql':sql}));return json.loads(out.splitlines()[-1])
def deploy(stage,commit):
 require_lock();stage,manifest=validate_stage(stage,commit);app,db=inspect(APP),inspect(DB)
 if app['State'].get('Health',{}).get('Status')!='healthy' or app['Image']!=IMAGE_ID or app['Config'].get('Image')!=IMAGE or db['State'].get('Health',{}).get('Status')!='healthy':raise RuntimeError('App/database baseline differs')
 if os.statvfs(ROOT).f_bavail*os.statvfs(ROOT).f_frsize<4*1024**3:raise RuntimeError('Insufficient production free disk')
 files,envs,workdir=compose_context(app);env=input_env(app,files,envs);before=inventory()
 for n,digest in PREIMAGE.items():
  if sha(run('docker','exec',APP,'cat','/app/'+n).encode())!=digest:raise RuntimeError('Live Email Marketing file differs from reviewed baseline: '+n)
 source={n:(stage/'source'/n).read_bytes() for n in FILES};hashes={n:sha(v) for n,v in source.items()}
 old_index=run('docker','exec',APP,'cat','/app/client/public/index.html').encode();old_ref=b'email-marketing-workspace.js?v=20261122-email-bounce-privacy1';new_ref=('email-marketing-workspace.js?v='+VERSION).encode()
 if old_ref not in old_index:raise RuntimeError('Live workspace cache reference changed')
 source['client/public/index.html']=old_index.replace(old_ref,new_ref);hashes['client/public/index.html']=sha(source['client/public/index.html'])
 common=compose_args(files,envs,workdir);before_config=json.loads(run(*(common+['config','--format','json']),env=env));mounts_before={x['target']:x for x in before_config['services']['app'].get('volumes',[])}
 stamp=datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ');release=ROOT/'releases'/f'email-marketing-shared-sender-{commit[:12]}-{stamp}';backup=ROOT/'shared'/f'rollback-email-marketing-shared-sender-{commit[:12]}-{stamp}'
 if release.exists() or backup.exists():raise RuntimeError('Release or rollback directory already exists')
 os.umask(0o077);release.mkdir(mode=0o755);backup.mkdir(mode=0o700);runtime=release/'runtime';runtime.mkdir(mode=0o755);pre=backup/'preimages';pre.mkdir(mode=0o700)
 for n in hashes:
  try:old=run('docker','exec',APP,'cat','/app/'+n).encode()
  except RuntimeError:old=b''
  if old:
   p=pre/n;p.parent.mkdir(mode=0o700,parents=True,exist_ok=True);p.write_bytes(old);p.chmod(0o600)
  p=runtime/n;p.parent.mkdir(mode=0o755,parents=True,exist_ok=True);p.write_bytes(source[n]);p.chmod(0o644)
 overlay=release/'compose.email-marketing-shared-sender.json';mounts=[{'type':'bind','source':str(runtime/n),'target':'/app/'+n,'read_only':True,'bind':{'create_host_path':False}} for n in hashes]
 overlay.write_text(json.dumps({'services':{'app':{'image':IMAGE,'volumes':mounts}},},indent=2)+'\n');overlay.chmod(0o644)
 for n,v in {'commit':commit,'files.json':json.dumps(hashes,indent=2),'compose-before.json':json.dumps(files,indent=2),'container-before.json':json.dumps({'app':app['Id'],'db':db['Id'],'image':app['Image']},indent=2),'support-services.json':json.dumps({k:v for k,v in before.items() if k!=APP},indent=2),'release.txt':str(release)}.items():write_private(backup/n,v)
 candidate=common+['-f',str(overlay)];after_config=json.loads(run(*(candidate+['config','--format','json']),env=env))
 if {k:v for k,v in after_config['services'].items() if k!='app'}!={k:v for k,v in before_config['services'].items() if k!='app'}:raise RuntimeError('Non-app service configuration changed')
 if after_config['services']['app'].get('image')!=IMAGE:raise RuntimeError('App image changed')
 migration=apply_migration(source[MIGRATION].decode())
 if migration.get('error') or migration.get('row',{}).get('status')!='applied':raise RuntimeError('Domain sharing migration failed')
 write_private(backup/'migration.json',migration)
 run(*(candidate+['up','-d','--no-deps','--no-build','--force-recreate','app']),env=env)
 current=None
 for _ in range(60):
  current=inspect(APP)
  if current['State'].get('Health',{}).get('Status')=='healthy':break
  time.sleep(2)
 if not current or current['State'].get('Health',{}).get('Status')!='healthy':raise RuntimeError('App failed health check')
 if {k:v for k,v in inventory().items() if k!=APP}!={k:v for k,v in before.items() if k!=APP}:raise RuntimeError('Non-app container changed')
 for n,digest in hashes.items():
  if run('docker','exec',APP,'sha256sum','/app/'+n).split()[0]!=digest:raise RuntimeError('Runtime hash mismatch')
 run('docker','exec',APP,'node','-e',"require('/app/modules/platform/email-marketing');require('/app/modules/platform/email-marketing-router');require('/app/modules/platform/email-marketing-worker');require('/app/modules/platform/email-marketing-inbox');console.log('email-modules-loaded')")
 schema="const mysql=require('mysql2/promise');(async()=>{const c=await mysql.createConnection({host:process.env.DBHOST,port:Number(process.env.DBPORT||3306),user:process.env.DBUSER,password:process.env.DBPASS,database:process.env.DBNAME});try{const [[t]]=await c.query(\"SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name='sx_email_sender_domain_shares'\");const [m]=await c.query('SELECT status,checksum,statement_count,statements_completed FROM salemax_schema_migrations WHERE migration_name=?',['20270213_email_sender_domain_shares.sql']);console.log(JSON.stringify({tables:t.n,migration:m[0]||null}));}finally{await c.end()}})().catch(e=>{console.error(e.code||'schema-check-failed');process.exitCode=1})"
 state=json.loads(run('docker','exec',APP,'node','-e',schema).splitlines()[-1]);
 if int(state['tables'])!=1 or state['migration'].get('status')!='applied' or state['migration'].get('checksum')!=hashes[MIGRATION] or state['migration'].get('statement_count')!=state['migration'].get('statements_completed'):raise RuntimeError('Domain sharing schema check failed')
 for url in ('https://7network.live/healthz','https://7network.live/user?page=campaign-dashboard&channel=email'):
  if run('curl','-fsS','-o','/dev/null','-w','%{http_code}',url).strip()!='200':raise RuntimeError('Public HTTP check failed')
 write_private(backup/'result.json',{'commit':commit,'release':str(release),'rollback':str(backup),'image':IMAGE,'imageId':current['Image'],'hashes':hashes,'migration':migration,'appHealthy':True,'dbHealthy':inspect(DB)['State'].get('Health',{}).get('Status')=='healthy','otherServicesUnchanged':True})
 print(json.dumps({'commit':commit,'release':str(release),'rollback':str(backup),'image':IMAGE,'imageId':current['Image'],'hashes':hashes,'migration':migration,'appHealthy':True,'otherServicesUnchanged':True}))
def main():
 if len(sys.argv)==5 and sys.argv[1]=='stage':stage(sys.argv[2],sys.argv[3],sys.argv[4])
 elif len(sys.argv)==4 and sys.argv[1]=='deploy':deploy(sys.argv[2],sys.argv[3])
 else:raise RuntimeError('Usage: stage <source-root> <stage-dir> <commit> | deploy <stage-dir> <commit>')
if __name__=='__main__':
 try:main()
 except Exception as e:print(json.dumps({'error':str(e)}));sys.exit(1)
