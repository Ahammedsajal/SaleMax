"""Apply or roll back the guarded app-only Pro Catalyst chatbot overlays."""
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
ACTIVE_OVERLAY = '/opt/salemax/releases/retail-cash-reconciliation-4b0c416ea4b5-20261108/compose.retail-cash-reconciliation.json'
PRIOR_VARS = ROOT / 'shared/rollback-private-inventory-84644fdfebee/compose-manual-vars.json'
REPLACED_FILES = {
    'modules/platform/chatbot-handoff-claims.js': '5a0e4cce97d26f932e1f19b6fab498df11149efa5d637ee36bad7137da7c73c5',
    'modules/platform/chatbot-runtime.js': '3ba8d087ca748c16cd403c9ae560aec5f5f263460c5250e13f4c1b4e78966ba6',
}
SCOPE_ENV = 'SALEMAX_CHATBOT_ONE_HOUR_HANDOFF_TENANT_ID'
SLUG = 'pro-catalyst-handover'
NEW_FILES = ()
ADD_SCOPE = True

def configure_admissions():
    global ACTIVE_OVERLAY, REPLACED_FILES, SCOPE_ENV, SLUG, NEW_FILES
    ACTIVE_OVERLAY = '/opt/salemax/releases/pro-catalyst-handover-55da66d08022-20261109/compose.pro-catalyst-handover.json'
    REPLACED_FILES = {
        'modules/platform/chatbot-runtime.js': '3e8330fb217fc6eabdbe4bb161ad9bda6bfd103bf4ac9c42e6086bda597ecc87',
        'modules/platform/chatbot-lead-capture.js': 'c03dc43fcd428f6f3309ea0b03a67c61c137d8932ba8896431691d681296c6c5',
        'modules/platform/chatbot-ai-prompt.js': '16835d7be66d52851650ea53a36a95b628c36894fe1aef9b79a561240fb909b0',
    }
    SCOPE_ENV = 'SALEMAX_CHATBOT_ADMISSIONS_INTAKE_TENANT_ID'
    SLUG = 'pro-catalyst-admissions'
    NEW_FILES = ('modules/platform/chatbot-admissions-intake.js',)


def configure_name_question():
    global ACTIVE_OVERLAY, REPLACED_FILES, SCOPE_ENV, SLUG, ADD_SCOPE
    ACTIVE_OVERLAY = '/opt/salemax/releases/pro-catalyst-admissions-bf5f7f99f1e5-20261109/compose.pro-catalyst-admissions.json'
    REPLACED_FILES = {
        'modules/platform/chatbot-runtime.js': 'f718d06af7e65fe19d43e4ec1fd4386fea540e5fc45ee6f4aaacce21a545abfe',
        'modules/platform/chatbot-lead-capture.js': '3e759f54f7c7a45f088cadff842d2839d87d80a792d3dcc25f43d0a3ac62524b',
    }
    SCOPE_ENV = 'SALEMAX_CHATBOT_ADMISSIONS_INTAKE_TENANT_ID'
    SLUG = 'pro-catalyst-name-question'
    ADD_SCOPE = False


def configure_knowledge():
    global ACTIVE_OVERLAY, REPLACED_FILES, SCOPE_ENV, SLUG, ADD_SCOPE
    ACTIVE_OVERLAY = '/opt/salemax/releases/pro-catalyst-name-question-e6b9c0cb92b0-20261109/compose.pro-catalyst-name-question.json'
    REPLACED_FILES = {
        'modules/platform/chatbot-runtime.js': 'e83f4c4efdbbd002826d7e76d5f8a289f7ba6aefce8de9f4219a5290d8a47f1e',
        'modules/platform/chatbot-business-context.js': '1d41007b283b7bf9e9116fd0d1e7160740685c616640cb84f696b5600ce911fa',
        'modules/platform/chatbot-admissions-intake.js': '8afb4e65d82020691f5242e6f174f8bd01615b02033fd9d68178ad4d5f05415c',
        'modules/platform/chatbot-lead-capture.js': 'c0dec85c964a15425f35fff6e07c79ff2da35490e3f8b26fc3d028e59db4432b',
    }
    SCOPE_ENV = 'SALEMAX_CHATBOT_ADMISSIONS_INTAKE_TENANT_ID'
    SLUG = 'pro-catalyst-knowledge'
    ADD_SCOPE = False


