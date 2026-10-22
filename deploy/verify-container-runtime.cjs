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
    ffmpeg: 'available',
  }) + '\n');
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
