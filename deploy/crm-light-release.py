"""Deploy CRM light-mode assets using the existing guarded app-only Compose workflow."""
import importlib.util
import json
import os
import re
import shutil
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from urllib.request import urlopen

HERE = Path(__file__).resolve()
COMMON = HERE.with_name('email-marketing-text-formatting-release.py')
spec = importlib.util.spec_from_file_location('guarded_release', COMMON)
g = importlib.util.module_from_spec(spec)
spec.loader.exec_module(g)
PREIMAGES = {
    'client/public/index.html': 'f4e454b8e3a5856fa718a5fda47d9d818e7a54d10afda5b20147f66432798a71',
    'client/public/pipeline/index.html': '2a632fa6c43c085fc6a2ab5619681fe5e326e7b2fd136e0e4bd327dea3ab57f1',
    'client/public/property-listings/index.html': 'a759494072f3c0621840476ede01187ae63ced2e20d9bc6176f5fef7a96798b0',
    'client/public/branding/7network/manifest.webmanifest': '6ab79348d056a703314b7af079242e46030cb555a6026965760a77031b645e3a',
    'client/public/chatgpt-oauth.html': '6c8fd12c6ab84699dc5bbe25b6289bc2330e8c725c914402a482f5ca6a401dec',
    'client/public/chatgpt-oauth.css': '1e8def80ee281833d2838bdc6aa4a592938e0118c4ea599ca988bea367135e5b',
    'client/public/crm-light-mode.js': None,
    'client/public/crm-light-mode.css': None,
}
VERSION = '20261120-light-only1'


def runtime_hash(name):
    path = '/app/' + name
    result = subprocess.run(['docker', 'exec', g.APP, 'test', '-f', path])
    if result.returncode == 1:
        return None
    result.check_returncode()
    return g.run('docker', 'exec', g.APP, 'sha256sum', path).split()[0]


def verify_inputs(state):
    for name, digest in state['inputs'].items():
        if g.sha(Path(name).read_bytes()) != digest:
            raise RuntimeError('Compose input has changed: ' + name)
    others = {n: ident for n, ident in g.inventory().items() if n != g.APP}
    if others != state['others']:
        raise RuntimeError('Other service identities changed')


def restore(backup):
    g.require_lock()
    backup = backup.resolve()
    if backup.parent != g.ROOT/'shared' or not backup.name.startswith('rollback-crm-light-'):
        raise RuntimeError('Unexpected rollback path')
    state = json.loads((backup/'state.json').read_text())
    files, envfiles = state['files'], state['envfiles']
    active, _, _ = g.compose_context(g.inspect(g.APP))
    if active != files + [state['overlay']]:
        raise RuntimeError('A different app overlay is active')
    verify_inputs(state)
    g.restore_chain(files, envfiles, state['workdir'], state['vars'])
    if any(runtime_hash(n) != h for n,h in PREIMAGES.items()):
        raise RuntimeError('Restore preimage mismatch')


def deploy(commit):
    g.require_lock()
    if not re.fullmatch('[a-f0-9]{40}', commit):
        raise RuntimeError('Invalid commit')
    app = g.inspect(g.APP)
    def healthy(name):
        return g.inspect(name)['State'].get('Health', {}).get('Status') == 'healthy'
    if not healthy(g.APP) or not healthy(g.DB) or app['Image'] != g.IMAGE_ID or shutil.disk_usage(g.ROOT).free < g.MINIMUM_FREE_BYTES:
        raise RuntimeError('Host preflight failed')
    files, envfiles, workdir = g.compose_context(app)
    env, variables = g.compose_environment(app, files, envfiles)
    common = g.compose_args(files, envfiles, workdir)
    before = json.loads(g.run(*common, 'config', '--format', 'json', env=env))
    g.verify_live_compose_app(app, before)
    for name, expected in PREIMAGES.items():
        if runtime_hash(name) != expected:
            raise RuntimeError('Unexpected live preimage: ' + name)
    tag = 'crm-light-' + commit[:12] + '-' + datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    release, backup = g.ROOT/'releases'/tag, g.ROOT/'shared'/('rollback-'+tag)
    release.mkdir(mode=0o755)
    backup.mkdir(mode=0o700)
    for helper in (HERE, COMMON):
        target = release/'deploy'/helper.name
        target.parent.mkdir(exist_ok=True)
        shutil.copyfile(helper, target)
    mounts, hashes = [], {}
    for name, previous in PREIMAGES.items():
        if previous:
            saved = backup/'preimages'/name
            saved.parent.mkdir(parents=True, exist_ok=True)
            g.run('docker', 'cp', g.APP+':/app/'+name, str(saved))
            if g.sha(saved.read_bytes()) != previous:
                raise RuntimeError('Snapshot changed: ' + name)
        target = release/name
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(HERE.parents[1]/name, target)
        target.chmod(0o644)
        hashes[name] = g.sha(target.read_bytes())
        mounts.append(dict(type='bind', source=str(target), target='/app/'+name, read_only=True, bind={'create_host_path':False}))
    overlay = release/'compose.crm-light.json'
    overlay.write_text(json.dumps({'services':{'app':{'image':g.IMAGE,'volumes':mounts}}}))
    state = dict(files=files, envfiles=envfiles, workdir=workdir, vars=variables, overlay=str(overlay),
                 app=app['Id'], image=app['Image'], inputs={p:g.sha(Path(p).read_bytes()) for p in files+envfiles},
                 others={n:i for n,i in g.inventory().items() if n!=g.APP})
    g.write_private(backup/'state.json',state)
    candidate=common+['-f',str(overlay)]
    after=json.loads(g.run(*candidate,'config','--format','json',env=env))
    g.validate_candidate(before,after,mounts)
    verify_inputs(state)
    if g.inspect(g.APP)['Id']!=app['Id']:
        raise RuntimeError('App changed during deployment')
    try:
        g.run(*candidate,'up','-d','--no-deps','--no-build','--force-recreate','app',env=env,timeout=900)
        active=g.wait_healthy()
        if g.compose_context(active)[0]!=files+[str(overlay)] or active['Image']!=app['Image'] or not healthy(g.DB):
            raise RuntimeError('Unexpected app or database state')
        verify_inputs(state)
        for name, digest in hashes.items():
            if runtime_hash(name)!=digest:
                raise RuntimeError('Incorrect deployed file: '+name)
        base='https://7network.live'
        for endpoint in ['/healthz','/user?page=dashboard','/admin/login','/agent/login']:
            with urlopen(base+endpoint,timeout=25) as res:
                if res.status!=200 or (endpoint!='/healthz' and VERSION.encode() not in res.read()):
                    raise RuntimeError('Unexpected public response: '+endpoint)
        for name in ('crm-light-mode.js','crm-light-mode.css'):
            with urlopen(base+'/'+name+'?v='+VERSION,timeout=25) as res:
                if g.sha(res.read())!=hashes['client/public/'+name]:
                    raise RuntimeError('Public asset differs: '+name)
        result=dict(commit=commit,release=str(release),backup=str(backup),runtime=hashes,otherServices=len(state['others']))
        g.write_private(backup/'result.json',result)
        print(json.dumps(result))
    except Exception:
        g.restore_chain(files,envfiles,workdir,variables)
        raise


if __name__=='__main__':
    if len(sys.argv)!=3 or sys.argv[1] not in ('deploy','restore'):
        raise SystemExit('Usage: deploy COMMIT or restore BACKUP')
    if sys.argv[1]=='deploy':
        deploy(sys.argv[2])
    else:
        restore(Path(sys.argv[2]))
