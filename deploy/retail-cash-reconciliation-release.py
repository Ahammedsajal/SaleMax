"""Release the Retail Cash reconciliation fix on the guarded app overlay."""
import importlib.util
from pathlib import Path
import sys

sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location(
    'retail_release', Path(__file__).with_name('retail-dashboard-release.py'))
release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)

release.RELEASE_SLUG = 'retail-cash-reconciliation'
release.LATEST_OVERLAY = '/opt/salemax/releases/retail-dashboard-5ac49323f5ea-20261108/compose.retail-dashboard.json'
release.EXPECTED_COMPOSE_FILES = 175
release.RUNTIME_FILES = (
    'client/public/index.html',
    'client/public/retail-workspace.js',
    'client/public/retail-workspace.css',
    'modules/platform/retail-commerce-router.js',
)
release.STAGE_FILES = release.RUNTIME_FILES + (
    'deploy/retail-dashboard-release.py', 'deploy/retail-cash-reconciliation-release.py',
)
release.OLD_HASHES = dict(zip(release.RUNTIME_FILES, (
    'b8464539068bc2ead6fb73ab65a0f20334f87c3285cc48b6a15e69f3883b1aac',
    '66a53267c60564d680fbbda4006e88934afe7038eeb4bcc04a02966661ccd3fd',
    '67d81ce9a31d38f924a80d01a761926943153e9fc1547e811794c5fb12887ccf',
    '3021616dc7258efe11e261e3e0c45804b03fd1697fa7d6c6c26dd9baba844ddf',
)))
release.SHELL_PATH = '/user?page=retail-finance'
release.ANONYMOUS_API_PATH = '/api/workspace/retail/finance'
release.PUBLIC_ASSETS = tuple(zip((
    release.SHELL_PATH,
    '/retail-workspace.js?v=20261108-cash-ui1',
    '/retail-workspace.css?v=20261108-cash-ui1',
), release.RUNTIME_FILES))
release.SMOKE_CASES = r"""
    const url = base + '/finance';
    const allowed = await fetch(url);
    assert.equal(allowed.status,200);
    assert.match(allowed.headers.get('cache-control'),/no-store/);
    const {data} = await allowed.json();
    assert.deepEqual(data,{drivers:[],settlements:[]});
    assert.equal((await fetch(url,{headers:{'x-test-role':'agent'}})).status,403);
    assert.equal((await fetch(url,{headers:{'x-test-category':'training_center'}})).status,403);
    const csv = await fetch(url+'/accounting-export.csv?from=2026-11-08&to=2026-11-08');
    assert.equal(csv.status,200);
    assert.equal(csv.headers.get('x-export-row-count'),'0');
    assert.match(await csv.text(),/^record_type,/);
    console.log(JSON.stringify({syntheticRetail:200,agent:403,trainingCenter:403,emptyCsv:200}));
"""

if __name__ == '__main__':
    release.main()
