#!/usr/bin/env python3
"""Guarded app-only Email Marketing campaign removal release."""
import hashlib, json, os, re, shutil, subprocess, sys, time
from datetime import datetime, timezone
from pathlib import Path
from urllib.request import urlopen

ROOT=Path('/opt/salemax'); APP='salemax-app-1'; DB='salemax-db-1'
BASE='/opt/salemax/releases/training-pipeline-correction-v3-9867ca72-20261104'
IMAGE='sha256:753d77d421b3160872df0812e7b38505a1db7104cdb9d6c8b17415b2420de667'
VERSION='20261126-campaign-delete1'
FILES={
 'modules/platform/email-marketing.js':'/app/modules/platform/email-marketing.js',
 'modules/platform/email-marketing-router.js':'/app/modules/platform/email-marketing-router.js',
 'client/public/email-marketing-workspace.js':'/app/client/public/email-marketing-workspace.js',
 'client/public/email-marketing-workspace.css':'/app/client/public/email-marketing-workspace.css',
 'client/public/index.html':'/app/client/public/index.html',
}
MIGRATION='database/migrations/20270211_email_campaign_soft_delete.sql'
HELPER='deploy/email-campaign-delete-release.py'
SOURCE_FILES=(*FILES, MIGRATION, HELPER)
EXPECTED={
 'modules/platform/email-marketing.js':'88655b84ce7e9768b4c78dc86cf4d421779ad63b575c6e64e05f65eecb3434c3',
 'modules/platform/email-marketing-router.js':'1bbbab37511963f48a2e11c2637afe9871fffa065c207536a048b5cce3cc26e3',
 'client/public/email-marketing-workspace.js':'81bdfd94f64476c6983f90bf84428e7f5d6759b2c0fb7fa4c436fad2c57669ef',
 'client/public/email-marketing-workspace.css':'2853d87f58faf97f21997f10daf62706a959c7361d698fe044a1ee04c7c383d9',
}

def run(*args, env=None, input_text=None, timeout=900):
 r=subprocess.run(args,env=env,input=input_text,capture_output=True,text=True,timeout=timeout)
 if r.returncode: raise RuntimeError(Path(args[0]).name+' failed: '+r.stderr[-800:])
 return r.stdout
def digest(data): return hashlib.sha256(data).hexdigest()
def inspect(name): return json.loads(run('docker','inspect',name))[0]
def stage(root,path,commit):
 root=Path(root).resolve(); path=Path(path).expanduser().absolute()
 if path.exists() or path.is_symlink() or path==root or root in path.parents: raise RuntimeError('invalid/existing stage path')
 if run('git','-C',str(root),'rev-parse','HEAD').strip()!=commit: raise RuntimeError('checkout does not match commit')
 path.mkdir(mode=0o700,parents=True); manifest={}
 try:
  for name in SOURCE_FILES:
   src=root/name
   if src.is_symlink() or not src.is_file(): raise RuntimeError('missing source: '+name)
   data=subprocess.check_output(['git','-C',str(root),'show',f'{commit}:{name}'])
   if src.read_bytes()!=data: raise RuntimeError('uncommitted source: '+name)
   out=path/'source'/name; out.parent.mkdir(mode=0o700,parents=True,exist_ok=True); out.write_bytes(data); out.chmod(0o644); manifest[name]=digest(data)
  (path/'manifest.json').write_text(json.dumps({'commit':commit,'files':manifest},indent=2)+'\n'); (path/'manifest.json').chmod(0o600)
 except Exception: shutil.rmtree(path,ignore_errors=True); raise
 print(json.dumps({'stage':str(path),'commit':commit,'files':manifest}))
def lock_check():
 if os.geteuid()!=0 or os.environ.get('SALEMAX_DEPLOY_LOCK_HELD')!='1' or run('hostname').strip()!='carsqatar-prod-01': raise RuntimeError('expected protected production lock and host')
 if os.path.realpath(ROOT/'current')!=BASE: raise RuntimeError('active base release changed')
