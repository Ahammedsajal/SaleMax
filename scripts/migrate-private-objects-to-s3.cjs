'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const migration = require('../modules/platform/object-storage-migration');
const { createStore, driver } = require('../modules/platform/object-storage');

function argumentsMap(argv) {
  const result = new Map();
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (!['--namespace', '--root', '--manifest-out', '--manifest', '--apply'].includes(flag) || result.has(flag)) throw Error('Invalid or repeated argument');
    if (flag === '--apply') { result.set(flag, true); continue; }
    const value = argv[++i];
    if (!value || value.startsWith('--')) throw Error(`Missing value for ${flag}`);
    result.set(flag, value);
  }
  return result;
}

function externalPath(value) {
  if (!path.isAbsolute(value)) throw Error('Manifest paths must be absolute and outside the source checkout');
  const checkout = path.resolve(__dirname, '..');
  const resolved = path.resolve(value);
  if (resolved === checkout || resolved.startsWith(checkout + path.sep)) throw Error('Manifest paths must be outside the source checkout');
  return resolved;
}

async function main(argv = process.argv.slice(2), env = process.env) {
  const args = argumentsMap(argv);
  const namespace = args.get('--namespace');
  migration.validateKey(namespace, '00000000-0000-4000-8000-000000000000/00000000-0000-4000-8000-000000000000/00000000-0000-4000-8000-000000000000');
  const root = args.get('--root');
  if (!root || !path.isAbsolute(root)) throw Error('--root must be an absolute storage directory');
  if (args.has('--apply')) {
    if (!args.has('--manifest') || args.has('--manifest-out')) throw Error('--apply requires --manifest and does not accept --manifest-out');
    if (env.SALEMAX_DEPLOY_LOCK_HELD !== '1') throw Error('Refusing object migration without the shared production deployment lock');
    if (driver(env, namespace) !== 's3') throw Error(`Select the S3 storage driver for ${namespace} inside the locked process`);
    const manifestPath = externalPath(args.get('--manifest'));
    const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
    const store = createStore({ env, namespace, root });
    const report = await migration.migrateManifest({ root, manifest, namespace, store, onProgress: progress => {
      if (progress.completed === progress.total || progress.completed % 100 === 0) process.stderr.write(`verified ${progress.completed}/${progress.total} objects\n`);
    } });
    process.stdout.write(`${JSON.stringify(report)}\n`);
    return report;
  }
  if (!args.has('--manifest-out') || args.has('--manifest')) throw Error('Manifest generation requires --manifest-out and does not accept --manifest');
  const outputPath = externalPath(args.get('--manifest-out'));
  const manifest = await migration.buildManifest({ root, namespace });
  const handle = await fs.open(outputPath, 'wx', 0o600);
  try { await handle.writeFile(`${JSON.stringify(manifest, null, 2)}\n`); await handle.sync(); }
  finally { await handle.close(); }
  process.stdout.write(`${JSON.stringify({ namespace, objects: manifest.objects.length, manifestPath: outputPath, sourceDeleted: false })}\n`);
  return manifest;
}

if (require.main === module) main().catch(error => {
  process.stderr.write(`${error.code || 'OBJECT_MIGRATION_FAILED'}: ${error.message}\n`);
  process.exitCode = 1;
});

module.exports = { argumentsMap, externalPath, main };
