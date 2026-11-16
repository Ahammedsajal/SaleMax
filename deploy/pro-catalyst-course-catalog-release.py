"""Guarded app-only overlay for Pro Catalyst course discovery and contact capture."""
import copy
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import time

ROOT = Path('/opt/salemax')
APP = 'salemax-app-1'
BASE = '/opt/salemax/releases/training-pipeline-correction-v3-9867ca72-20261104'
EXPECTED_IMAGE = 'sha256:753d77d421b3160872df0812e7b38505a1db7104cdb9d6c8b17415b2420de667'
SUPPORT = ('salemax-db-1', 'salemax-report-worker-1', 'salemax-libretranslate-1',
           'salemax-recruitment-founder-notification-worker-1', 'salemax-bot-lead-test-db')
ASSETS = {
    'modules/platform/chatbot-business-context.js': 'modules/platform/chatbot-business-context.js',
    'modules/platform/chatbot-domain-packs.js': 'modules/platform/chatbot-domain-packs.js',
    'modules/platform/chatbot-lead-capture.js': 'modules/platform/chatbot-lead-capture.js',
    'modules/platform/chatbot-runtime.js': 'modules/platform/chatbot-runtime.js',
    'modules/platform/chatbot-training-guide.js': 'modules/platform/chatbot-training-guide.js',
}
HASHES = {
    'modules/platform/chatbot-business-context.js': ('49b0e5b802baf76f5406fe30602c175be21c6a29736479161610aacc11d744b0', 'f7f4bfbdef927c23df3e2879b707387b510e56a87d1385fbd7cccc8d5e5da78c'),
    'modules/platform/chatbot-domain-packs.js': ('46c88dd63701408dfff58d44fc7f82954cf7610bdadb680b192337602591d1c6', '18e5114966b3eec91001f1dd0ea6ad02747d8d71ab53a309c2a8141a2c2f868f'),
    'modules/platform/chatbot-lead-capture.js': ('1b1a5b8272d544e96f24357b59443830488ad3f476c073e144933a39c557b0f2', 'd108bb15190c43084e9ded0a13e359fb2e64f904219ab73dadc2b1cca1a846f1'),
    'modules/platform/chatbot-runtime.js': ('1719f2ade49b388323a1ac9a0bc9160b95ceffdedf485b779742cbda02916356', 'a545105244a19b7d4352cf901dcc74b0d9c09116f7cfc66d3db2f6a6361b09d0'),
    'modules/platform/chatbot-training-guide.js': ('e7f392a2ee798c78a0ef7f8f126c5d72c5ff0f1bc581f79d8a6df95034ae2a69', 'd75f9ad34330b23728a96b03c08407da9139e1e04c3632963a3996ee0d91c87b'),
}
PROFILE_PATH = '$.guidedContent.display.maxCourses'


def run(*args, env=None):
    result = subprocess.run(args, env=env, capture_output=True, text=True)
    if result.returncode:
        raise RuntimeError(f'{args[0]} failed with status {result.returncode}')
    return result.stdout


def inspect(name):
    return json.loads(run('docker', 'inspect', name))[0]


def sha(data):
    return hashlib.sha256(data).hexdigest()


def compose_args(files, env_files, workdir):
    args = ['docker', 'compose', '--project-name', 'salemax', '--project-directory', workdir]
    for name in env_files:
        args += ['--env-file', name]
    for name in files:
        args += ['-f', name]
    return args


def wait_healthy():
    for _ in range(45):
        app = inspect(APP)
        if app['State'].get('Health', {}).get('Status') == 'healthy':
            return app
        time.sleep(2)
    raise RuntimeError('App health did not recover')


def require_lock():
    if os.geteuid() != 0 or os.environ.get('SALEMAX_DEPLOY_LOCK_HELD') != '1':
        raise RuntimeError('Protected production lock required')
    if run('hostname').strip() != 'carsqatar-prod-01':
        raise RuntimeError('Unexpected production host')
    if os.path.realpath(ROOT / 'current') != BASE:
        raise RuntimeError('Active base release changed')


def node_json(script, payload=None):
    args = ['docker', 'exec', APP, 'node', '-e', script]
    if payload is not None:
        args.append(json.dumps(payload, separators=(',', ':')))
    output = run(*args)
    for line in reversed(output.splitlines()):
        try:
            return json.loads(line)
        except json.JSONDecodeError:
            continue
    raise RuntimeError('Database operation returned no structured result')