def compose_args(configs,workdir,extra=None):
 args=['docker','compose','--project-name','salemax','--project-directory',workdir,'--env-file',str(ROOT/'shared/stack.env'),'--env-file',str(ROOT/'shared/runtime.env')]
 for p in configs: args+=['-f',p]
 if extra: args+=['-f',str(extra)]
 return args
def compose_env(app,configs,workdir):
 env_files=[ROOT/'shared/stack.env',ROOT/'shared/runtime.env',Path(workdir)/'.env'];manual=json.loads((ROOT/'shared/rollback-private-inventory-84644fdfebee/compose-manual-vars.json').read_text())
 supplied={k for p in env_files if p.is_file() for k in re.findall(r'^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=',p.read_text(),re.M)};supplied.update(os.environ)
 referenced=set();mounts={m['Destination']:m['Source'] for m in app.get('Mounts',[])};live=dict(x.split('=',1) for x in app['Config'].get('Env',[]) if '=' in x)
 for p in configs:
  referenced.update(m.group(1) for m in re.finditer(r'\$\{([A-Za-z_][A-Za-z0-9_]*)([^}]*)\}',Path(p).read_text()) if not m.group(2).startswith((':-','-',':+','+','?')))
 variables={}
 for key in referenced-supplied:
  if key in manual:variables[key]=manual[key]
  elif key in live:variables[key]=live[key]
  elif key.endswith(('_BASE_IMAGE','_APP_IMAGE')):variables[key]=app['Config']['Image']
  else:
   inferred=set();release_candidates=[]
   pattern=re.compile(r'\$\{'+re.escape(key)+r'(?::[-?+][^}]*)?\}([^:\s]*)\s*:\s*(/app/[^:\s]+)')
   for p in configs:
    content=Path(p).read_text();config_dir=Path(p).parent;release_root=config_dir.parent if config_dir.name=='deploy' else config_dir
    if '${'+key in content and release_root.parent.name=='releases':release_candidates.append(str(release_root))
    for suffix,target in pattern.findall(content):
     if release_root.parent.name=='releases':release_candidates.append(str(release_root));continue
     if target in mounts and (not suffix or mounts[target].endswith(suffix)):inferred.add(mounts[target][:-len(suffix)] if suffix else mounts[target])
   if release_candidates:variables[key]=release_candidates[-1]
   elif len(inferred)==1:variables[key]=inferred.pop()
   else:raise RuntimeError('cannot resolve required Compose variable: '+key)
 return dict(os.environ,**variables)
def db_probe():
 code="const p=require('/app/database/config').promise();(async()=>{try{const [[c]]=await p.query(\"SELECT COUNT(*) n FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='sx_email_campaigns' AND column_name='deleted_at'\");const [m]=await p.query(\"SELECT migration_name,status,checksum,statement_count,statements_completed FROM salemax_schema_migrations WHERE migration_name='20270211_email_campaign_soft_delete.sql'\");console.log(JSON.stringify({columns:Number(c.n),ledger:m}))}finally{await p.end()}})().catch(e=>{console.log(e.code||'db-probe-failed');process.exit(1)})"
 return json.loads(run('docker','exec',APP,'node','-e',code).splitlines()[-1])
