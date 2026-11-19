#!/usr/bin/env python3
"""Expose the existing Retail Connected Stores screen through a guarded app overlay."""
import copy
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import time

ROOT = Path('/opt/salemax')
APP = 'salemax-app-1'
DB = 'salemax-db-1'
WORKER = 'salemax-report-worker-1'
BASE = '/opt/salemax/releases/training-pipeline-correction-v3-9867ca72-20261104'
EXPECTED_IMAGE = 'sha256:753d77d421b3160872df0812e7b38505a1db7104cdb9d6c8b17415b2420de667'
EXPECTED_INDEX_SHA = 'e910aba4ca3a7c6d43834d7f3e363610e818561bb3a66f4bfcb37abbdd5482ed'
EXPECTED_RETAIL_SHA = 'b539e129d74dddb6a7fe27ebd0c37be4a88b190aed4f6874c597cc31b1b3f535'
EXPECTED_STAGE_RETAIL_SHA = EXPECTED_RETAIL_SHA
RETAIL_SCRIPT_URL = '/retail-workspace.js?v=20261116-essentials-admin1'
SUPPORT = ('salemax-db-1', 'salemax-report-worker-1', 'salemax-libretranslate-1',
           'salemax-recruitment-founder-notification-worker-1', 'salemax-bot-lead-test-db')
INDEX_MARKER = b'<script defer src="/business-inventory.js?v=1"></script>'
INDEX_INSERT = INDEX_MARKER + b'<script defer src="' + RETAIL_SCRIPT_URL.encode('ascii') + b'"></script>'


def run(*args, env=None, timeout=300):
    result = subprocess.run(args, env=env, capture_output=True, text=True, timeout=timeout)
    if result.returncode:
        raise RuntimeError(f'{Path(args[0]).name} failed ({result.returncode})')
    return result.stdout


def sha(data):
    return hashlib.sha256(data).hexdigest()


def inspect(name):
    return json.loads(run('docker', 'inspect', name))[0]


def replace_once(source, old, new, label):
    if source.count(old) != 1:
        raise RuntimeError('Retail UI preimage changed at ' + label)
    return source.replace(old, new, 1)


def prepare_index(source):
    if source.count(INDEX_MARKER) != 1 or b'retail-workspace.js?v=' in source:
        raise RuntimeError('Production shell Retail insertion point changed')
    return source.replace(INDEX_MARKER, INDEX_INSERT, 1)


def replace_translation(source, old_en, new_en, new_ar, label):
    pattern = re.compile(r"t\('" + re.escape(old_en) + r"','([^']*)'\)")
    updated, count = pattern.subn("t('" + new_en + "','" + new_ar + "')", source)
    if count != 1:
        raise RuntimeError('Retail UI preimage changed at ' + label)
    return updated


