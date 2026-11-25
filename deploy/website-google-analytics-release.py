"""Guarded app-only release for consent-gated 7Network GA4 measurement.

Deploy on carsqatar-prod-01 under the production lock. The release mounts only
reviewed public website files and preserves every other active Compose input.
"""
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import time
from datetime import datetime, timezone

ROOT = Path('/opt/salemax')
APP = 'salemax-app-1'
BASE = '/opt/salemax/releases/training-pipeline-correction-v3-9867ca72-20261104'
PRIOR_VARS = ROOT / 'shared/rollback-private-inventory-84644fdfebee/compose-manual-vars.json'
EXPECTED_IMAGE = 'sha256:753d77d421b3160872df0812e7b38505a1db7104cdb9d6c8b17415b2420de667'
MEASUREMENT_ID = 'G-EJGL58NV96'
JS_VERSION = '20261125-ga4-consent1'
SOURCE_FILES = (
    'client/public/website/index.html',
    'client/public/website/website.js',
    'client/public/website/google-analytics-privacy.html',
    'modules/web/public-website.js',
)
PREIMAGE_HASHES = {
    'client/public/website/index.html': '8628703faa8a5c10f52854716d501b954957763af8b090596ca07bc97fbd3609',
    'client/public/website/website.js': '023e3e5398d38fbecbf76728791fb09f24464dfd96ae4df4d2ad7574500480dc',
    'modules/web/public-website.js': '0b2ab69f53ad4bf2af83dd5c4d8e69bac401dcc222a4d85cc7d3f283efee0961',
}
NEW_FILES = ('client/public/website/google-analytics-privacy.html',)


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


def panel_bounds(content):
    if content.count('id="analytics-consent"') != 1:
        raise RuntimeError('Unexpected analytics consent panel count')
    marker = content.index('id="analytics-consent"')
    start = content.rfind('<aside', 0, marker)
    close = content.find('</aside>', marker)
    if start < 0 or close < 0:
        raise RuntimeError('Could not isolate analytics consent panel')
    return start, close + len('</aside>')


def patch_live_index(live, source):
    source_start, source_end = panel_bounds(source)
    live_start, live_end = panel_bounds(live)
    source_panel = source[source_start:source_end]
    if source_panel.count('id="google-analytics-choice"') != 1:
        raise RuntimeError('Source GA4 consent choice is missing or duplicated')
    if 'id="google-analytics-choice"' in live:
        raise RuntimeError('Live GA4 consent is already present')

    script_pattern = re.compile(
        r'(<script\s+defer\s+src="/website/website\.js\?v=)[^"]+("\s*></script>)',
        re.I,
    )
    source_scripts = list(script_pattern.finditer(source))
    if len(source_scripts) != 1 or source_scripts[0].group(1) + JS_VERSION + source_scripts[0].group(2) != source_scripts[0].group(0):
        raise RuntimeError('Source website.js cache version is not the reviewed GA4 version')
    live, changed = script_pattern.subn(lambda match: match.group(1) + JS_VERSION + match.group(2), live)
    if changed != 1:
        raise RuntimeError('Expected one live website.js cache reference')
    live_start, live_end = panel_bounds(live)
    live = live[:live_start] + source_panel + live[live_end:]
    return live


def support_services():
    names = run(
        'docker', 'ps', '--filter', 'label=com.docker.compose.project=salemax',
        '--format', '{{.Names}}',
    ).splitlines()
    return {name: inspect(name)['Id'] for name in names if name and name != APP}


def verify_support_services(expected):
    if support_services() != expected:
        raise RuntimeError('A non-app service identity changed')


def check_stage(stage, commit):
    stage = stage.resolve(strict=True)
    if os.path.commonpath([str(ROOT / 'shared'), str(stage)]) != str(ROOT / 'shared'):
        raise RuntimeError('Stage must be under protected SaleMaX shared storage')
    manifest_path = stage / 'manifest.json'
    if not manifest_path.is_file() or manifest_path.is_symlink():
        raise RuntimeError('Stage manifest is missing or unsafe')
    manifest = json.loads(manifest_path.read_text())
    if manifest.get('commit') != commit:
        raise RuntimeError('Stage manifest source commit mismatch')
    hashes = {}
    for name in SOURCE_FILES:
        path = stage / name
        if path.is_symlink() or not path.is_file():
            raise RuntimeError('Missing or unsafe staged file: ' + name)
        hashes[name] = sha(path.read_bytes())
    if manifest.get('files') != hashes:
        raise RuntimeError('Staged file hashes do not match their manifest')
    index = (stage / 'client/public/website/index.html').read_text()
    js = (stage / 'client/public/website/website.js').read_text()
    notice = (stage / 'client/public/website/google-analytics-privacy.html').read_text()
    handler = (stage / 'modules/web/public-website.js').read_text()
    panel_start, panel_end = panel_bounds(index)
    panel = index[panel_start:panel_end]
    if index.count('/website/website.js?v=' + JS_VERSION) != 1:
        raise RuntimeError('Staged homepage is missing its GA4 JavaScript cache key')
    if panel.count('id="google-analytics-choice"') != 1 or panel.count('id="openai-analytics-choice"') != 1:
        raise RuntimeError('Staged consent choices are not independently available')
    if js.count(MEASUREMENT_ID) != 1 or 'googleAnalyticsConsent !== "granted"' not in js:
        raise RuntimeError('Staged GA4 loader or measurement ID is missing')
    if 'google-analytics-privacy.html' not in panel or 'enquiry form values' not in notice:
        raise RuntimeError('Staged GA4 privacy disclosure is incomplete')
    if 'https://www.googletagmanager.com' not in handler or 'https://*.google-analytics.com' not in handler:
        raise RuntimeError('Staged public website CSP does not allow the GA4 endpoints')
    return stage, hashes