def apply_migration(sql):
 code=r"""let s='';process.stdin.setEncoding('utf8');process.stdin.on('data',x=>s+=x);process.stdin.on('end',async()=>{let c;try{const x=JSON.parse(s),r=require('/app/database/migration-runner'),crypto=require('node:crypto'),mysql=require('mysql2/promise'),name=x.name,checksum=crypto.createHash('sha256').update(x.sql,'utf8').digest('hex'),m=r.discover('/app/database/migrations');if(m.some(z=>z.file===name&&z.checksum!==checksum))throw Object.assign(Error(),{code:'MIGRATION_CHECKSUM_CHANGED'});if(!m.some(z=>z.file===name))m.push({file:name,checksum,statements:r.splitSql(x.sql)});m.sort((a,b)=>a.file.localeCompare(b.file));c=await mysql.createConnection({host:process.env.DBHOST,port:Number(process.env.DBPORT||3306),user:process.env.DBUSER,password:process.env.DBPASS,database:process.env.DBNAME});await r.applyMigrations(c,m,{only:name});const [rows]=await c.query('SELECT migration_name,status,checksum,statement_count,statements_completed FROM salemax_schema_migrations WHERE migration_name=?',[name]);console.log(JSON.stringify(rows[0]||{}))}catch(e){console.log(JSON.stringify({error:e.code||e.name||'migration-failed'}));process.exitCode=1}finally{try{await c?.end()}catch{}}});"""
 return json.loads(run('docker','exec','-i',APP,'node','-e',code,input_text=json.dumps({'name':MIGRATION.split('/')[-1],'sql':sql})).splitlines()[-1])
