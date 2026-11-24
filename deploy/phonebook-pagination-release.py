import copy, hashlib, json, os, re, subprocess, sys, time
from datetime import datetime, timezone
from pathlib import Path
ROOT=Path('/opt/salemax'); APP='salemax-app-1'
BASE='/opt/salemax/releases/training-pipeline-correction-v3-9867ca72-20261104'
EXPECTED_IMAGE='sha256:753d77d421b3160872df0812e7b38505a1db7104cdb9d6c8b17415b2420de667'
TARGET='/app/client/public/phonebook-workspace.js'
PREIMAGE='205feb593868918448eba6f4dd07ed6308590cf7c9e1d00e1575a101b2660d8f'
def run(*args,check=True,env=None):
 r=subprocess.run(args,capture_output=True,text=True,env=env)
 if check and r.returncode: raise RuntimeError('command failed: '+Path(args[0]).name)
 return r
def digest(data): return hashlib.sha256(data).hexdigest()
def inspect(): return json.loads(run('docker','inspect',APP).stdout)[0]
def write(path,data,mode=0o600):
 path.parent.mkdir(parents=True,exist_ok=True); path.write_bytes(data); path.chmod(mode)
def compose_args(files,envs,workdir):
 a=['docker','compose','--project-name','salemax','--project-directory',workdir]
 for p in envs:a+=['--env-file',p]
 for p in files:a+=['-f',p]
 return a
def compose_env(files,envs,app):
 manual=ROOT/'shared/rollback-private-inventory-84644fdfebee/compose-manual-vars.json'
 extra=json.loads(manual.read_text())
 supplied={k for p in envs for k in re.findall(r'^\s*([A-Za-z_][A-Za-z0-9_]*)=',Path(p).read_text(),re.M)}
 refs={k for p in files for k in re.findall(r'\$\{([A-Za-z_][A-Za-z0-9_]*)',Path(p).read_text())}
 live=dict(x.split('=',1) for x in app['Config']['Env'] if '=' in x)
 vars={k:extra[k] if k in extra else live[k] for k in refs-supplied if k in extra or k in live}
 if set(vars)!=(refs-supplied): raise RuntimeError('unresolved Compose interpolation')
 return dict(os.environ,**vars),vars
def support_ids():
 names=run('docker','ps','--filter','label=com.docker.compose.project=salemax','--format','{{.Names}}').stdout.splitlines()
 return {n:inspect_name(n)['Id'] for n in names if n and n!=APP}
def inspect_name(n):return json.loads(run('docker','inspect',n).stdout)[0]
def wait_healthy():
 for _ in range(45):
  x=inspect();
  if x['State'].get('Health',{}).get('Status')=='healthy':return x
  time.sleep(2)
 raise RuntimeError('app health did not recover')
def get_live(path,out):run('docker','cp',f'{APP}:{path}',str(out));out.chmod(0o600)
def sha_file(p):return digest(Path(p).read_bytes())
def verify_support(before):
 if support_ids()!=before:raise RuntimeError('non-app service identity changed')
