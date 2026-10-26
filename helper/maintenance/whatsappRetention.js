'use strict';
// Media only: the former job also deleted messages and chats after 30 days.
// Keep the existing startup entry point while preserving all conversation text.
let running = false;
let timer = null;

async function runWhatsAppRetentionCleanup(options = {}) {
  if (running) return { success: true, skipped: 'already_running' };
  running = true;
  let db, held = false;
  try {
    db = await require('../../database/config').promise().getConnection();
    const [[lock]] = await db.query("SELECT GET_LOCK('7network:whatsapp-media-retention',0) AS acquired");
    held = Number(lock.acquired) === 1;
    if (!held) return { success: true, skipped: 'already_running' };
    const { createMediaRetention } = require('./whatsappMediaRetention');
    return await createMediaRetention({ query: async (sql, values) => (await db.query(sql, values))[0] }).run(options);
  } finally {
    if (held) await db.query("SELECT RELEASE_LOCK('7network:whatsapp-media-retention')").catch(() => {});
    db?.release();
    running = false;
  }
}

function initWhatsAppRetentionCleanup() {
  if (timer) return timer;
  const execute = () => runWhatsAppRetentionCleanup().then(result => {
    console.log('[retention] WhatsApp media cleanup', JSON.stringify(result));
  }).catch(error => console.error('[retention] WhatsApp media cleanup failed', error.code || error.message));
  // Sweep every 15 minutes; age is measured per file/message, never per sweep.
  timer = setTimeout(() => {
    execute();
    timer = setInterval(execute, 15 * 60 * 1000);
    timer.unref?.();
  }, 60_000);
  timer.unref?.();
  return timer;
}

module.exports = { initWhatsAppRetentionCleanup, runWhatsAppRetentionCleanup };