def deploy(stage_path,commit):
 lock_check(); stage_path=Path(stage_path).resolve(); manifest=json.loads((stage_path/'manifest.json').read_text())
 if manifest.get('commit')!=commit or set(manifest.get('files',{}))!=set(SOURCE_FILES): raise RuntimeError('stage manifest mismatch')
 files={n:(stage_path/'source'/n).read_bytes() for n in SOURCE_FILES}
 for n,data in files.items():
  if digest(data)!=manifest['files'][n]: raise RuntimeError('stage hash mismatch: '+n)
 app,db=inspect(APP),inspect(DB)
 if app.get('Image')!=IMAGE or app['State'].get('Health',{}).get('Status')!='healthy' or db['State'].get('Health',{}).get('Status')!='healthy': raise RuntimeError('app/database health or image differs')
 if os.statvfs(ROOT).f_bavail*os.statvfs(ROOT).f_frsize<4*1024**3: raise RuntimeError('less than 4 GiB free')
 prior_schema=db_probe()
 if prior_schema!={'columns':0,'ledger':[]}: raise RuntimeError('campaign soft-delete schema preimage differs')
 for name,expected in EXPECTED.items():
  actual=run('docker','exec',APP,'sha256sum',FILES[name]).split()[0]
  if actual!=expected: raise RuntimeError('live Email Marketing preimage differs: '+name)
 labels=app['Config']['Labels'] or {}; configs=labels.get('com.docker.compose.project.config_files','').split(','); workdir=labels.get('com.docker.compose.project.working_dir'); service=labels.get('com.docker.compose.service')
 if not configs or not workdir or service!='app' or any(not Path(p).is_file() for p in configs): raise RuntimeError('active Compose inputs incomplete')
 env=compose_env(app,configs,workdir)
 before=json.loads(run(*(compose_args(configs,workdir)+['config','--format','json']),env=env)); support={n:inspect(n)['Id'] for n in run('docker','ps','--filter','label=com.docker.compose.project=salemax','--format','{{.Names}}').splitlines() if n and n!=APP}
 stamp=datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ'); name=f'email-campaign-delete-{commit[:12]}-{stamp}'; release=ROOT/'releases'/name; backup=ROOT/'shared'/('rollback-'+name)
 release.mkdir(mode=0o755); runtime=release/'runtime'; runtime.mkdir(mode=0o755); os.chmod(runtime,0o755); deploy_dir=release/'deploy'; deploy_dir.mkdir(mode=0o755); os.chmod(deploy_dir,0o755); backup.mkdir(mode=0o700)
 helper_copy=deploy_dir/Path(HELPER).name;helper_copy.write_bytes(files[HELPER]);helper_copy.chmod(0o644)
 previous={'base':BASE,'config_files':configs,'workdir':workdir,'service':service,'image':app['Image'],'app_id':app['Id'],'support':support,'mounts':{m['Destination']:m['Source'] for m in app.get('Mounts',[])},'modes':{m['Destination']:{'type':m['Type'],'read_only':not m.get('RW',True),'propagation':m.get('Propagation')} for m in app.get('Mounts',[])}}
 (backup/'state.json').write_text(json.dumps(previous,indent=2)+'\n');os.chmod(backup/'state.json',0o600)
 for n,target in FILES.items():
  dest=backup/(n.replace('/','_')+'.before'); run('docker','cp',APP+':'+target,str(dest));os.chmod(dest,0o600)
 # Production index.html is live-derived because prior releases intentionally maintain runtime-only references.
 index=(backup/'client_public_index.html.before').read_text()
 for ext in ('css','js'):
  old=f'email-marketing-workspace.{ext}?v=20261124-campaign-outcome-fix1'; new=f'email-marketing-workspace.{ext}?v={VERSION}'
  if index.count(old)!=1: raise RuntimeError('live shell cache reference differs for '+ext)
  index=index.replace(old,new,1)
 targets={FILES[n]:str(runtime/n) for n in FILES}
 for n in FILES:
  target=runtime/n;target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(index.encode() if n=='client/public/index.html' else files[n]);target.chmod(0o644)
 (runtime/'database/migrations').mkdir(parents=True,exist_ok=True); (runtime/MIGRATION).write_bytes(files[MIGRATION]); (runtime/MIGRATION).chmod(0o644)
 volumes=[]; oldmounts=previous['mounts']
 for dest,source in oldmounts.items():
  mode=previous['modes'][dest];vol={'type':mode['type'],'source':targets.get(dest,source),'target':dest}
  if mode['read_only']:vol['read_only']=True
  if mode['type']=='bind' and mode.get('propagation') not in (None,'','rprivate'):vol['bind']={'propagation':mode['propagation']}
  volumes.append(vol)
 for dest,source in targets.items():
  if dest not in oldmounts:volumes.append({'type':'bind','source':source,'target':dest})
 overlay=deploy_dir/('compose.'+name+'.json');overlay.write_text(json.dumps({'services':{'app':{'volumes':volumes}},'name':'salemax'},indent=2)+'\n');overlay.chmod(0o640)
 after=json.loads(run(*(compose_args(configs,workdir,overlay)+['config','--format','json']),env=env))
 if {k:v for k,v in before['services'].items() if k!='app'}!={k:v for k,v in after['services'].items() if k!='app'}:raise RuntimeError('overlay alters another service')
 oldapp,newapp=dict(before['services']['app']),dict(after['services']['app']);oldapp.pop('volumes',None);newvols=newapp.pop('volumes',[]);newapp.pop('volumes',None)
 if oldapp!=newapp or len(newvols)!=len(volumes):raise RuntimeError('overlay changes app configuration or mounts unexpectedly')
 migration=apply_migration(files[MIGRATION].decode())
 if migration.get('status')!='applied' or int(migration.get('statement_count',0))!=int(migration.get('statements_completed',-1)):raise RuntimeError('migration did not apply cleanly')
 args=compose_args(configs,workdir,overlay);run(*(args+['up','-d','--no-deps','--no-build',service]),env=env)
 for _ in range(50):
  app=inspect(APP)
  if app['State'].get('Health',{}).get('Status')=='healthy':break
  time.sleep(2)
 else:raise RuntimeError('app did not become healthy')
 if app.get('Image')!=IMAGE:raise RuntimeError('app image unexpectedly changed')
 for name2,identity in support.items():
  if inspect(name2)['Id']!=identity:raise RuntimeError('non-app service changed: '+name2)
 schema=db_probe()
 if schema['columns']!=1 or len(schema['ledger'])!=1 or schema['ledger'][0]['status']!='applied':raise RuntimeError('campaign delete schema validation failed')
 hashes={n:digest((runtime/n).read_bytes()) for n in FILES}
 for n in FILES:
  if run('docker','exec',APP,'sha256sum',FILES[n]).split()[0]!=hashes[n]:raise RuntimeError('runtime hash mismatch: '+n)
 with urlopen('https://7network.live/healthz',timeout=20) as r:
  if r.status!=200:raise RuntimeError('health endpoint did not return 200')
 with urlopen('https://7network.live/user?page=campaign-dashboard&channel=email',timeout=20) as r:
  shell=r.read().decode('utf8','replace')
  if r.status!=200 or VERSION not in shell:raise RuntimeError('live email workspace shell did not return updated cache key')
 for n in ('email-marketing-workspace.js','email-marketing-workspace.css'):
  with urlopen('https://7network.live/'+n+'?v='+VERSION,timeout=20) as r:
   data=r.read()
   if r.status!=200 or digest(data)!=hashes['client/public/'+n]:raise RuntimeError('public asset mismatch: '+n)
 result={'sourceCommit':commit,'release':str(release),'rollback':str(backup),'appImage':app['Image'],'appHealthy':True,'databaseHealthy':inspect(DB)['State']['Health']['Status']=='healthy','migration':migration,'runtimeHashes':hashes,'healthHttp':200,'workspaceHttp':200,'assetsHttp':{'js':200,'css':200},'supportServicesUnchanged':len(support),'emailSent':False}
 (backup/'deployment.json').write_text(json.dumps(result,indent=2)+'\n');os.chmod(backup/'deployment.json',0o600);print(json.dumps(result,indent=2))