EXPECTED_IMAGE = 'sha256:c756899fdbf63edc71d45de0c71cffe1f063244d91378d90b15a2c98fc1d5135'
SUPPORT = (
    'salemax-db-1', 'salemax-report-worker-1', 'salemax-libretranslate-1',
    'salemax-recruitment-founder-notification-worker-1', 'salemax-bot-lead-test-db',
)


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
        current = inspect(APP)
        if current['State'].get('Health', {}).get('Status') == 'healthy':
            return current
        time.sleep(2)
    raise RuntimeError('App health did not recover')


def require_production_lock():
    if os.geteuid() != 0 or os.environ.get('SALEMAX_DEPLOY_LOCK_HELD') != '1':
        raise RuntimeError('Protected production lock required')
    if run('hostname').strip() != 'carsqatar-prod-01':
        raise RuntimeError('Unexpected production host')
    if os.path.realpath(ROOT / 'current') != BASE:
        raise RuntimeError('Active base release changed')


def deploy(stage, commit):
    require_production_lock()
    if not re.fullmatch(r'[a-f0-9]{40}', commit):
        raise RuntimeError('Invalid source commit')
    if not all((stage / name).is_file() for name in (*REPLACED_FILES, *NEW_FILES)):
        raise RuntimeError('Staging directory is missing reviewed chatbot files')
    os.umask(0o077)
    app = inspect(APP)
    if app['State'].get('Health', {}).get('Status') != 'healthy' or app['Image'] != EXPECTED_IMAGE:
        raise RuntimeError('Active app health or image differs from the reviewed baseline')
    labels = app['Config']['Labels']
    files = labels['com.docker.compose.project.config_files'].split(',')
    env_files = labels['com.docker.compose.project.environment_file'].split(',')
    workdir = labels['com.docker.compose.project.working_dir']
    if not files or files[-1] != ACTIVE_OVERLAY:
        raise RuntimeError('Active app overlay differs from the reviewed baseline')
    if not env_files or not all(Path(p).is_file() for p in files + env_files):
        raise RuntimeError('Active Compose inputs are incomplete')

    release = ROOT / 'releases' / f'{SLUG}-{commit[:12]}-20261109'
    backup = ROOT / 'shared' / f'rollback-{SLUG}-{commit[:12]}-20261109'
    if release.exists() or backup.exists():
        raise RuntimeError('Release or rollback path already exists')
    release.mkdir(mode=0o755)
    backup.mkdir(mode=0o700)
    (backup / 'app-before.json').write_text(json.dumps(app))
    (backup / 'compose-files.before.txt').write_text('\n'.join(files) + '\n')
    (backup / 'compose-env-files.before.txt').write_text('\n'.join(env_files) + '\n')
    (backup / 'compose-working-dir.txt').write_text(workdir + '\n')
    (backup / 'base-release.txt').write_text(BASE + '\n')
    input_hashes = {name: sha(Path(name).read_bytes()) for name in files + env_files}
    (backup / 'compose-input-hashes.json').write_text(json.dumps(input_hashes))

    manual = json.loads(PRIOR_VARS.read_text())
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
    changed = {}
    for name, expected in REPLACED_FILES.items():
        target = '/app/' + name
        if run('docker', 'exec', APP, 'sha256sum', target).split()[0] != expected:
            raise RuntimeError('Live file changed: ' + name)
        saved = backup / 'preimages' / name
        saved.parent.mkdir(parents=True, exist_ok=True)
        run('docker', 'cp', APP + ':' + target, str(saved))
        if sha(saved.read_bytes()) != expected:
            raise RuntimeError('Preimage copy changed: ' + name)
        data = (stage / name).read_bytes()
        output = runtime / name
        output.parent.mkdir(parents=True, exist_ok=True, mode=0o755)
        output.write_bytes(data)
        output.chmod(0o644)
        changed[name] = data

    for name in NEW_FILES:
        run('docker', 'exec', APP, 'test', '!', '-e', '/app/' + name)
        data = (stage / name).read_bytes()
        output = runtime / name
        output.parent.mkdir(parents=True, exist_ok=True, mode=0o755)
        output.write_bytes(data)
        output.chmod(0o644)
        changed[name] = data

    tenant_id = (stage / 'tenant-id').read_text().strip()
    if not re.fullmatch(r'[a-f0-9-]{36}', tenant_id):
        raise RuntimeError('Invalid tenant scope')
    tenant_check = """const db = require('/app/database/config').promise();
    db.query("SELECT COUNT(*) AS n FROM sx_tenants WHERE id=? AND name='Pro Catalyst' AND category_key='training_center' AND status='active'", [process.argv[1]])
      .then(([[row]]) => { if (Number(row.n) !== 1) process.exitCode = 1; })
      .catch(() => { process.exitCode = 1; }).finally(() => db.end());"""
    run('docker', 'exec', APP, 'node', '-e', tenant_check, tenant_id)
    if ADD_SCOPE and SCOPE_ENV in live_env:
        raise RuntimeError('Tenant scope is already configured')
    if not ADD_SCOPE and live_env.get(SCOPE_ENV) != tenant_id:
        raise RuntimeError('Active admissions tenant differs from the reviewed scope')
    if NEW_FILES and live_env.get('SALEMAX_CHATBOT_ONE_HOUR_HANDOFF_TENANT_ID') != tenant_id:
        raise RuntimeError('Admissions tenant differs from the active handoff tenant')

    mounts = [{'type': 'bind', 'source': str(runtime / name), 'target': '/app/' + name,
               'read_only': True, 'bind': {'create_host_path': False}} for name in changed]
    overlay = release / f'compose.{SLUG}.json'
    overlay_app = {'image': app['Config']['Image'], 'volumes': mounts}
    if ADD_SCOPE:
        overlay_app['environment'] = {SCOPE_ENV: tenant_id}
    overlay.write_text(json.dumps({'services': {'app': overlay_app}}))
    overlay.chmod(0o644)
    common = compose_args(files, env_files, workdir)
    candidate = common + ['-f', str(overlay)]
    before = json.loads(run(*common, 'config', '--format', 'json', env=env))
    after = json.loads(run(*candidate, 'config', '--format', 'json', env=env))
    old_app, new_app = before['services']['app'], after['services']['app']
    old_volumes = {row['target']: row for row in old_app['volumes']}
    new_volumes = {row['target']: row for row in new_app['volumes']}
    expected_volumes = dict(old_volumes, **{row['target']: row for row in mounts})
    if set(new_volumes) != set(expected_volumes):
        raise RuntimeError('Unexpected app mount targets')
    for target, row in new_volumes.items():
        expected = expected_volumes[target]
        if (row['type'], row.get('source'), row.get('read_only')) != (expected['type'], expected.get('source'), expected.get('read_only')):
            raise RuntimeError('Unexpected app mount: ' + target)
    old_app.pop('volumes')
    new_app.pop('volumes')
    if ADD_SCOPE and new_app['environment'].pop(SCOPE_ENV, None) != tenant_id:
        raise RuntimeError('Expected handoff tenant scope is missing')
    if before != after:
        raise RuntimeError('Candidate changes non-mount Compose configuration')
    services = {name: inspect(name)['Id'] for name in SUPPORT}
    (backup / 'support-services.json').write_text(json.dumps(services))
    (backup / 'release-path.txt').write_text(str(release) + '\n')
    (release / 'deploy').mkdir(mode=0o755)
    helper = release / 'deploy/pro-catalyst-handover-release.py'
    helper.write_bytes(Path(__file__).read_bytes())
    helper.chmod(0o644)

    if SLUG == 'pro-catalyst-handover':
        reset_script = release / 'deploy/pro-catalyst-handover-reset.cjs'
        reset_script.write_bytes((stage / 'deploy/pro-catalyst-handover-reset.cjs').read_bytes())
        reset_script.chmod(0o644)

    if any(sha(Path(name).read_bytes()) != digest for name, digest in input_hashes.items()) or inspect(APP)['Id'] != app['Id']:
        raise RuntimeError('Running app or Compose inputs changed during preparation')
    try:
        run(*candidate, 'up', '-d', '--no-deps', '--no-build', '--force-recreate', 'app', env=env)
        current = wait_healthy()
        if current['Image'] != app['Image'] or current['Config']['Labels']['com.docker.compose.project.config_files'] != ','.join(files + [str(overlay)]):
            raise RuntimeError('App image or Compose chain changed')
        if SCOPE_ENV + '=' + tenant_id not in current['Config']['Env']:
            raise RuntimeError('Live app is missing the handoff tenant scope')
        if any(inspect(name)['Id'] != identity for name, identity in services.items()):
            raise RuntimeError('Support service identity changed')
        for name, data in changed.items():
            if run('docker', 'exec', APP, 'sha256sum', '/app/' + name).split()[0] != sha(data):
                raise RuntimeError('Runtime file hash mismatch: ' + name)
        result = {'sourceCommit': commit, 'release': str(release), 'rollback': str(backup),
                  'image': current['Image'], 'composeInputs': len(files) + 1,
                  'envInputs': len(env_files), 'mounts': len(current['Mounts']),
                  'hashes': {name: sha(data) for name, data in changed.items()}}
        (backup / 'result.json').write_text(json.dumps(result, indent=2) + '\n')
        print(json.dumps(result))
    except Exception:
        run(*common, 'up', '-d', '--no-deps', '--no-build', '--force-recreate', 'app', env=env)
        wait_healthy()
        raise