def prepare_retail_js(source):
    source = source.decode('utf-8')
    translations = (
        ('Connect your existing Shopify or WooCommerce store. Imported data stays in this business workspace; it does not change 7Network stock, fulfilment, accounting or customer messages.',
         'Connect the store to this 7Network business workspace. Read-only sync imports products, orders and customers; it does not edit storefront pages, checkout, payment settings, prices, stock or orders. Customer messages stay off.',
         'اربط المتجر بمساحة عمل النشاط هذه في 7Network. تستورد المزامنة للقراءة فقط المنتجات والمتغيرات والطلبات والعملاء؛ ولا تعدّل صفحات المتجر أو الدفع أو إعدادات الدفع أو الأسعار أو المخزون أو الطلبات. تظل رسائل العملاء متوقفة.',
         'connection scope copy'),
        ('Create a dedicated read-only WooCommerce REST API key over HTTPS. Checkout abandonment capture uses the optional 7Network plugin; standard WooCommerce webhooks keep orders, customers and products current.',
         'Use a dedicated read-only WooCommerce REST key. The key is sent over HTTPS and stored encrypted in 7Network. This admin connection does not add storefront or checkout fields or change payment settings. After the first full sync reconciles, the owner can configure signed product, order and customer webhooks in WooCommerce admin; that setup changes admin settings only. The optional checkout-event plugin is separate and is not needed for catalog/order sync.',
         'استخدم مفتاح REST مخصصاً للقراءة فقط في WooCommerce. يُرسل المفتاح عبر HTTPS ويُخزّن مشفراً في 7Network. لا يضيف هذا الربط الإداري حقولاً للمتجر أو الدفع ولا يغيّر إعدادات الدفع. بعد اكتمال أول مزامنة ومطابقتها، يمكن للمالك إعداد Webhooks موقّعة للمنتجات والطلبات والعملاء من لوحة WooCommerce؛ وهذا يغيّر إعدادات الإدارة فقط. إضافة أحداث الدفع اختيارية ومنفصلة وليست مطلوبة لمزامنة المنتجات والطلبات.',
         'WooCommerce connection copy'),
        ('Save this webhook secret now', 'Save the signing secret for later webhook setup',
         'احفظ سر التوقيع لإعداد Webhook لاحقاً', 'webhook secret heading'),
        ('Use it for the WooCommerce order/customer/product webhooks and the abandoned-checkout plugin. You can reveal it later from the setup panel, and the value is never saved in this browser.',
         'This secret signs incoming product, order and customer events only. It is not needed for read-only sync. Wait for the first import to reconcile before configuring webhooks. Leave the optional checkout-event plugin endpoint blank; no customer messages are sent.',
         'يوقّع هذا السر استقبال أحداث المنتجات والطلبات والعملاء فقط. لا يلزم للمزامنة للقراءة فقط. انتظر مطابقة أول استيراد قبل إعداد Webhooks. اترك نقطة اتصال إضافة أحداث الدفع الاختيارية فارغة؛ ولا ترسل رسائل للعملاء.',
         'webhook secret scope copy'),
        ('WooCommerce connected. Set up its signed webhooks next.',
         'WooCommerce connected. API credentials were cleared from the form and stored encrypted. Read-only sync has not started.',
         'تم ربط WooCommerce. مُسحت بيانات API من النموذج وخُزنت مشفرة. لم تبدأ المزامنة للقراءة فقط بعد.',
         'connected status copy'),
        ('In WooCommerce, create active webhooks for the listed topics. Install the downloaded plugin ZIP in WordPress and activate it; then put the signed endpoint and secret into its settings for checkout events. Import remains read only. The plugin supports classic checkout, not Checkout Blocks.',
         'These signed webhooks keep the 7Network copy current. Configure product, order and customer topics in WooCommerce admin only after the first import reconciles. This changes admin settings only; it does not change storefront pages, checkout, checkout fields or payment settings. The optional checkout-event plugin is not needed for product or order sync; keep its endpoint blank and do not enable customer messages.',
         'تحافظ Webhooks الموقّعة هذه على تحديث نسخة 7Network. أعدّ مواضيع المنتجات والطلبات والعملاء في لوحة WooCommerce بعد مطابقة أول استيراد فقط. يغيّر ذلك إعدادات الإدارة فقط؛ ولا يغيّر صفحات المتجر أو الدفع أو حقول الدفع أو إعدادات الدفع. إضافة أحداث الدفع الاختيارية غير مطلوبة لمزامنة المنتجات أو الطلبات؛ اترك نقطة اتصالها فارغة ولا تفعّل رسائل العملاء.',
         'webhook setup copy'),
    )
    for old_en, new_en, new_ar, label in translations:
        source = replace_translation(source, old_en, new_en, new_ar, label)
    source = replace_once(
        source,
        "if(result.abandonedCheckoutPlugin){const link=add(area,'a',t('Download the WooCommerce abandoned-checkout plugin'",
        "if(result.abandonedCheckoutPlugin&&connection.provider!=='woocommerce'){const link=add(area,'a',t('Download the WooCommerce abandoned-checkout plugin'",
        'checkout plugin link')
    if 'Install the downloaded plugin ZIP in WordPress' in source:
        raise RuntimeError('Checkout plugin installation instructions remain in WooCommerce setup')
    return source.encode('utf-8')


def compose_args(files, env_files, workdir):
    args = ['docker', 'compose', '--project-name', 'salemax', '--project-directory', workdir]
    for name in env_files:
        args += ['--env-file', name]
    for name in files:
        args += ['-f', name]
    return args


def compose_meta(app):
    labels = app.get('Config', {}).get('Labels') or {}
    if labels.get('com.docker.compose.project') != 'salemax' or labels.get('com.docker.compose.service') != 'app':
        raise RuntimeError('Unexpected app service identity')
    files = labels.get('com.docker.compose.project.config_files', '').split(',')
    env_files = labels.get('com.docker.compose.project.environment_file', '').split(',')
    workdir = labels.get('com.docker.compose.project.working_dir')
    if not files or not env_files or not workdir or not all(Path(p).is_file() for p in files + env_files):
        raise RuntimeError('Active Compose inputs are incomplete')
    return {'files': files, 'env_files': env_files, 'workdir': workdir}


