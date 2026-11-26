"""Guarded app-only release for photo-only globe cards and tap-to-zoom.

Deploy on carsqatar-prod-01 under the production lock. The helper replaces only
the marked globe section/styles and the globe runtime asset on the active app.
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
VERSION = '20261125-network-globe2'
SOURCE_FILES = (
    'client/public/website/index.html',
    'client/public/website/website.css',
    'client/public/website/network-globe.js',
)
STAGE_FILES = SOURCE_FILES + ('deploy/website-network-globe-zoom-release.py',)
PREIMAGE_HASHES = {
    'client/public/website/index.html': '0202003c68c7a251a36f71ff80aaae81076a7291ce4bc5778e6854845964fede',
    'client/public/website/website.css': '1d3ffc311968eec09cf122adfb8a5223b39659275d9f2d5b9b779c9b5942bf3a',
    'client/public/website/network-globe.js': 'd7376d8cde6e5e45c486b701b06588e203f8c168e3f803f0b67600a88df0f1c0',
}
ASSETS = (
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


def marked_bounds(content, start, end, label):
    if content.count(start) != 1 or content.count(end) != 1:
        raise RuntimeError('Unexpected ' + label + ' marker count')
    first = content.index(start)
    last = content.index(end, first) + len(end)
    if first >= last:
        raise RuntimeError('Invalid ' + label + ' markers')
    return first, last


def extract_marked(content, start, end, label):
    first, last = marked_bounds(content, start, end, label)
    return content[first + len(start):last - len(end)].strip('\r\n')


def patch_live_index(live, source):
    source_block = extract_marked(source, SECTION_START, SECTION_END, 'source globe')
    section_pattern = re.compile(
        r'<section\b(?=[^>]*\bid=["\']connected-business["\'])[^>]*>.*?</section>',
        re.I | re.S,
    )
    source_sections = list(section_pattern.finditer(source_block))
    live_sections = list(section_pattern.finditer(live))
    if len(source_sections) != 1 or len(live_sections) != 1:
        raise RuntimeError('Source globe section does not match the reviewed structure')
    source_section = source_sections[0].group(0)
    if 'id="connected-business"' not in source_section or 'network-globe-viewer' in source_section:
        raise RuntimeError('Source globe section does not match the reviewed structure')
    if source.count('/website/website.css?v=' + VERSION) != 1:
        raise RuntimeError('Source stylesheet cache version is not current')
    if source.count('/website/network-globe.js?v=' + VERSION) != 1:
        raise RuntimeError('Source interaction cache version is not current')

    css_pattern = re.compile(
        r'(<link\b[^>]*\bhref=)(["\'])/website/website\.css(?:\?[^"\']*)?(["\'][^>]*>)',
        re.I | re.S,
    )
    live, css_count = css_pattern.subn(
        lambda match: match.group(1) + match.group(2) + '/website/website.css?v=' + VERSION + match.group(3),
        live,
    )
    js_pattern = re.compile(
        r'(<script\b[^>]*\bsrc=)(["\'])/website/network-globe\.js(?:\?[^"\']*)?(["\'][^>]*>)',
        re.I | re.S,
    )
    live, js_count = js_pattern.subn(
        lambda match: match.group(1) + match.group(2) + '/website/network-globe.js?v=' + VERSION + match.group(3),
        live,
    )
    if css_count != 1 or js_count != 1:
        raise RuntimeError('Expected one live globe CSS and JavaScript cache reference')
    live_section = section_pattern.search(live)
    return live[:live_section.start()] + source_section + live[live_section.end():]


def patch_live_css(live, source):
    source_block = extract_marked(source, CSS_START, CSS_END, 'source globe CSS')
    if '.network-globe-viewer {' not in source_block or '.network-globe-card:hover' not in source_block:
        raise RuntimeError('Source globe styles are incomplete')
    if live.count('.network-showcase {') != 1:
        raise RuntimeError('Expected one current public globe stylesheet block')
    live_start = live.index('.network-showcase {')
    end_pattern = re.compile(
        r'@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{\s*'
        r'\.network-globe-card-inner,\s*\.network-globe-toggle\s*'
        r'\{\s*transition:\s*none;\s*\}\s*\}\s*$',
        re.S,
    )
    live_end = end_pattern.search(live)
    if not live_end or live_start >= live_end.start():
        raise RuntimeError('Could not isolate the current public globe stylesheet block')
    return live[:live_start] + source_block.strip() + '\n'


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
    if manifest_path.is_symlink() or not manifest_path.is_file():
        raise RuntimeError('Stage manifest is missing or unsafe')
    manifest = json.loads(manifest_path.read_text())
    if manifest.get('commit') != commit:
        raise RuntimeError('Stage manifest source commit mismatch')
    hashes = {}
    for name in STAGE_FILES:
        path = stage / name
        if path.is_symlink() or not path.is_file():
            raise RuntimeError('Missing or unsafe staged file: ' + name)
        hashes[name] = sha(path.read_bytes())
    if manifest.get('files') != hashes:
        raise RuntimeError('Stage hashes do not match their manifest')

    index = (stage / 'client/public/website/index.html').read_text()
    css = (stage / 'client/public/website/website.css').read_text()
    js = (stage / 'client/public/website/network-globe.js').read_text()
    marked_bounds(index, SECTION_START, SECTION_END, 'source globe')
    marked_bounds(css, CSS_START, CSS_END, 'source globe CSS')
    if index.count('/website/website.css?v=' + VERSION) != 1 or index.count('/website/network-globe.js?v=' + VERSION) != 1:
        raise RuntimeError('Staged homepage is missing the current cache keys')
    if '.network-globe-card--feature' in js or 'loading = "eager"' not in js:
        raise RuntimeError('Staged globe must use eagerly loaded photo-only cards')
    if 'function openViewer' not in js or 'viewer.showModal()' not in js:
        raise RuntimeError('Staged globe has no accessible photo viewer')
    if any('/website/media/network-globe/' + Path(name).name not in js for name in ASSETS):
        raise RuntimeError('Staged globe is missing a reviewed photo source')
    return stage, hashes


def compose_variables(app, files, env_files):
    manual = json.loads(PRIOR_VARS.read_text())
    supplied = {
        key
        for name in env_files
        for key in re.findall(r'^\s*([A-Za-z_][A-Za-z0-9_]*)=', Path(name).read_text(), re.M)
    }
    referenced = {
        key
        for name in files
        for key in re.findall(r'\$\{([A-Za-z_][A-Za-z0-9_]*)', Path(name).read_text())
    }
    live_env = dict(item.split('=', 1) for item in app['Config']['Env'] if '=' in item)
    variables = {}
    for key in referenced - supplied:
        if key in manual:
            variables[key] = manual[key]
        elif key in live_env:
            variables[key] = live_env[key]
        else:
            raise RuntimeError('Missing Compose interpolation variable')
    return variables


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
    release = ROOT / 'releases' / f'website-network-globe-zoom-{commit[:12]}-{stamp}'
    backup = ROOT / 'shared' / f'rollback-website-network-globe-zoom-{commit[:12]}-{stamp}'
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
    input_hashes = {name: sha(Path(name).read_bytes()) for name in active_inputs}
    (backup / 'compose-input-hashes.json').write_text(json.dumps(input_hashes))
    (backup / 'staged-hashes.json').write_text(json.dumps(staged_hashes))

    variables = compose_variables(app, files, env_files)
    (backup / 'compose-vars.json').write_text(json.dumps(variables))
    (backup / 'preimage-hashes.json').write_text(json.dumps(PREIMAGE_HASHES))

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
        source = (stage / name).read_text() if name.endswith(('.html', '.css')) else None
        if name.endswith('/index.html'):
            data = patch_live_index(saved.read_text(), source).encode('utf-8')
        elif name.endswith('/website.css'):
            data = patch_live_css(saved.read_text(), source).encode('utf-8')
        else:
            data = (stage / name).read_bytes()
        output = runtime / name
        output.parent.mkdir(parents=True, exist_ok=True, mode=0o755)
        output.write_bytes(data)
        output.chmod(0o644)
        changed[name] = data

    for name in ASSETS:
        target = '/app/' + name
        if run('docker', 'exec', APP, 'test', '-s', target).strip():
            raise RuntimeError('A deployed globe photo is missing: ' + name)

    mounts = [
        {'type': 'bind', 'source': str(runtime / name), 'target': '/app/' + name,
         'read_only': True, 'bind': {'create_host_path': False}}
        for name in changed
    ]
    overlay = release / 'compose.website-network-globe-zoom.json'
    overlay.write_text(json.dumps({'services': {'app': {'image': app['Config']['Image'], 'volumes': mounts}}}))
    overlay.chmod(0o644)
    common = compose_args(files, env_files, workdir)
    env = dict(os.environ, **variables)
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
    helper = release / 'deploy/website-network-globe-zoom-release.py'
    helper.write_bytes(Path(__file__).read_bytes())
    helper.chmod(0o644)

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
    overlay = release / 'compose.website-network-globe-zoom.json'
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
    for name, expected in json.loads((backup / 'preimage-hashes.json').read_text()).items():
        if run('docker', 'exec', APP, 'sha256sum', '/app/' + name).split()[0] != expected:
            raise RuntimeError('Rollback file hash mismatch: ' + name)
    verify_support_services(json.loads((backup / 'support-services.json').read_text()))
    print(json.dumps({'rolledBack': str(release), 'appHealthy': True}))


if __name__ == '__main__':
    if len(sys.argv) == 4 and sys.argv[1] == 'deploy':
        deploy(Path(sys.argv[2]), sys.argv[3])
    elif len(sys.argv) == 3 and sys.argv[1] == 'restore':
        restore(Path(sys.argv[2]))
    else:
        raise SystemExit('Usage: website-network-globe-zoom-release.py deploy <stage> <commit> | restore <backup>')
