require('dotenv').config({ quiet: true });
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const assert = require('node:assert/strict');
async function main() {
  const checkout = fs.realpathSync(process.argv[2] || '.');
  if (process.env.LOCAL_ONLY_MODE !== 'true' || !['127.0.0.1', 'localhost', '::1'].includes(process.env.DBHOST)) throw new Error('LOCAL_RUNTIME_CONFIG_REQUIRED');
  if (!fs.existsSync(path.join(checkout, 'server.js'))) throw new Error('CHECKOUT_REQUIRED');
  const net = require('node:net');
  const reservation = net.createServer();
  await new Promise((resolve, reject) => reservation.once('error', reject).listen(0, '127.0.0.1', resolve));
  const port = reservation.address().port;
  await new Promise(resolve => reservation.close(resolve));
  const child = spawn(process.execPath, ['server.js'], { cwd: checkout, env: { ...process.env, LOCAL_ONLY_MODE: 'true', HOST: '127.0.0.1', PORT: String(port) }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let serverAnnounced = false;
  child.stdout.on('data', chunk => { if (chunk.toString().includes('SaleMaX server is running')) serverAnnounced = true; });
  child.stderr.resume();
  let spawnError;
  let terminated = false, exitReport;
  child.once('error', error => { spawnError = error; });
  child.once('exit', (code, signal) => { terminated = true; exitReport = { code, signal }; });
  try {
    let health;
    for (let n=0; n<180; n++) {
      if (spawnError || terminated) { console.log(JSON.stringify({ stage: 'startup', exit: exitReport, spawnError: spawnError?.code, serverAnnounced })); throw new Error('FRESH_SERVER_START_FAILED'); }
      try { health = await (await fetch(`http://127.0.0.1:${port}/healthz`, { signal: AbortSignal.timeout(500) })).json(); break; }
      catch (_) { await new Promise(resolve => setTimeout(resolve, 250)); }
    }
    if (!health) throw new Error(serverAnnounced ? 'FRESH_HEALTH_UNAVAILABLE' : 'FRESH_STARTUP_TIMEOUT');
    assert.equal(health.status, 'ok', 'Fresh health status');
    assert.equal(health.qr.activeConnections, 0);
    const responses=[];
    for (const route of ['/', '/api/web/get_web_public', '/api/theme/get-theme-config']) {
      const response=await fetch(`http://127.0.0.1:${port}${route}`, { signal: AbortSignal.timeout(10000) });
      assert.equal(response.status, 200, 'Fresh route ' + route);
      responses.push({ route, status: response.status });
    }
    console.log(JSON.stringify({ freshCheckout: true, localhostOnly: true, qrConnections: 0, responses, externalWrites: false, newLicenseProvisioned: false, database: 'Existing sanitized local database configuration; no schema migration or customer mutations' }));
  } finally {
    // Stop only the child started by this invocation, never other Node servers.
    if (child.exitCode === null) {
      const closed=new Promise(resolve => child.once('close', resolve));
      child.kill('SIGTERM');
      await Promise.race([closed, new Promise(resolve=>setTimeout(resolve,3000))]);
      if (child.exitCode === null) child.kill('SIGKILL');
    }
  }
}
main().catch(error=>{console.error('Fresh checkout verification failed:',error.code==='ERR_ASSERTION'?error.message.split('\n')[0]:error.code||error.message);process.exitCode=1;});
