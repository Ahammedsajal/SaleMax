const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

test('activation survives module reload in configured persistent storage without saving the key', async () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'salemax-license-'));
  const previous = process.env.SALEMAX_LICENSE_FILE;
  const modulePath = require.resolve('../middlewares/license');
  try {
    process.env.SALEMAX_LICENSE_FILE = path.join(folder, 'persistent', 'license.json');
    delete require.cache[modulePath];
    require(modulePath).createLicenseFile({ domain: 'crm.salemax.qa', product: 'whatscrm' });
    const record = JSON.parse(fs.readFileSync(process.env.SALEMAX_LICENSE_FILE));
    assert.equal(record.domain, 'crm.salemax.qa');
    assert.equal(record.product, 'whatscrm');
    assert.deepEqual(Object.keys(record).sort(), ['activatedAt', 'domain', 'product']);
    delete require.cache[modulePath];
    let continued = false;
    await require(modulePath).checkLicense({}, { json() { assert.fail('Valid activation rejected'); } }, () => { continued = true; });
    assert.equal(continued, true);
    assert.deepEqual(fs.readdirSync(path.dirname(process.env.SALEMAX_LICENSE_FILE)), ['license.json']);
  } finally {
    if (previous === undefined) delete process.env.SALEMAX_LICENSE_FILE;
    else process.env.SALEMAX_LICENSE_FILE = previous;
    delete require.cache[modulePath];
    fs.rmSync(folder, { recursive: true, force: true });
  }
});
