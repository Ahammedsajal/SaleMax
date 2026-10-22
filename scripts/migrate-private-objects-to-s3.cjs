'use strict';

const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
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
  const checkout = fsSync.realpathSync(path.resolve(__dirname, '..'));
  const resolved = path.resolve(value);
  const parent = fsSync.realpathSync(path.dirname(resolved));
  const canonical = path.join(parent, path.basename(resolved));
  if (canonical === checkout || canonical.startsWith(checkout + path.sep)) throw Error('Manifest paths must be outside the source checkout');
  return canonical;
}

function sharedLockHeld(lockProbe = spawnSync, lockPath = '/opt/salemax/shared/7network-production-deploy.lock') {
  let stat;
  try { stat = fsSync.lstatSync(lockPath); } catch (error) { if (error.code === 'ENOENT') return false; throw error; }
  if (!stat.isFile() || stat.isSymbolicLink()) return false;
  const result = lockProbe('flock', ['-n', '-E', '75', lockPath, 'true'], { stdio: 'ignore' });
  return result.status === 75;
}

async function main(argv = process.argv.slice(2), env = process.env, deps = {}) {
  const args = argumentsMap(argv);
  const namespace = args.get('--namespace');
  migration.validateKey(namespace, '00000000-0000-4000-8000-000000000000/00000000-0000-4000-8000-000000000000/00000000-0000-4000-8000-000000000000');
  const root = args.get('--root');
  if (!root || !path.isAbsolute(root)) throw Error('--root must be an absolute storage directory');
  if (args.has('--apply')) {
    if (!args.has('--manifest') || args.has('--manifest-out')) throw Error('--apply requires --manifest and does not accept --manifest-out');
    if (env.SALEMAX_DEPLOY_LOCK_HELD !== '1') throw Error('Refusing object migration without the shared production deployment lock');
    if (!env.SALEMAX_ACTIVE_RELEASE_BEFORE || !path.isAbsolute(env.SALEMAX_ACTIVE_RELEASE_BEFORE)) throw Error('Refusing object migration outside the production release lock wrapper');
    if (!(deps.lockHeld ? deps.lockHeld() : sharedLockHeld())) throw Error('Refusing object migration because the shared OS-level flock is not held');
    if (driver(env, namespace) !== 's3') throw Error(`Select the S3 storage driver for ${namespace} inside the locked process`);
    const manifestPath = externalPath(args.get('--manifest'));
    const manifestStat = await fs.lstat(manifestPath);
    if (!manifestStat.isFile() || manifestStat.isSymbolicLink() || (manifestStat.mode & 0o777) !== 0o600) throw Error('Manifest must be a regular mode-0600 file outside the source checkout');
    const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
    const store = (deps.createStore || createStore)({ env, namespace, root });
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
  try { await handle.chmod(0o600); await handle.writeFile(`${JSON.stringify(manifest, null, 2)}\n`); await handle.sync(); }
  finally { await handle.close(); }
  process.stdout.write(`${JSON.stringify({ namespace, objects: manifest.objects.length, manifestPath: outputPath, sourceDeleted: false })}\n`);
  return manifest;
}

if (require.main === module) main().catch(error => {
  process.stderr.write(`${error.code || 'OBJECT_MIGRATION_FAILED'}: ${error.message}\n`);
  process.exitCode = 1;
});

module.exports = { argumentsMap, externalPath, sharedLockHeld, main };
