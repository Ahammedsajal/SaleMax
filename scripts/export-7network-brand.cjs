'use strict';

// Package the approved live horizontal logo masters, then derive each shipped size.
const fs = require('node:fs/promises');
const path = require('node:path');
const sharp = require('sharp');

const root = path.resolve(__dirname, '..');
const brand = path.join(root, 'client/public/branding/7network');
const media = path.join(root, 'client/public/media');
const horizontalSource = path.join(brand, 'logo-horizontal-source.png');
const darkSource = path.join(brand, 'logo-dark-source.png');
const iconSource = path.join(brand, 'icon-source.png');
const iconMaster = path.join(brand, 'icon-master.png');

async function main() {
  await fs.mkdir(media, { recursive: true });
  const horizontal = await fs.readFile(horizontalSource);
  const darkMaster = await fs.readFile(darkSource);
  const hero = await fs.readFile(iconSource);
  const heroMeta = await sharp(hero).metadata();
  const darkMeta = await sharp(darkMaster).metadata();
  if (!heroMeta.hasAlpha || !darkMeta.hasAlpha) throw new Error('The approved 7Network artwork must retain transparency');
  const logoPngBuffer = await sharp(horizontal).trim().extend({
    top: 18, bottom: 18, left: 24, right: 24, background: '#00000000',
  }).png().toBuffer();
  const darkLogoPngBuffer = await sharp(darkMaster).png().toBuffer();
  const logoMeta = await sharp(logoPngBuffer).metadata();
  if (!logoMeta.hasAlpha) throw new Error('Approved logo must retain transparency');

  for (const [mode, buffer] of [['light', logoPngBuffer], ['dark', darkLogoPngBuffer]]) {
    await fs.writeFile(path.join(brand, `logo-${mode}.png`), buffer);
    for (const width of [480, 960, 1920]) {
      await sharp(buffer).resize({ width }).png().toFile(path.join(brand, `logo-${mode}-${width}.png`));
    }
  }
  await fs.writeFile(path.join(brand, 'logo-horizontal-master-transparent.png'), logoPngBuffer);

  const iconBuffer = await sharp(iconSource).trim().png().toBuffer();
  await fs.writeFile(path.join(brand, 'icon-master.png'), iconBuffer);

  const sizes = [16, 24, 32, 48, 64, 128, 180, 192, 256, 512, 1024];
  for (const size of sizes) {
    const inner = Math.round(size * 0.88);
    const before = Math.floor((size - inner) / 2);
    await sharp(iconMaster).ensureAlpha().trim().resize(inner, inner, { fit: 'contain', background: '#00000000' })
      .extend({ top: before, bottom: size - inner - before, left: before, right: size - inner - before, background: '#00000000' })
      .png().toFile(path.join(brand, `icon-${size}.png`));
  }

  for (const size of [192, 512]) {
    const inner = Math.round(size * 0.64);
    const before = Math.floor((size - inner) / 2);
    await sharp(iconMaster).trim().resize(inner, inner, { fit: 'contain', background: '#081630' })
      .extend({ top: before, bottom: size - inner - before, left: before, right: size - inner - before, background: '#081630' })
      .flatten({ background: '#081630' }).png().toFile(path.join(brand, `maskable-${size}.png`));
  }

  await sharp(path.join(brand, 'icon-180.png')).flatten({ background: '#F8FAFF' })
    .png().toFile(path.join(brand, 'apple-touch-icon.png'));
  await fs.copyFile(path.join(brand, 'icon-192.png'), path.join(root, 'client/public/logo192.png'));
  await fs.copyFile(path.join(brand, 'icon-512.png'), path.join(root, 'client/public/logo512.png'));
  await fs.copyFile(path.join(brand, 'apple-touch-icon.png'), path.join(root, 'client/public/apple-touch-icon.png'));

  const frames = await Promise.all([16, 32, 48].map(size => fs.readFile(path.join(brand, `icon-${size}.png`))));
  const header = Buffer.alloc(6 + frames.length * 16);
  header.writeUInt16LE(1, 2); header.writeUInt16LE(frames.length, 4);
  let offset = header.length;
  frames.forEach((frame, i) => {
    const at = 6 + i * 16, size = [16, 32, 48][i];
    header[at] = size; header[at + 1] = size; header.writeUInt16LE(1, at + 4);
    header.writeUInt16LE(32, at + 6); header.writeUInt32LE(frame.length, at + 8);
    header.writeUInt32LE(offset, at + 12); offset += frame.length;
  });
  const favicon = Buffer.concat([header, ...frames]);
  await fs.writeFile(path.join(brand, 'favicon.ico'), favicon);
  await fs.copyFile(path.join(brand, 'favicon.ico'), path.join(root, 'client/public/favicon.ico'));

  // Preserve the legacy file route used by the compiled application shell.
  const compatibilityLogo = await sharp(logoPngBuffer).resize({ width: 1440 }).png().toBuffer();
  await fs.writeFile(path.join(media, '7network-logo.png'), compatibilityLogo);
  await fs.writeFile(path.join(media, 'salemax-logo.png'), compatibilityLogo);
  await fs.copyFile(path.join(brand, 'icon-192.png'), path.join(media, '7network-icon.png'));
  await fs.copyFile(path.join(brand, 'icon-192.png'), path.join(media, 'salemax-icon.png'));

  const manifest = {
    name: '7Network — CRM, WhatsApp & Business Automation', short_name: '7Network',
    id: '/', start_url: '/', scope: '/', display: 'standalone',
    theme_color: '#081630', background_color: '#081630',
    icons: [192, 512].flatMap(size => [
      { src: `/branding/7network/icon-${size}.png?v=20261022-clear1`, sizes: `${size}x${size}`, type: 'image/png', purpose: 'any' },
      { src: `/branding/7network/maskable-${size}.png?v=20261022-clear1`, sizes: `${size}x${size}`, type: 'image/png', purpose: 'maskable' },
    ]),
  };
  const manifestText = `${JSON.stringify(manifest, null, 2)}\n`;
  await fs.writeFile(path.join(brand, 'manifest.webmanifest'), manifestText);
  await fs.writeFile(path.join(root, 'client/public/manifest.json'), manifestText);

  const files = await fs.readdir(brand);
  for (const file of files.filter(name => name.startsWith('logo-') || name.startsWith('icon-'))) {
    const metadata = await sharp(path.join(brand, file)).metadata();
    if (!metadata.width || !metadata.height) throw new Error(`Invalid image: ${file}`);
    if (file.startsWith('logo-') && !metadata.hasAlpha) throw new Error(`Logo lost alpha: ${file}`);
  }
  console.log(`Packaged 7Network logo and icon assets in ${brand}`);
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
