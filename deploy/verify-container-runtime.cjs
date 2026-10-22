const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');

async function main() {
  assert.equal(process.platform, 'linux', 'container target must be Linux');
  assert.equal(process.arch, 'arm64', 'production artifact must target ARM64');
  assert.notEqual(process.getuid?.(), 0, 'application must run as a non-root user');

  const bcrypt = require('bcrypt');
  const passwordHash = bcrypt.hashSync('7network-image-smoke', 4);
  assert.equal(bcrypt.compareSync('7network-image-smoke', passwordHash), true);

  const sharp = require('sharp');
  const png = await sharp({
    create: { width: 1, height: 1, channels: 3, background: '#123456' },
  }).png().toBuffer();
  assert.equal((await sharp(png).metadata()).format, 'png');

  const wrtc = require('@roamhq/wrtc');
  assert.equal(typeof wrtc.RTCPeerConnection, 'function');
  const peer = new wrtc.RTCPeerConnection();
  peer.close();

  const shutdownProbe = await new Promise((resolve, reject) => {
    const child = require('node:child_process').spawn(process.execPath, ['-e', `
    process.once('SIGTERM', () => {
      require('node:fs').writeSync(1, 'graceful-signal-relay');
      process.kill(process.pid, 'SIGTERM');
    });
    process.stdout.write('probe-ready\\n');
    setTimeout(() => {}, 10000);
  `]);
    let stdout = '';
    let stderr = '';
    let signalSent = false;
    child.stdout.setEncoding('utf8').on('data', (chunk) => {
      stdout += chunk;
      if (!signalSent && stdout.includes('probe-ready')) {
        signalSent = true;
        child.kill('SIGTERM');
      }
    });
    child.stderr.setEncoding('utf8').on('data', (chunk) => { stderr += chunk; });
    const deadline = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('graceful shutdown probe timed out'));
    }, 10000);
    child.once('error', (error) => { clearTimeout(deadline); reject(error); });
    child.once('close', (status, signal) => {
      clearTimeout(deadline);
      resolve({ status, signal, stdout, stderr });
    });
  });
  assert.equal(shutdownProbe.signal, 'SIGTERM', shutdownProbe.stderr || shutdownProbe.stdout);
  assert.match(shutdownProbe.stdout, /graceful-signal-relay/);

  const ffmpegPath = require('ffmpeg-static');
  assert.equal(typeof ffmpegPath, 'string');
  const ffmpeg = spawnSync(ffmpegPath, ['-hide_banner', '-version'], {
    encoding: 'utf8',
    timeout: 10000,
  });
  assert.equal(ffmpeg.error, undefined, ffmpeg.error?.message);
  assert.equal(ffmpeg.status, 0, ffmpeg.stderr || ffmpeg.stdout);
  assert.match(ffmpeg.stdout, /ffmpeg version/i);

  const s3 = require('@aws-sdk/client-s3');
  assert.equal(typeof s3.S3Client, 'function');

  process.stdout.write(JSON.stringify({
    platform: process.platform,
    architecture: process.arch,
    nonRoot: true,
    nativeModules: ['bcrypt', 'sharp', '@roamhq/wrtc', '@aws-sdk/client-s3'],
    gracefulShutdownSignalRelay: true,
    ffmpeg: 'available',
  }) + '\n');
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
