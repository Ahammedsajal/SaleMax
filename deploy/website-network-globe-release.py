"""Guarded app-only overlay for the interactive 7Network website globe.

Deploy on carsqatar-prod-01 under the production lock. The overlay mounts only
the reviewed website HTML, CSS, JavaScript and photo assets; it does not rebuild the image or touch data.
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
SOURCE_FILES = (
    'client/public/website/index.html',
    'client/public/website/website.css',
)
OLD_HASHES = {
    'client/public/website/index.html': '0ea85fa217d490f1a3f2001f81664bb4cbfa48b8ea506aaa21cc599829554f94',
    'client/public/website/website.css': '4fbaa3ab414ff87f94246f2842f42a44ce882a115a31b7609d3c28973e169c39',
}
NEW_FILES = (
    'client/public/website/network-globe.js',
    'client/public/website/media/network-globe/agency-workshop.webp',
    'client/public/website/media/network-globe/auto-service.webp',
    'client/public/website/media/network-globe/bakery-team.webp',
    'client/public/website/media/network-globe/cafe-service.webp',
    'client/public/website/media/network-globe/customer-support.webp',
    'client/public/website/media/network-globe/event-coordination.webp',
    'client/public/website/media/network-globe/home-goods-retail.webp',
    'client/public/website/media/network-globe/property-consultation.webp',
    'client/public/website/media/network-globe/retail-boutique.webp',
    'client/public/website/media/network-globe/salon-consultation.webp',
    'client/public/website/media/network-globe/trainer-class.webp',
    'client/public/website/media/network-globe/training-workshop.webp',
)
EXPECTED_IMAGE = 'sha256:753d77d421b3160872df0812e7b38505a1db7104cdb9d6c8b17415b2420de667'
CSS_VERSION = '20261125-network-globe1'
SCRIPT_TAG = '<script defer src="/website/network-globe.js?v=20261125-network-globe1"></script>'
SECTION_START = '<!-- network-globe:begin -->'
SECTION_END = '<!-- network-globe:end -->'
CSS_START = '/* network-globe:begin */'
CSS_END = '/* network-globe:end */'


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


def extract_marked(content, start, end, label):
    if content.count(start) != 1 or content.count(end) != 1:
        raise RuntimeError('Unexpected ' + label + ' source marker count')
    value = content.split(start, 1)[1].split(end, 1)[0].strip('\r\n')
    if not value.strip():
        raise RuntimeError('Empty ' + label + ' source block')
    return value


def patch_live_index(live, source):
    section = extract_marked(source, SECTION_START, SECTION_END, 'globe section')
    if section.count('id="connected-business"') != 1 or section.count('id="solutions"'):
        raise RuntimeError('Globe section markup is not unique')
    if 'network-globe.js' in live or 'connected-business' in live:
        raise RuntimeError('Live homepage already contains a network globe')

    css_link = re.compile(
        r'(<link\b[^>]*\bhref=)(["\'])/website/website\.css(?:\?[^"\']*)?(["\'][^>]*>)',
        re.I | re.S,
    )
    live, changed = css_link.subn(
        lambda match: match.group(1) + match.group(2) + '/website/website.css?v='
        + CSS_VERSION + match.group(3),
        live,
    )
    if changed != 1:
        raise RuntimeError('Expected one live website.css reference')
    if live.count('</head>') != 1:
        raise RuntimeError('Expected one live homepage head close')
    live = live.replace('</head>', '    ' + SCRIPT_TAG + '\n  </head>', 1)

    anchor = re.compile(
        r'(?m)^(?P<indent>[ \t]*)<section\b(?=[^>]*\bid=["\']solutions["\'])[^>]*>'
    )
    matches = list(anchor.finditer(live))
    if len(matches) != 1:
        raise RuntimeError('Expected one live Solutions section anchor')
    match = matches[0]
    live = live[:match.start()] + section + '\n' + live[match.start():]
    return live


def append_live_css(live, source):
    css = extract_marked(source, CSS_START, CSS_END, 'globe stylesheet')
    if '.network-showcase {' not in css or '.network-globe-card:hover' not in css:
        raise RuntimeError('Globe stylesheet is incomplete')
    if '.network-showcase {' in live or '.network-globe-card' in live:
        raise RuntimeError('Live website CSS already contains globe styles')
    return live.rstrip() + '\n\n' + css + '\n'


def support_services():
    names = run(
        'docker', 'ps', '--filter', 'label=com.docker.compose.project=salemax',
        '--format', '{{.Names}}',
    ).splitlines()
    return {
        name: inspect(name)['Id']
        for name in names if name and name != APP
    }


def verify_support_services(expected):
    if support_services() != expected:
        raise RuntimeError('A non-app service identity changed')


def deploy(stage, commit):
    require_production_lock()
    if os.path.realpath(ROOT / 'current') != BASE:
        raise RuntimeError('Active base release changed')
    if not re.fullmatch(r'[a-f0-9]{40}', commit):
        raise RuntimeError('Invalid source commit')
    stage = stage.resolve(strict=True)
    if os.path.commonpath([str(ROOT / 'shared'), str(stage)]) != str(ROOT / 'shared'):
        raise RuntimeError('Stage must be under protected SaleMaX shared storage')
    if any((stage / name).is_symlink() for name in SOURCE_FILES + NEW_FILES):
        raise RuntimeError('Staged website assets must be regular files')
    if not all((stage / name).is_file() for name in SOURCE_FILES + NEW_FILES):
        raise RuntimeError('Staging directory is missing reviewed website assets')
    source_index = (stage / 'client/public/website/index.html').read_text()
    source_css = (stage / 'client/public/website/website.css').read_text()
    extract_marked(source_index, SECTION_START, SECTION_END, 'globe section')
    extract_marked(source_css, CSS_START, CSS_END, 'globe stylesheet')
    if source_index.count(SCRIPT_TAG) != 1 or source_index.count('website.css?v=' + CSS_VERSION) != 1:
        raise RuntimeError('Source homepage is missing the globe asset references')
    if len([name for name in NEW_FILES if name.endswith('.webp')]) != 12:
        raise RuntimeError('Expected twelve generated business-scene images')
    if any(
        not (stage / name).read_bytes().startswith(b'RIFF')
        or b'WEBP' not in (stage / name).read_bytes()[:16]
        for name in NEW_FILES if name.endswith('.webp')
    ):
        raise RuntimeError('A staged business-scene image is not a WebP file')
    if not (stage / 'client/public/website/network-globe.js').read_bytes():
        raise RuntimeError('Globe interaction script is empty')
    os.umask(0o077)
    app = inspect(APP)
    if app['State'].get('Health', {}).get('Status') != 'healthy' or app['Image'] != EXPECTED_IMAGE:
        raise RuntimeError('Active app health or image differs from the reviewed baseline')
    labels = app['Config']['Labels']
    files = labels['com.docker.compose.project.config_files'].split(',')
    env_files = labels['com.docker.compose.project.environment_file'].split(',')
    workdir = labels['com.docker.compose.project.working_dir']
    active_inputs = files + env_files
    if not files or not env_files or not all(Path(p).is_file() for p in active_inputs):
        raise RuntimeError('Active Compose inputs are incomplete')
    if any(os.path.commonpath([str(ROOT), os.path.realpath(path)]) != str(ROOT)
           for path in active_inputs + [workdir]):
        raise RuntimeError('Active Compose inputs escape the SaleMaX release root')

    stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    release = ROOT / 'releases' / f'website-network-globe-{commit[:12]}-{stamp}'
    backup = ROOT / 'shared' / f'rollback-website-network-globe-{commit[:12]}-{stamp}'
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
    for name, expected in OLD_HASHES.items():
        target = '/app/' + name
        if run('docker', 'exec', APP, 'sha256sum', target).split()[0] != expected:
            raise RuntimeError('Live file changed: ' + name)
        saved = backup / 'preimages' / name
        saved.parent.mkdir(parents=True, exist_ok=True)
        run('docker', 'cp', APP + ':' + target, str(saved))
        if sha(saved.read_bytes()) != expected:
            raise RuntimeError('Preimage copy changed: ' + name)
        if name.endswith('/index.html'):
            data = patch_live_index(saved.read_text(), source_index).encode('utf-8')
        else:
            data = append_live_css(saved.read_text(), source_css).encode('utf-8')
        output = runtime / name
        output.parent.mkdir(parents=True, exist_ok=True, mode=0o755)
        output.write_bytes(data)
        output.chmod(0o644)
        changed[name] = data

    absent_paths = []
    for name in NEW_FILES:
        target = '/app/' + name
        if run('docker', 'exec', APP, 'test', '!', '-e', target).strip():
            raise RuntimeError('Expected the new website asset path to be absent: ' + name)
        absent_paths.append(name)
        data = (stage / name).read_bytes()
        output = runtime / name
        output.parent.mkdir(parents=True, exist_ok=True, mode=0o755)
        output.write_bytes(data)
        output.chmod(0o644)
        changed[name] = data
    (backup / 'absent-paths.txt').write_text('\n'.join(absent_paths) + '\n')

    mounts = [{'type': 'bind', 'source': str(runtime / name), 'target': '/app/' + name,
               'read_only': True, 'bind': {'create_host_path': False}} for name in changed]
    overlay = release / 'compose.website-network-globe.json'
    overlay.write_text(json.dumps({'services': {'app': {'image': app['Config']['Image'], 'volumes': mounts}}}))
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
    if before != after:
        raise RuntimeError('Candidate changes non-mount Compose configuration')
    services = support_services()
    (backup / 'support-services.json').write_text(json.dumps(services))
    (backup / 'release-path.txt').write_text(str(release) + '\n')
    (release / 'deploy').mkdir(mode=0o755)
    (release / 'deploy/website-network-globe-release.py').write_bytes(Path(__file__).read_bytes())
    (release / 'deploy/website-network-globe-release.py').chmod(0o644)

    if any(sha(Path(name).read_bytes()) != digest for name, digest in input_hashes.items()) or inspect(APP)['Id'] != app['Id']:
        raise RuntimeError('Running app or Compose inputs changed during preparation')
    try:
        run(*candidate, 'up', '-d', '--no-deps', '--no-build', '--force-recreate', 'app', env=env)
        current = wait_healthy()
        if current['Image'] != app['Image'] or current['Config']['Labels']['com.docker.compose.project.config_files'] != ','.join(files + [str(overlay)]):
            raise RuntimeError('App image or Compose chain changed')
        verify_support_services(services)
        for name, data in changed.items():
            if run('docker', 'exec', APP, 'sha256sum', '/app/' + name).split()[0] != sha(data):
                raise RuntimeError('Runtime file hash mismatch: ' + name)
        result = {'sourceCommit': commit, 'release': str(release), 'rollback': str(backup),
                  'image': current['Image'], 'composeInputs': len(files) + 1,
                  'envInputs': len(env_files), 'mounts': len(current['Mounts']),
                  'appHealth': current['State'].get('Health', {}).get('Status'),
                  'appRestarts': current['RestartCount'],
                  'hashes': {name: sha(data) for name, data in changed.items()}}
        (backup / 'result.json').write_text(json.dumps(result, indent=2) + '\n')
        print(json.dumps(result))
    except Exception:
        run(*common, 'up', '-d', '--no-deps', '--no-build', '--force-recreate', 'app', env=env)
        wait_healthy()
        raise


def restore(backup):
    require_production_lock()
    if os.path.realpath(ROOT / 'current') != (backup / 'base-release.txt').read_text().strip():
        raise RuntimeError('Production base release changed')
    files = (backup / 'compose-files.before.txt').read_text().splitlines()
    env_files = (backup / 'compose-env-files.before.txt').read_text().splitlines()
    release = Path((backup / 'release-path.txt').read_text().strip())
    overlay = release / 'compose.website-network-globe.json'
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
    for name, expected in OLD_HASHES.items():
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
        raise SystemExit('Usage: website-network-globe-release.py deploy <stage> <commit> | restore <backup>')