def restore(snapshot_path):
 lock_check(); snapshot=Path(snapshot_path);prior=json.loads((snapshot/'state.json').read_text())
 if prior.get('base')!=BASE:raise RuntimeError('rollback base differs')
 app=inspect(APP);current=(app.get('Config',{}).get('Labels') or {}).get('com.docker.compose.project.config_files','').split(',')
 if current[:len(prior['config_files'])]!=prior['config_files'] or len(current)!=len(prior['config_files'])+1 or 'email-campaign-delete-' not in current[-1]:raise RuntimeError('campaign deletion is not the sole newest overlay')
 env=compose_env(app,prior['config_files'],prior['workdir']);volumes=[]
 for dest,source in prior['mounts'].items():
  mode=prior['modes'][dest];item={'type':mode['type'],'source':source,'target':dest}
  if mode['read_only']:item['read_only']=True
  if mode['type']=='bind' and mode.get('propagation') not in (None,'','rprivate'):item['bind']={'propagation':mode['propagation']}
  volumes.append(item)
 file=snapshot/'compose.restore.json';file.write_text(json.dumps({'services':{'app':{'volumes':volumes}},'name':'salemax'},indent=2)+'\n');file.chmod(0o600)
 before=json.loads(run(*(compose_args(prior['config_files'],prior['workdir'])+['config','--format','json']),env=env));after=json.loads(run(*(compose_args(prior['config_files'],prior['workdir'],file)+['config','--format','json']),env=env))
 if {k:v for k,v in before['services'].items() if k!='app'}!={k:v for k,v in after['services'].items() if k!='app'}:raise RuntimeError('rollback changes another service')
 run(*(compose_args(prior['config_files'],prior['workdir'],file)+['up','-d','--no-deps','--no-build',prior['service']]),env=env)
 for _ in range(50):
  app=inspect(APP)
  if app['State'].get('Health',{}).get('Status')=='healthy':break
  time.sleep(2)
 else:raise RuntimeError('app did not recover after rollback')
 for name,identity in prior['support'].items():
  if inspect(name)['Id']!=identity:raise RuntimeError('support service changed during rollback')
 print(json.dumps({'restored':True,'rollback':str(snapshot),'appHealthy':True,'additiveMigrationRetained':MIGRATION}))

def main(args):
 if len(args)==4 and args[0]=='stage':stage(args[1],args[2],args[3])
 elif len(args)==3 and args[0]=='deploy':deploy(args[1],args[2])
 elif len(args)==2 and args[0]=='restore':restore(args[1])
 else:raise SystemExit('usage: helper stage SOURCE_ROOT STAGE COMMIT | deploy STAGE COMMIT | restore SNAPSHOT')
if __name__=='__main__':
 try:main(sys.argv[1:])
 except Exception as error:print(json.dumps({'error':str(error)}),file=sys.stderr);raise SystemExit(1)