def read_profile_setting():
    script = r'''const pool=require('./database/config').promise();(async()=>{try{
      const tenantId=process.env.SALEMAX_CHATBOT_ONE_HOUR_HANDOFF_TENANT_ID;
      if(!tenantId)throw Error('TENANT_SCOPE_UNAVAILABLE');
      const [profiles]=await pool.query("SELECT id,revision,JSON_UNQUOTE(JSON_EXTRACT(config,?)) AS maxCourses FROM sx_chatbot_profiles WHERE tenant_id=? AND status=? AND category_key=? ORDER BY updated_at DESC",["$.guidedContent.display.maxCourses",tenantId,"live","training_center"]);
      const [[catalogue]]=await pool.query("SELECT COUNT(*) AS activeCourses FROM sx_training_courses WHERE tenant_id=? AND status=?",[tenantId,"active"]);
      console.log(JSON.stringify({profiles,activeCourses:Number(catalogue.activeCourses)}));
    }finally{await pool.end()}})().catch(error=>{console.error(error.code||'PROFILE_READ_FAILED');process.exit(1)})'''
    data = node_json(script)
    if len(data.get('profiles') or []) != 1:
        raise RuntimeError('Expected exactly one live Training Center chatbot profile')
    count = int(data.get('activeCourses') or 0)
    if not 1 <= count <= 10:
        raise RuntimeError('Active catalogue size is outside the reviewed ten-course list capacity')
    profile = data['profiles'][0]
    configured = int(profile['maxCourses']) if profile.get('maxCourses') is not None else None
    return {'profileId': profile['id'], 'revisionBefore': int(profile['revision']),
            'maxCoursesBefore': configured, 'activeCourses': count,
            'maxCoursesAfter': max(configured or 10, count),
            'changed': configured is not None and configured < count}


def set_profile_limit(snapshot, restore=False):
    if not snapshot.get('changed'):
        return {'changed': False}
    if restore:
        script = r'''const pool=require('./database/config').promise();const x=JSON.parse(process.argv[1]);(async()=>{try{
          const tenantId=process.env.SALEMAX_CHATBOT_ONE_HOUR_HANDOFF_TENANT_ID;
          const [rows]=await pool.query("SELECT revision,JSON_UNQUOTE(JSON_EXTRACT(config,?)) AS currentValue FROM sx_chatbot_profiles WHERE tenant_id=? AND id=? AND status=? AND category_key=?",[x.path,tenantId,x.profileId,"live","training_center"]);
          if(rows.length!==1)throw Error('PROFILE_NOT_FOUND');
          const current=rows[0].currentValue===null?null:Number(rows[0].currentValue);
          if(current===x.previousValue){console.log(JSON.stringify({restored:false,alreadyRestored:true}));return}
          if(current!==x.targetValue)throw Error('PROFILE_SETTING_CHANGED_AFTER_DEPLOYMENT');
          const [result]=x.previousValue===null
            ? await pool.query("UPDATE sx_chatbot_profiles SET config=JSON_REMOVE(config,?),revision=revision+1,updated_at=UTC_TIMESTAMP(3) WHERE tenant_id=? AND id=? AND revision=? AND JSON_UNQUOTE(JSON_EXTRACT(config,?))=?",[x.path,tenantId,x.profileId,rows[0].revision,x.path,String(x.targetValue)])
            : await pool.query("UPDATE sx_chatbot_profiles SET config=JSON_SET(config,?,CAST(? AS UNSIGNED)),revision=revision+1,updated_at=UTC_TIMESTAMP(3) WHERE tenant_id=? AND id=? AND revision=? AND JSON_UNQUOTE(JSON_EXTRACT(config,?))=?",[x.path,x.previousValue,tenantId,x.profileId,rows[0].revision,x.path,String(x.targetValue)]);
          if(result.affectedRows!==1)throw Error('PROFILE_SETTING_RESTORE_CONFLICT');
          console.log(JSON.stringify({restored:true}));
        }finally{await pool.end()}})().catch(error=>{console.error(error.code||error.message||'PROFILE_RESTORE_FAILED');process.exit(1)})'''
        payload = {'path': PROFILE_PATH, 'profileId': snapshot['profileId'],
                   'previousValue': snapshot['maxCoursesBefore'], 'targetValue': snapshot['maxCoursesAfter']}
    else:
        script = r'''const pool=require('./database/config').promise();const x=JSON.parse(process.argv[1]);(async()=>{try{
          const tenantId=process.env.SALEMAX_CHATBOT_ONE_HOUR_HANDOFF_TENANT_ID;
          const [result]=await pool.query("UPDATE sx_chatbot_profiles SET config=JSON_SET(config,?,CAST(? AS UNSIGNED)),revision=revision+1,updated_at=UTC_TIMESTAMP(3) WHERE tenant_id=? AND id=? AND status=? AND category_key=? AND revision=? AND CAST(JSON_UNQUOTE(JSON_EXTRACT(config,?)) AS UNSIGNED)=?",[x.path,x.targetValue,tenantId,x.profileId,"live","training_center",x.revisionBefore,x.path,x.previousValue]);
          if(result.affectedRows!==1)throw Error('PROFILE_SETTING_REVISION_CONFLICT');
          const [[row]]=await pool.query("SELECT revision,JSON_UNQUOTE(JSON_EXTRACT(config,?)) AS maxCourses FROM sx_chatbot_profiles WHERE tenant_id=? AND id=?",[x.path,tenantId,x.profileId]);
          if(Number(row.maxCourses)!==x.targetValue)throw Error('PROFILE_SETTING_VERIFY_FAILED');
          console.log(JSON.stringify({updated:true,revisionAfter:Number(row.revision),maxCourses:Number(row.maxCourses)}));
        }finally{await pool.end()}})().catch(error=>{console.error(error.code||error.message||'PROFILE_UPDATE_FAILED');process.exit(1)})'''
        payload = {'path': PROFILE_PATH, 'profileId': snapshot['profileId'],
                   'revisionBefore': snapshot['revisionBefore'], 'previousValue': snapshot['maxCoursesBefore'] or 0,
                   'targetValue': snapshot['maxCoursesAfter']}
    return node_json(script, payload)


