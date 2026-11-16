"""Safely clear stale Pro Catalyst system pauses after all live handoffs reset."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import time

ROOT = Path('/opt/salemax')
APP = 'salemax-app-1'
BASE = '/opt/salemax/releases/training-pipeline-correction-v3-9867ca72-20261104'
RELEASE = ROOT / 'releases/pro-catalyst-qatar-required-3a93aa8541a8-20261116'
OVERLAY = str(RELEASE / 'compose.pro-catalyst-qatar-required.json')
EXPECTED_IMAGE = 'sha256:753d77d421b3160872df0812e7b38505a1db7104cdb9d6c8b17415b2420de667'
BACKUP = ROOT / 'shared/rollback-pro-catalyst-system-pause-reset-3a93aa857a62-20261116'
SUPPORT = ('salemax-db-1', 'salemax-report-worker-1', 'salemax-libretranslate-1',
           'salemax-recruitment-founder-notification-worker-1', 'salemax-bot-lead-test-db')


def run(*args):
    result = subprocess.run(args, capture_output=True, text=True)
    if result.returncode:
        raise RuntimeError(f'{args[0]} failed with status {result.returncode}')
    return result.stdout


def inspect(name):
    return json.loads(run('docker', 'inspect', name))[0]


def require_lock():
    if os.geteuid() != 0 or os.environ.get('SALEMAX_DEPLOY_LOCK_HELD') != '1':
        raise RuntimeError('Protected production lock required')
    if run('hostname').strip() != 'carsqatar-prod-01':
        raise RuntimeError('Unexpected production host')
    if os.path.realpath(ROOT / 'current') != BASE:
        raise RuntimeError('Active base release changed')


def reset(source):
    require_lock()
    app = inspect(APP)
    labels = app['Config']['Labels']
    if app['State'].get('Health', {}).get('Status') != 'healthy' or app['Image'] != EXPECTED_IMAGE:
        raise RuntimeError('Active app health or image differs from the reviewed baseline')
    if labels.get('com.docker.compose.project.config_files', '').split(',')[-1] != OVERLAY:
        raise RuntimeError('Expected Pro Catalyst callback overlay is not active')
    if not source.is_file() or BACKUP.exists():
        raise RuntimeError('Reset source is missing or snapshot path already exists')

    os.umask(0o077)
    BACKUP.mkdir(mode=0o700)
    (BACKUP / 'release-path.txt').write_text(str(RELEASE) + '\n')
    (BACKUP / 'active-app.json').write_text(json.dumps({
        'containerId': app['Id'], 'image': app['Image'], 'baseRelease': BASE,
        'composeInputs': len(labels['com.docker.compose.project.config_files'].split(',')),
    }, indent=2) + '\n')
    support = {name: inspect(name)['Id'] for name in SUPPORT}
    (BACKUP / 'support-services.json').write_text(json.dumps(support, indent=2) + '\n')

    script = RELEASE / 'deploy/pro-catalyst-handover-system-pause-reset.cjs'
    data = source.read_bytes()
    if script.exists() and hashlib.sha256(script.read_bytes()).hexdigest() != hashlib.sha256(data).hexdigest():
        raise RuntimeError('A different reset script already exists in the active release')
    script.write_bytes(data)
    script.chmod(0o644)
    source_hash = hashlib.sha256(data).hexdigest()

    with subprocess.Popen(['docker', 'exec', '-i', APP, 'node', '-e', data.decode()],
                          stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                          stderr=subprocess.DEVNULL, text=True) as process:
        first = json.loads(process.stdout.readline())
        if 'preimage' not in first:
            raise RuntimeError('Reset preflight failed: ' + first.get('error', 'UNKNOWN'))
        snapshot = BACKUP / 'system-pause-preimage.json'
        with snapshot.open('x') as saved:
            json.dump(first['preimage'], saved)
            saved.flush()
            os.fsync(saved.fileno())
        final, _ = process.communicate('PREIMAGE_SAVED\n', timeout=30)
        result = json.loads(final)
        if process.returncode or 'controlsReset' not in result:
            raise RuntimeError('Stale pause reset failed: ' + result.get('error', 'UNKNOWN'))
        result['preimageSha256'] = hashlib.sha256(snapshot.read_bytes()).hexdigest()
        result['resetScriptSha256'] = source_hash
        (BACKUP / 'system-pause-reset-result.json').write_text(json.dumps(result, indent=2) + '\n')

    after = inspect(APP)
    if after['Id'] != app['Id'] or after['State'].get('Health', {}).get('Status') != 'healthy':
        raise RuntimeError('App container identity or health changed during reset')
    if any(inspect(name)['Id'] != identity for name, identity in support.items()):
        raise RuntimeError('A supporting service identity changed during reset')
    print(json.dumps(result))


if __name__ == '__main__':
    if len(sys.argv) != 2:
        raise SystemExit('Usage: pro-catalyst-handover-system-pause-reset.py <reset-script.cjs>')
    reset(Path(sys.argv[1]))