def compose_environment(app, meta):
    live = dict(item.split('=', 1) for item in app['Config'].get('Env', []) if '=' in item)
    supplied = {key for path in meta['env_files'] for key in re.findall(r'^\s*([A-Za-z_][A-Za-z0-9_]*)=', Path(path).read_text(), re.M)}
    referenced = {key for path in meta['files'] for key in re.findall(r'\$\{([A-Za-z_][A-Za-z0-9_]*)', Path(path).read_text())}
    manual_path = ROOT / 'shared/rollback-private-inventory-84644fdfebee/compose-manual-vars.json'
    manual = json.loads(manual_path.read_text()) if manual_path.is_file() else {}
    values = {}
    for key in referenced - supplied:
        if key in manual:
            values[key] = manual[key]
        elif key in live:
            values[key] = live[key]
        else:
            raise RuntimeError('Missing Compose interpolation variable')
    env = dict(os.environ)
    for key in referenced:
        env.pop(key, None)
    env.update(values)
    return env, values


def wait_healthy():
    for _ in range(60):
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


def deploy(stage, commit):
    require_lock()
    if not re.fullmatch(r'[a-f0-9]{40}', commit):
        raise RuntimeError('Invalid source commit')
    stage = Path(stage).resolve()
    staged_js = stage / 'client/public/retail-workspace.js'
    if not staged_js.is_file() or sha(staged_js.read_bytes()) != EXPECTED_STAGE_RETAIL_SHA:
        raise RuntimeError('Staged Retail screen is not the reviewed production source')
    app = inspect(APP)
    db = inspect(DB)
    if app['State'].get('Health', {}).get('Status') != 'healthy' or app['Image'] != EXPECTED_IMAGE:
        raise RuntimeError('App health or image differs from the reviewed baseline')
    if db['State'].get('Health', {}).get('Status') != 'healthy' or inspect(WORKER)['State'].get('Status') != 'running':
        raise RuntimeError('Database or report worker is not healthy')
    if shutil.disk_usage(ROOT).free < 2 * 1024**3:
        raise RuntimeError('Insufficient free space for guarded release')
    meta = compose_meta(app)
    env, variables = compose_environment(app, meta)
    release = ROOT / 'releases' / f'retail-connected-stores-{commit[:12]}-20261116'
    backup = ROOT / 'shared' / f'rollback-retail-connected-stores-{commit[:12]}-20261116'
    if release.exists() or backup.exists():
        raise RuntimeError('Release or rollback path already exists')
    os.umask(0o077)
    release.mkdir(mode=0o755)
    backup.mkdir(mode=0o700)
    (backup / 'app-before.json').write_text(json.dumps(app))
    (backup / 'compose-files.before.txt').write_text('\n'.join(meta['files']) + '\n')
    (backup / 'compose-env-files.before.txt').write_text('\n'.join(meta['env_files']) + '\n')
    (backup / 'compose-working-dir.txt').write_text(meta['workdir'] + '\n')
    (backup / 'compose-vars.json').write_text(json.dumps(variables))
    (backup / 'compose-input-hashes.json').write_text(json.dumps({p: sha(Path(p).read_bytes()) for p in meta['files'] + meta['env_files']}))
    preimages = backup / 'preimages'
    preimages.mkdir(mode=0o700)
    runtime = release / 'runtime'
    runtime.mkdir(mode=0o755)
    changed = {}
    preimage_hashes = {}
    for target, expected, prepare in (
        ('client/public/index.html', EXPECTED_INDEX_SHA, prepare_index),
        ('client/public/retail-workspace.js', EXPECTED_RETAIL_SHA, prepare_retail_js),
    ):
        live_path = '/app/' + target
        saved = preimages / target
        saved.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        run('docker', 'cp', APP + ':' + live_path, str(saved))
        original = saved.read_bytes()
        if sha(original) != expected or sha(original) != run('docker', 'exec', APP, 'sha256sum', live_path).split()[0]:
            raise RuntimeError('Live preimage differs from reviewed runtime: ' + target)
        data = prepare(original)
        output = runtime / target
        output.parent.mkdir(parents=True, exist_ok=True, mode=0o755)
        output.write_bytes(data)
        output.chmod(0o644)
        preimage_hashes[target] = sha(original)
        changed[target] = data
    (backup / 'preimage-hashes.json').write_text(json.dumps(preimage_hashes, indent=2) + '\n')
    mounts = [{'type': 'bind', 'source': str(runtime / name), 'target': '/app/' + name,
               'read_only': True, 'bind': {'create_host_path': False}} for name in changed]
    overlay = release / 'compose.retail-connected-stores.json'
    overlay.write_text(json.dumps({'services': {'app': {'image': app['Config']['Image'], 'volumes': mounts}}}))
    overlay.chmod(0o644)
    common = compose_args(meta['files'], meta['env_files'], meta['workdir'])
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
    deploy_dir = release / 'deploy'
    deploy_dir.mkdir(mode=0o755)
    helper = deploy_dir / 'retail-connected-stores-release.py'
    helper.write_bytes(Path(__file__).read_bytes())
    helper.chmod(0o644)

    inputs = meta['files'] + meta['env_files']
    input_hashes = json.loads((backup / 'compose-input-hashes.json').read_text())
    if any(sha(Path(name).read_bytes()) != digest for name, digest in input_hashes.items()) or inspect(APP)['Id'] != app['Id']:
        raise RuntimeError('Running app or Compose inputs changed during preparation')
    try:
        run(*candidate, 'up', '-d', '--no-deps', '--no-build', '--force-recreate', 'app', env=env)
        current = wait_healthy()
        if current['Image'] != app['Image'] or current['Config']['Labels']['com.docker.compose.project.config_files'] != ','.join(meta['files'] + [str(overlay)]):
            raise RuntimeError('App image or Compose chain changed')
        if inspect(DB)['State'].get('Health', {}).get('Status') != 'healthy':
            raise RuntimeError('Database health changed during release')
        if any(inspect(name)['Id'] != identity for name, identity in services.items()):
            raise RuntimeError('Support service identity changed')
        for name, data in changed.items():
            if run('docker', 'exec', APP, 'sha256sum', '/app/' + name).split()[0] != sha(data):
                raise RuntimeError('Runtime file hash mismatch: ' + name)
        result = {'sourceCommit': commit, 'release': str(release), 'rollback': str(backup),
                  'image': current['Image'], 'composeInputs': len(meta['files']) + 1,
                  'envInputs': len(meta['env_files']), 'mounts': len(current['Mounts']),
                  'hashes': {name: sha(data) for name, data in changed.items()},
                  'preimages': preimage_hashes}
        (backup / 'result.json').write_text(json.dumps(result, indent=2) + '\n')
        print(json.dumps(result))
    except Exception:
        run(*common, 'up', '-d', '--no-deps', '--no-build', '--force-recreate', 'app', env=env)
        wait_healthy()
        raise