def deploy(stage, commit):
    require_lock()
    if not re.fullmatch(r'[a-f0-9]{40}', commit):
        raise RuntimeError('Invalid source commit')
    app = inspect(APP)
    if app['State'].get('Health', {}).get('Status') != 'healthy' or app['Image'] != EXPECTED_IMAGE:
        raise RuntimeError('Active app health or image differs from the reviewed baseline')
    labels = app['Config']['Labels']
    files = labels['com.docker.compose.project.config_files'].split(',')
    env_files = labels['com.docker.compose.project.environment_file'].split(',')
    workdir = labels['com.docker.compose.project.working_dir']
    if not files or not all(Path(p).is_file() for p in files + env_files):
        raise RuntimeError('Active Compose inputs are incomplete')
    if not all((stage / source).is_file() for source in ASSETS.values()):
        raise RuntimeError('Staging directory is missing reviewed assets')

    release = ROOT / 'releases' / f'pro-catalyst-course-catalog-{commit[:12]}-20261116'
    backup = ROOT / 'shared' / f'rollback-pro-catalyst-course-catalog-{commit[:12]}-20261116'
    if release.exists() or backup.exists():
        raise RuntimeError('Release or rollback path already exists')
    os.umask(0o077)
    release.mkdir(mode=0o755)
    backup.mkdir(mode=0o700)
    setting = read_profile_setting()
    (backup / 'profile-setting.before.json').write_text(json.dumps(setting, indent=2) + '\n')
    (backup / 'app-before.json').write_text(json.dumps(app))
    (backup / 'compose-files.before.txt').write_text('\n'.join(files) + '\n')
    (backup / 'compose-env-files.before.txt').write_text('\n'.join(env_files) + '\n')
    (backup / 'compose-working-dir.txt').write_text(workdir + '\n')
    (backup / 'base-release.txt').write_text(BASE + '\n')
    input_hashes = {name: sha(Path(name).read_bytes()) for name in files + env_files}
    (backup / 'compose-input-hashes.json').write_text(json.dumps(input_hashes))

    prior_vars_path = ROOT / 'shared/rollback-private-inventory-84644fdfebee/compose-manual-vars.json'
    manual = json.loads(prior_vars_path.read_text())
    supplied = {key for name in env_files for key in re.findall(r'^\s*([A-Za-z_][A-Za-z0-9_]*)=', Path(name).read_text(), re.M)}
    referenced = {key for name in files for key in re.findall(r'\$\{([A-Za-z_][A-Za-z0-9_]*)', Path(name).read_text())}
    live_env = dict(item.split('=', 1) for item in app['Config']['Env'] if '=' in item)
    variables = {}
    for key in referenced - supplied:
        if key in manual:
            variables[key] = manual[key]
        elif key in live_env:
            variables[key] = live_env[key]
        else:
            raise RuntimeError('Missing Compose interpolation variable')
    (backup / 'compose-vars.json').write_text(json.dumps(variables))
    env = dict(os.environ, **variables)

    runtime = release / 'runtime'
    runtime.mkdir(mode=0o755)
    preimages = backup / 'preimages'
    preimages.mkdir(mode=0o700)
    changed = {}
    for target, source in ASSETS.items():
        live_path = '/app/' + target
        saved = preimages / target
        saved.parent.mkdir(parents=True, exist_ok=True)
        run('docker', 'cp', APP + ':' + live_path, str(saved))
        original = saved.read_bytes()
        if sha(original) != run('docker', 'exec', APP, 'sha256sum', live_path).split()[0]:
            raise RuntimeError('Live preimage changed: ' + target)
        expected_before, expected_after = HASHES[target]
        if sha(original) != expected_before:
            raise RuntimeError('Production preimage differs from reviewed source: ' + target)
        data = (stage / source).read_bytes()
        if sha(data) != expected_after:
            raise RuntimeError('Staged asset differs from reviewed release: ' + target)
        output = runtime / target
        output.parent.mkdir(parents=True, exist_ok=True, mode=0o755)
        output.write_bytes(data)
        output.chmod(0o644)
        changed[target] = data

    (backup / 'preimage-hashes.json').write_text(json.dumps({p: sha((preimages / p).read_bytes()) for p in ASSETS}))
    mounts = [{'type': 'bind', 'source': str(runtime / name), 'target': '/app/' + name,
               'read_only': True, 'bind': {'create_host_path': False}} for name in changed]
    overlay = release / 'compose.pro-catalyst-course-catalog.json'
    overlay.write_text(json.dumps({'services': {'app': {'image': app['Config']['Image'], 'volumes': mounts}}}))
    overlay.chmod(0o644)
    common = compose_args(files, env_files, workdir)
    candidate = common + ['-f', str(overlay)]
    before = json.loads(run(*common, 'config', '--format', 'json', env=env))
    after = json.loads(run(*candidate, 'config', '--format', 'json', env=env))
    expected_volumes = {v['target']: v for v in before['services']['app']['volumes']}
    actual_volumes = {v['target']: v for v in after['services']['app']['volumes']}
    for mount in mounts:
        target = mount['target']
        actual = actual_volumes.pop(target, {})
        expected_volumes.pop(target, None)
        if any(actual.get(key) != mount[key] for key in ('type', 'source', 'read_only')):
            raise RuntimeError('Candidate is missing the reviewed read-only bind: ' + target)
    if actual_volumes != expected_volumes:
        raise RuntimeError('Candidate changes unexpected app mounts')
    before_app, after_app = copy.deepcopy(before['services']['app']), copy.deepcopy(after['services']['app'])
    before_app.pop('volumes')
    after_app.pop('volumes')
    if before_app != after_app:
        raise RuntimeError('Candidate changes non-mount app configuration')
    if {key: value for key, value in before['services'].items() if key != 'app'} != {key: value for key, value in after['services'].items() if key != 'app'}:
        raise RuntimeError('Candidate changes other Compose services')
    services = {name: inspect(name)['Id'] for name in SUPPORT}
    (backup / 'support-services.json').write_text(json.dumps(services))
    (backup / 'release-path.txt').write_text(str(release) + '\n')
    (release / 'deploy').mkdir(mode=0o755)
    helper = release / 'deploy/pro-catalyst-course-catalog-release.py'
    helper.write_bytes(Path(__file__).read_bytes())
    helper.chmod(0o644)

    if any(sha(Path(name).read_bytes()) != digest for name, digest in input_hashes.items()) or inspect(APP)['Id'] != app['Id']:
        raise RuntimeError('Running app or Compose inputs changed during preparation')
    setting_updated = False
    try:
        run(*candidate, 'up', '-d', '--no-deps', '--no-build', '--force-recreate', 'app', env=env)
        current = wait_healthy()
        if current['Image'] != app['Image'] or current['Config']['Labels']['com.docker.compose.project.config_files'] != ','.join(files + [str(overlay)]):
            raise RuntimeError('App image or Compose chain changed')
        if any(inspect(name)['Id'] != identity for name, identity in services.items()):
            raise RuntimeError('Support service identity changed')
        for name, data in changed.items():
            if run('docker', 'exec', APP, 'sha256sum', '/app/' + name).split()[0] != sha(data):
                raise RuntimeError('Runtime file hash mismatch: ' + name)
        if setting['changed']:
            setting_updated = True
            result_setting = set_profile_limit(setting)
            if result_setting.get('maxCourses') != setting['maxCoursesAfter']:
                raise RuntimeError('Course list setting did not reach the reviewed catalogue count')
            setting['revisionAfter'] = result_setting.get('revisionAfter')
        result = {'sourceCommit': commit, 'release': str(release), 'rollback': str(backup),
                  'image': current['Image'], 'composeInputs': len(files) + 1,
                  'envInputs': len(env_files), 'mounts': len(current['Mounts']),
                  'activeCourses': setting['activeCourses'], 'profileMaxCourses': setting['maxCoursesAfter'],
                  'profileSettingChanged': setting_updated,
                  'hashes': {name: sha(data) for name, data in changed.items()}}
        (backup / 'profile-setting.result.json').write_text(json.dumps(setting, indent=2) + '\n')
        (backup / 'result.json').write_text(json.dumps(result, indent=2) + '\n')
        print(json.dumps(result))
    except Exception:
        if setting_updated:
            set_profile_limit(setting, restore=True)
        run(*common, 'up', '-d', '--no-deps', '--no-build', '--force-recreate', 'app', env=env)
        wait_healthy()
        raise