def restore(backup):
    require_production_lock()
    files = (backup / 'compose-files.before.txt').read_text().splitlines()
    env_files = (backup / 'compose-env-files.before.txt').read_text().splitlines()
    release = Path((backup / 'release-path.txt').read_text().strip())
    overlay = release / f'compose.{SLUG}.json'
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
    for name, expected in REPLACED_FILES.items():
        if run('docker', 'exec', APP, 'sha256sum', '/app/' + name).split()[0] != expected:
            raise RuntimeError('Rollback file hash mismatch: ' + name)
    for name in NEW_FILES:
        run('docker', 'exec', APP, 'test', '!', '-e', '/app/' + name)
    for name, identity in json.loads((backup / 'support-services.json').read_text()).items():
        if inspect(name)['Id'] != identity:
            raise RuntimeError('Rollback support service changed')
    print(json.dumps({'rolledBack': str(release), 'appHealthy': True}))


def reset(backup):
    require_production_lock()
    release = Path((backup / 'release-path.txt').read_text().strip())
    overlay = release / f'compose.{SLUG}.json'
    if inspect(APP)['Config']['Labels']['com.docker.compose.project.config_files'].split(',')[-1] != str(overlay):
        raise RuntimeError('Expected handoff overlay is not active')
    source = (release / 'deploy/pro-catalyst-handover-reset.cjs').read_text()
    os.umask(0o077)
    with subprocess.Popen(['docker', 'exec', '-i', APP, 'node', '-e', source],
                          stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                          text=True) as process:
        first = json.loads(process.stdout.readline())
        if 'preimage' not in first:
            raise RuntimeError('Reset preflight failed: ' + first.get('error', 'UNKNOWN'))
        snapshot = backup / 'handoff-preimage.json'
        with snapshot.open('x') as saved:
            json.dump(first['preimage'], saved)
            saved.flush()
            os.fsync(saved.fileno())
        final, _ = process.communicate('PREIMAGE_SAVED\n', timeout=30)
        result = json.loads(final)
        if process.returncode or 'totals' not in result:
            raise RuntimeError('Handoff reset failed: ' + result.get('error', 'UNKNOWN'))
        result['preimageSha256'] = sha(snapshot.read_bytes())
        (backup / 'handoff-reset-result.json').write_text(json.dumps(result, indent=2) + '\n')
        print(json.dumps(result))


if __name__ == '__main__':
    if len(sys.argv) == 4 and sys.argv[1] in ('deploy', 'deploy-admissions', 'deploy-name-question', 'deploy-knowledge'):
        if sys.argv[1] == 'deploy-admissions':
            configure_admissions()
        elif sys.argv[1] == 'deploy-name-question':
            configure_name_question()
        elif sys.argv[1] == 'deploy-knowledge':
            configure_knowledge()
        deploy(Path(sys.argv[2]), sys.argv[3])
    elif len(sys.argv) == 3 and sys.argv[1] == 'reset':
        reset(Path(sys.argv[2]))
    elif len(sys.argv) == 3 and sys.argv[1] in ('restore', 'restore-admissions', 'restore-name-question', 'restore-knowledge'):
        if sys.argv[1] == 'restore-admissions':
            configure_admissions()
        elif sys.argv[1] == 'restore-name-question':
            configure_name_question()
        elif sys.argv[1] == 'restore-knowledge':
            configure_knowledge()
        restore(Path(sys.argv[2]))
    else:
        raise SystemExit('Usage: pro-catalyst-handover-release.py deploy[-admissions|-name-question|-knowledge] <stage> <commit> | reset <backup> | restore[-admissions|-name-question|-knowledge] <backup>')