def restore(backup):
    require_lock()
    backup = Path(backup).resolve()
    meta = {'files': (backup / 'compose-files.before.txt').read_text().splitlines(),
            'env_files': (backup / 'compose-env-files.before.txt').read_text().splitlines(),
            'workdir': (backup / 'compose-working-dir.txt').read_text().strip()}
    release = Path((backup / 'release-path.txt').read_text().strip())
    overlay = release / 'compose.retail-connected-stores.json'
    if inspect(APP)['Config']['Labels']['com.docker.compose.project.config_files'] != ','.join(meta['files'] + [str(overlay)]):
        raise RuntimeError('A later release is active; roll it back first')
    input_hashes = json.loads((backup / 'compose-input-hashes.json').read_text())
    if any(sha(Path(name).read_bytes()) != digest for name, digest in input_hashes.items()):
        raise RuntimeError('Rollback Compose input changed')
    env = dict(os.environ)
    for key, value in json.loads((backup / 'compose-vars.json').read_text()).items():
        env[key] = value
    common = compose_args(meta['files'], meta['env_files'], meta['workdir'])
    run(*common, 'up', '-d', '--no-deps', '--no-build', '--force-recreate', 'app', env=env)
    current = wait_healthy()
    prior = json.loads((backup / 'app-before.json').read_text())
    if current['Image'] != prior['Image']:
        raise RuntimeError('Rollback app image mismatch')
    for target, expected in json.loads((backup / 'preimage-hashes.json').read_text()).items():
        if run('docker', 'exec', APP, 'sha256sum', '/app/' + target).split()[0] != expected:
            raise RuntimeError('Rollback file hash mismatch: ' + target)
    for name, identity in json.loads((backup / 'support-services.json').read_text()).items():
        if inspect(name)['Id'] != identity:
            raise RuntimeError('Rollback support service changed')
    print(json.dumps({'rolledBack': str(release), 'appHealthy': True}))


if __name__ == '__main__':
    if len(sys.argv) == 4 and sys.argv[1] == 'deploy':
        deploy(Path(sys.argv[2]), sys.argv[3])
    elif len(sys.argv) == 3 and sys.argv[1] == 'restore':
        restore(Path(sys.argv[2]))
    else:
        raise SystemExit('Usage: retail-connected-stores-release.py deploy <stage> <commit> | restore <backup>')