def config(args,env):return json.loads(run(*args,'config','--format','json',env=env).stdout)
def writej(p,o):write(p,(json.dumps(o,indent=2)+'\n').encode())
def deploy(stage,commit):
 if os.geteuid()!=0 or os.environ.get('SALEMAX_DEPLOY_LOCK_HELD')!='1':raise RuntimeError('protected production lock required')
 if run('hostname').stdout.strip()!='carsqatar-prod-01' or os.path.realpath(ROOT/'current')!=BASE:raise RuntimeError('production identity/base changed')
 if not re.fullmatch('[a-f0-9]{40}',commit):raise RuntimeError('invalid source commit')
 stage=Path(stage); source=stage/'phonebook-workspace.js'; new=source.read_bytes()
 if b"['email_marketing_consent',t('Email marketing consent'" in new:raise RuntimeError('consent display column still present')
 if b"name=\"emailMarketingConsent\"" not in new or b"function edit(id)" not in new:raise RuntimeError('consent recording safeguards were removed')
 app=inspect();
 if app['Image']!=EXPECTED_IMAGE:raise RuntimeError('running image changed')
 labels=app['Config']['Labels']; files=labels['com.docker.compose.project.config_files'].split(','); envs=labels['com.docker.compose.project.environment_file'].split(','); workdir=labels['com.docker.compose.project.working_dir']
 support=support_ids(); hashes={p:digest(Path(p).read_bytes()) for p in files+envs}
 backup=ROOT/'shared'/('rollback-phonebook-pagination-'+commit[:12]+'-'+datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ'));backup.mkdir(mode=0o700)
 write(backup/'compose-files.before.txt',('\n'.join(files)+'\n').encode());write(backup/'compose-env-files.before.txt',('\n'.join(envs)+'\n').encode());write(backup/'compose-working-dir.txt',(workdir+'\n').encode())
 writej(backup/'compose-input-hashes.json',hashes);writej(backup/'support-services.json',support)
 writej(backup/'app-before.json',{'id':app['Id'],'imageId':app['Image'],'image':app['Config']['Image'],'state':app['State']['Status'],'health':app['State'].get('Health',{}).get('Status'),'composeFiles':files})
 pre=backup/'phonebook-workspace.js.before';get_live(TARGET,pre)
 if sha_file(pre)!=PREIMAGE:raise RuntimeError('live Phonebook preimage differs from reviewed source')
 release=ROOT/'releases'/('phonebook-pagination-'+commit[:12]+'-'+datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ'));runtime=release/'runtime';overlay=release/'compose.phonebook-pagination.json'
 js=runtime/'phonebook-workspace.js';write(js,new,0o644);writej(release/'runtime-hashes.json',{'client/public/phonebook-workspace.js':digest(new)})
 overlay_data={'services':{'app':{'image':app['Config']['Image'],'volumes':[{'type':'bind','source':str(js),'target':TARGET,'read_only':True,'bind':{'create_host_path':False}}]}}};writej(overlay,overlay_data,0o644)
 env,vars=compose_env(files,envs,app);writej(backup/'compose-vars.json',vars)
 before=config(compose_args(files,envs,workdir),env);candidate=compose_args(files+[str(overlay)],envs,workdir);after=config(candidate,env)
 oldv={v['target']:v for v in before['services']['app'].get('volumes',[])};newv={v['target']:v for v in after['services']['app'].get('volumes',[])}
 actual=newv.pop(TARGET,None)
 if not actual or actual.get('source')!=str(js) or actual.get('read_only') is not True or actual.get('type')!='bind':raise RuntimeError('read-only Phonebook mount missing')
 oldv.pop(TARGET,None)
 if oldv!=newv:raise RuntimeError('candidate changed unexpected app mounts')
 a=copy.deepcopy(before['services']['app']);b=copy.deepcopy(after['services']['app']);a.pop('volumes',None);b.pop('volumes',None)
 if a!=b:raise RuntimeError('candidate changed app configuration beyond mount')
 if {k:v for k,v in before['services'].items() if k!='app'}!={k:v for k,v in after['services'].items() if k!='app'}:raise RuntimeError('candidate changed non-app service')
 if {p:digest(Path(p).read_bytes()) for p in files+envs}!=hashes:raise RuntimeError('Compose inputs changed during release')
 helper=release/'deploy'/'phonebook-pagination-release.py';write(helper,Path(__file__).read_bytes(),0o644)
 try:
  run(*candidate,'up','-d','--no-deps','--no-build','--force-recreate','app',env=env);current=wait_healthy()
  if current['Image']!=app['Image'] or current['Config']['Labels']['com.docker.compose.project.config_files'].split(',')!=files+[str(overlay)]:raise RuntimeError('app image/Compose chain changed')
  verify_support(support)
  got=run('docker','exec',APP,'sha256sum',TARGET).stdout.split()[0]
  if got!=digest(new):raise RuntimeError('Phonebook asset runtime hash mismatch')
  status=run('python3','-c',"import urllib.request;print(urllib.request.urlopen('https://crm.salemax.qa/healthz',timeout=20).status)").stdout.strip()
  if status!='200':raise RuntimeError('public health check failed')
  result={'sourceCommit':commit,'release':str(release),'rollback':str(backup),'image':current['Image'],'composeInputs':len(files)+1,'envInputs':len(envs),'appMounts':len(current['Mounts']),'nonAppServicesUnchanged':len(support),'healthz':'HTTP 200','preimageSha256':PREIMAGE,'runtimeSha256':digest(new)}
  writej(backup/'result.json',result);print(json.dumps(result))
 except Exception as e:
  active=inspect();activefiles=active['Config']['Labels'].get('com.docker.compose.project.config_files','').split(',')
  if str(overlay) in activefiles:
   prior=compose_args(files,envs,workdir);run(*prior,'up','-d','--no-deps','--no-build','--force-recreate','app',env=env);restored=wait_healthy()
   if restored['Image']!=app['Image'] or run('docker','exec',APP,'sha256sum',TARGET).stdout.split()[0]!=PREIMAGE:raise RuntimeError('automatic rollback failed') from e
   verify_support(support)
  raise
if __name__=='__main__':
 if len(sys.argv)==4 and sys.argv[1]=='deploy':deploy(sys.argv[2],sys.argv[3])
 else:raise SystemExit('usage: phonebook-pagination-release.py deploy <stage> <commit>')