def restore(backup):
    require_lock()
    files = (backup / 'compose-files.before.txt').read_text().splitlines()
    env_files = (backup / 'compose-env-files.before.txt').read_text().splitlines()
    release = Path((backup / 'release-path.txt').read_text().strip())
    overlay = release / 'compose.pro-catalyst-course-catalog.json'
    if inspect(APP)['Config']['Labels']['com.docker.compose.project.config_files'] != ','.join(files + [str(overlay)]):
        raise RuntimeError('A later release is active; roll it back first')
    for name, digest in json.loads((backup / 'compose-input-hashes.json').read_text()).items():
        if sha(Path(name).read_bytes()) != digest:
            raise RuntimeError('Rollback Compose input changed')
    env = dict(os.environ, **json.loads((backup / 'compose-vars.json').read_text()))
    common = compose_args(files, env_files, (backup / 'compose-working-dir.txt').read_text().strip())
    run(*common, 'up', '-d', '--no-deps', '--no-build', '--force-recreate', 'app', env=env)
    current = wait_healthy()
    prior = json.loads((backup / 'app-before.json').read_text())
    if current['Image'] != prior['Image']:
        raise RuntimeError('Rollback app image mismatch')
    for target in ASSETS:
        expected = json.loads((backup / 'preimage-hashes.json').read_text())[target]
        if run('docker', 'exec', APP, 'sha256sum', '/app/' + target).split()[0] != expected:
            raise RuntimeError('Rollback file hash mismatch: ' + target)
    setting = json.loads((backup / 'profile-setting.result.json').read_text())
    result_setting = set_profile_limit(setting, restore=True) if setting.get('changed') else {'changed': False}
    for name, identity in json.loads((backup / 'support-services.json').read_text()).items():
        if inspect(name)['Id'] != identity:
            raise RuntimeError('Rollback support service changed')
    print(json.dumps({'rolledBack': str(release), 'appHealthy': True,
                      'profileSettingRestored': result_setting.get('restored', False)}))


if __name__ == '__main__':
    if len(sys.argv) == 4 and sys.argv[1] == 'deploy':
        deploy(Path(sys.argv[2]), sys.argv[3])
    elif len(sys.argv) == 3 and sys.argv[1] == 'restore':
        restore(Path(sys.argv[2]))
    else:
        raise SystemExit('Usage: pro-catalyst-course-catalog-release.py deploy <stage> <commit> | restore <backup>')