def deploy(stage, commit):
    require_production_lock()
    if not re.fullmatch(r'[a-f0-9]{40}', commit):
        raise RuntimeError('Invalid source commit')
    stage, staged_hashes = check_stage(stage, commit)
    if os.path.realpath(ROOT / 'current') != BASE:
        raise RuntimeError('Active base release changed')
    os.umask(0o077)
    app = inspect(APP)
    if app['State'].get('Health', {}).get('Status') != 'healthy' or app['Image'] != EXPECTED_IMAGE:
        raise RuntimeError('Active app health or image differs from the reviewed baseline')
    labels = app['Config']['Labels']
    files = labels['com.docker.compose.project.config_files'].split(',')
    env_files = labels['com.docker.compose.project.environment_file'].split(',')
    workdir = labels['com.docker.compose.project.working_dir']
    active_inputs = files + env_files
    if not files or not env_files or not all(Path(path).is_file() for path in active_inputs):
        raise RuntimeError('Active Compose inputs are incomplete')
    if any(os.path.commonpath([str(ROOT), os.path.realpath(path)]) != str(ROOT)
           for path in active_inputs + [workdir]):
        raise RuntimeError('Active Compose inputs escape the SaleMaX release root')

    stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    release = ROOT / 'releases' / f'website-google-analytics-{commit[:12]}-{stamp}'
    backup = ROOT / 'shared' / f'rollback-website-google-analytics-{commit[:12]}-{stamp}'
    if release.exists() or backup.exists():
        raise RuntimeError('Release or rollback path already exists')
    release.mkdir(mode=0o755)
    backup.mkdir(mode=0o700)
    (backup / 'app-before.json').write_text(json.dumps({
        'Id': app['Id'], 'Image': app['Image'],
        'Health': app['State'].get('Health', {}).get('Status'),
        'RestartCount': app.get('RestartCount'),
    }))
    (backup / 'compose-files.before.txt').write_text('\n'.join(files) + '\n')
    (backup / 'compose-env-files.before.txt').write_text('\n'.join(env_files) + '\n')
    (backup / 'compose-working-dir.txt').write_text(workdir + '\n')
    (backup / 'base-release.txt').write_text(BASE + '\n')
    (backup / 'source-commit.txt').write_text(commit + '\n')
    input_hashes = {name: sha(Path(name).read_bytes()) for name in files + env_files}
    (backup / 'compose-input-hashes.json').write_text(json.dumps(input_hashes))
    (backup / 'staged-hashes.json').write_text(json.dumps(staged_hashes))

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

    runtime = release / 'runtime'
    runtime.mkdir(mode=0o755)
    changed = {}
    for name, expected in PREIMAGE_HASHES.items():
        target = '/app/' + name
        if run('docker', 'exec', APP, 'sha256sum', target).split()[0] != expected:
            raise RuntimeError('Live file changed: ' + name)
        saved = backup / 'preimages' / name
        saved.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        run('docker', 'cp', APP + ':' + target, str(saved))
        saved.chmod(0o600)
        if sha(saved.read_bytes()) != expected:
            raise RuntimeError('Preimage copy changed: ' + name)
        if name.endswith('/index.html'):
            live = saved.read_text()
            source = (stage / name).read_text()
            data = patch_live_index(live, source).encode('utf-8')
        else:
            data = (stage / name).read_bytes()
        output = runtime / name
        output.parent.mkdir(parents=True, exist_ok=True, mode=0o755)
        output.write_bytes(data)
        output.chmod(0o644)
        changed[name] = data

    absent_paths = []
    for name in NEW_FILES:
        target = '/app/' + name
        if run('docker', 'exec', APP, 'test', '!', '-e', target).strip():
            raise RuntimeError('Expected the new privacy notice path to be absent')
        absent_paths.append(name)
        data = (stage / name).read_bytes()
        output = runtime / name
        output.parent.mkdir(parents=True, exist_ok=True, mode=0o755)
        output.write_bytes(data)
        output.chmod(0o644)
        changed[name] = data
    (backup / 'absent-paths.txt').write_text('\n'.join(absent_paths) + '\n')

    mounts = [
        {'type': 'bind', 'source': str(runtime / name), 'target': '/app/' + name,
         'read_only': True, 'bind': {'create_host_path': False}}
        for name in changed
    ]
    overlay = release / 'compose.website-google-analytics.json'
    overlay.write_text(json.dumps({'services': {'app': {'image': app['Config']['Image'], 'volumes': mounts}}}))
    overlay.chmod(0o644)
    common = compose_args(files, env_files, workdir)
    candidate = common + ['-f', str(overlay)]
    before = json.loads(run(*common, 'config', '--format', 'json', env=dict(os.environ, **variables)))
    after = json.loads(run(*candidate, 'config', '--format', 'json', env=dict(os.environ, **variables)))
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
    if before != after:
        raise RuntimeError('Candidate changes non-mount Compose configuration')
    services = support_services()
    (backup / 'support-services.json').write_text(json.dumps(services))
    (backup / 'release-path.txt').write_text(str(release) + '\n')
    (release / 'deploy').mkdir(mode=0o755)
    (release / 'deploy/website-google-analytics-release.py').write_bytes(Path(__file__).read_bytes())
    (release / 'deploy/website-google-analytics-release.py').chmod(0o644)

    if any(sha(Path(name).read_bytes()) != digest for name, digest in input_hashes.items()) or inspect(APP)['Id'] != app['Id']:
        raise RuntimeError('Running app or Compose inputs changed during preparation')
    try:
        run(*candidate, 'up', '-d', '--no-deps', '--no-build', '--force-recreate', 'app', env=dict(os.environ, **variables))
        current = wait_healthy()
        if current['Image'] != app['Image'] or current['Config']['Labels']['com.docker.compose.project.config_files'] != ','.join(files + [str(overlay)]):
            raise RuntimeError('App image or Compose chain changed')
        verify_support_services(services)
        for name, data in changed.items():
            if run('docker', 'exec', APP, 'sha256sum', '/app/' + name).split()[0] != sha(data):
                raise RuntimeError('Runtime file hash mismatch: ' + name)
        result = {
            'sourceCommit': commit, 'release': str(release), 'rollback': str(backup),
            'image': current['Image'], 'composeInputs': len(files) + 1,
            'envInputs': len(env_files), 'mounts': len(current['Mounts']),
            'appHealth': current['State'].get('Health', {}).get('Status'),
            'appRestarts': current['RestartCount'],
            'hashes': {name: sha(data) for name, data in changed.items()},
        }
        (backup / 'result.json').write_text(json.dumps(result, indent=2) + '\n')
        print(json.dumps(result))
    except Exception:
        run(*common, 'up', '-d', '--no-deps', '--no-build', '--force-recreate', 'app', env=dict(os.environ, **variables))
        wait_healthy()
        raise


