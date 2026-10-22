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

  const shutdownProbe = spawnSync(process.execPath, ['-e', `
    const nodeCleanup = require('node-cleanup');
    nodeCleanup((exitCode, signal) => {
      if (!signal) return;
      nodeCleanup.uninstall();
      setTimeout(() => {
        require('node:fs').writeSync(1, 'graceful-signal-relay');
        process.kill(process.pid, signal);
      }, 25);
      return false;
    });
    process.kill(process.pid, 'SIGTERM');
  `], { encoding: 'utf8', timeout: 10000 });
  assert.equal(shutdownProbe.error, undefined, shutdownProbe.error?.message);
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

  process.stdout.write(JSON.stringify({
    platform: process.platform,
    architecture: process.arch,
    nonRoot: true,
    nativeModules: ['bcrypt', 'sharp', '@roamhq/wrtc'],
    gracefulShutdownSignalRelay: true,
    ffmpeg: 'available',
  }) + '\n');
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
