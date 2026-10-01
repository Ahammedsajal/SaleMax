const fs = require("fs/promises");
const path = require("path");
const { query } = require("../../database/dbpromise");

const DEFAULT_RETENTION_DAYS = Number(process.env.WHATSAPP_RETENTION_DAYS || 30);
const CONVERSATION_ROOT = path.join(__dirname, "../../conversations/inbox");

let cleanupRunning = false;
let retentionTimer = null;

function getRetentionWindow(days = DEFAULT_RETENTION_DAYS) {
  const safeDays = Math.max(1, Math.min(3650, Number(days) || DEFAULT_RETENTION_DAYS));
  const cutoffMs = Date.now() - safeDays * 24 * 60 * 60 * 1000;
  const cutoffUnix = Math.floor(cutoffMs / 1000);

  return {
    days: safeDays,
    cutoffMs,
    cutoffUnix,
  };
}

async function tableExists(tableName) {
  const rows = await query(
    `SELECT 1 AS found
     FROM information_schema.tables
     WHERE table_schema = DATABASE()
       AND table_name = ?
     LIMIT 1`,
    [tableName],
  );

  return rows.length > 0;
}

async function deleteIfTableExists(tableName, sql, params) {
  if (!(await tableExists(tableName))) {
    return { skipped: true, affectedRows: 0 };
  }

  const result = await query(sql, params);
  return {
    skipped: false,
    affectedRows: Number(result?.affectedRows || 0) || 0,
  };
}

async function walkJsonFiles(rootDir, accumulator = []) {
  try {
    const entries = await fs.readdir(rootDir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(rootDir, entry.name);
      if (entry.isDirectory()) {
        await walkJsonFiles(fullPath, accumulator);
      } else if (entry.isFile() && entry.name.endsWith(".json")) {
        accumulator.push(fullPath);
      }
    }
  } catch (err) {
    if (err?.code !== "ENOENT") {
      throw err;
    }
  }

  return accumulator;
}

async function pruneEmptyDirs(rootDir) {
  try {
    const entries = await fs.readdir(rootDir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(rootDir, entry.name);
      if (entry.isDirectory()) {
        await pruneEmptyDirs(fullPath);
      }
    }

    const remaining = await fs.readdir(rootDir);
    if (remaining.length === 0) {
      await fs.rmdir(rootDir);
    }
  } catch (err) {
    if (err?.code !== "ENOENT" && err?.code !== "ENOTEMPTY") {
      throw err;
    }
  }
}

async function pruneConversationFiles(cutoffMs) {
  const files = await walkJsonFiles(CONVERSATION_ROOT);
  let deletedFiles = 0;

  for (const filePath of files) {
    try {
      const stat = await fs.stat(filePath);
      if (stat.mtimeMs < cutoffMs) {
        await fs.unlink(filePath);
        deletedFiles += 1;
      }
    } catch (err) {
      if (err?.code !== "ENOENT") {
        throw err;
      }
    }
  }

  try {
    await pruneEmptyDirs(CONVERSATION_ROOT);
  } catch (err) {
    if (err?.code !== "ENOENT") {
      throw err;
    }
  }

  return {
    scannedFiles: files.length,
    deletedFiles,
  };
}

async function pruneBetaConversation(cutoffUnix) {
  return deleteIfTableExists(
    "beta_conversation",
    `DELETE FROM beta_conversation
     WHERE CAST(NULLIF(timestamp, '') AS UNSIGNED) < ?`,
    [cutoffUnix],
  );
}

async function pruneBetaChats(cutoffUnix) {
  if (!(await tableExists("beta_chats"))) {
    return { skipped: true, affectedRows: 0 };
  }

  const hasConversationTable = await tableExists("beta_conversation");
  const result = await query(
    hasConversationTable
      ? `DELETE bc
         FROM beta_chats bc
         LEFT JOIN (
           SELECT uid, chat_id, MAX(timestamp) AS latest_ts
           FROM beta_conversation
           GROUP BY uid, chat_id
         ) recent
           ON recent.uid = bc.uid
          AND recent.chat_id = bc.chat_id
         WHERE COALESCE(
           CAST(NULLIF(recent.latest_ts, '') AS UNSIGNED),
           UNIX_TIMESTAMP(COALESCE(bc.updatedAt, bc.createdAt))
         ) < ?`
      : `DELETE FROM beta_chats
         WHERE UNIX_TIMESTAMP(COALESCE(updatedAt, createdAt)) < ?`,
    [cutoffUnix],
  );

  return {
    skipped: false,
    affectedRows: Number(result?.affectedRows || 0) || 0,
  };
}

async function pruneLegacyChats(cutoffUnix) {
  if (!(await tableExists("chats"))) {
    return { skipped: true, affectedRows: 0 };
  }

  const result = await query(
    `DELETE FROM chats
     WHERE COALESCE(
       CAST(NULLIF(last_message_came, '') AS UNSIGNED),
       UNIX_TIMESTAMP(createdAt)
     ) < ?`,
    [cutoffUnix],
  );

  return {
    skipped: false,
    affectedRows: Number(result?.affectedRows || 0) || 0,
  };
}

async function runWhatsAppRetentionCleanup(options = {}) {
  if (cleanupRunning) {
    return {
      success: false,
      skipped: true,
      msg: "Retention cleanup already running",
    };
  }

  cleanupRunning = true;
  try {
    const { days, cutoffMs, cutoffUnix } = getRetentionWindow(options.days);

    const [betaConversation, betaChats, legacyChats, files] = await Promise.all([
      pruneBetaConversation(cutoffUnix),
      pruneBetaChats(cutoffUnix),
      pruneLegacyChats(cutoffUnix),
      options.deleteFiles === false
        ? Promise.resolve({ skipped: true, deletedFiles: 0, scannedFiles: 0 })
        : pruneConversationFiles(cutoffMs),
    ]);

    return {
      success: true,
      days,
      cutoffUnix,
      results: {
        betaConversation,
        betaChats,
        legacyChats,
        files,
      },
    };
  } finally {
    cleanupRunning = false;
  }
}

function initWhatsAppRetentionCleanup() {
  if (retentionTimer) {
    return retentionTimer;
  }

  const initialDelayMs = Number(process.env.WHATSAPP_RETENTION_INITIAL_DELAY_MS || 60_000);
  const intervalMs = Number(process.env.WHATSAPP_RETENTION_INTERVAL_MS || 24 * 60 * 60 * 1000);

  retentionTimer = setTimeout(async () => {
    try {
      const result = await runWhatsAppRetentionCleanup();
      console.log("[retention] WhatsApp cleanup complete", result?.results || {});
    } catch (err) {
      console.error("[retention] WhatsApp cleanup failed", err);
    }
  }, initialDelayMs);

  retentionTimer.unref?.();

  const interval = setInterval(async () => {
    try {
      const result = await runWhatsAppRetentionCleanup();
      console.log("[retention] WhatsApp cleanup complete", result?.results || {});
    } catch (err) {
      console.error("[retention] WhatsApp cleanup failed", err);
    }
  }, intervalMs);

  interval.unref?.();

  return interval;
}

module.exports = {
  initWhatsAppRetentionCleanup,
  runWhatsAppRetentionCleanup,
};