def restore(backup):
    require_production_lock()
    if os.path.realpath(ROOT / 'current') != (backup / 'base-release.txt').read_text().strip():
        raise RuntimeError('Production base release changed')
    files = (backup / 'compose-files.before.txt').read_text().splitlines()
    env_files = (backup / 'compose-env-files.before.txt').read_text().splitlines()
    release = Path((backup / 'release-path.txt').read_text().strip())
    overlay = release / 'compose.website-google-analytics.json'
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
    for name, expected in PREIMAGE_HASHES.items():
        if run('docker', 'exec', APP, 'sha256sum', '/app/' + name).split()[0] != expected:
            raise RuntimeError('Rollback file hash mismatch: ' + name)
    for name in (backup / 'absent-paths.txt').read_text().splitlines():
        if run('docker', 'exec', APP, 'test', '!', '-e', '/app/' + name).strip():
            raise RuntimeError('Rollback did not restore the absent path: ' + name)
    verify_support_services(json.loads((backup / 'support-services.json').read_text()))
    print(json.dumps({'rolledBack': str(release), 'appHealthy': True}))


if __name__ == '__main__':
    if len(sys.argv) == 4 and sys.argv[1] == 'deploy':
        deploy(Path(sys.argv[2]), sys.argv[3])
    elif len(sys.argv) == 3 and sys.argv[1] == 'restore':
        restore(Path(sys.argv[2]))
    else:
        raise SystemExit('Usage: website-google-analytics-release.py deploy <stage> <commit> | restore <backup>')
