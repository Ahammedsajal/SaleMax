'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

function markWorkerReady(file, now = Date.now()) {
  if (typeof file !== 'string' || !path.isAbsolute(file) || !Number.isSafeInteger(now) || now < 0) {
    throw new Error('INVALID_WORKER_READINESS_INPUT');
  }
  const directory = path.dirname(file);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const temporary = path.join(directory, `.${path.basename(file)}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`);
  try {
    fs.writeFileSync(temporary, `${now}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    fs.renameSync(temporary, file);
    fs.chmodSync(file, 0o600);
  } catch (error) {
    fs.rmSync(temporary, { force: true });
    throw error;
  }
}

function isWorkerReady(file, { now = Date.now(), maxAgeMs = 120000 } = {}) {
  if (typeof file !== 'string' || !path.isAbsolute(file) || !Number.isSafeInteger(now)
      || !Number.isSafeInteger(maxAgeMs) || maxAgeMs < 1) return false;
  try {
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 32) return false;
    const value = fs.readFileSync(file, 'utf8').trim();
    if (!/^\d{1,16}$/.test(value)) return false;
    const updatedAt = Number(value);
    const age = now - updatedAt;
    return Number.isSafeInteger(updatedAt) && age >= 0 && age <= maxAgeMs;
  } catch {
    return false;
  }
}

module.exports = { markWorkerReady, isWorkerReady };
