const { toDataURL } = require("qrcode");
const pino = require("pino");
const { query } = require("../../../database/dbpromise");
const { processMessage } = require("../../inbox/inbox");
const newLogger = require("../../../utils/logger");

// Declare variables for baileys functions
let baileysLoaded = false;
let makeWASocket,
  makeCacheableSignalKeyStore,
  fetchLatestBaileysVersion,
  DisconnectReason,
  delay,
  downloadMediaMessage,
  getUrlInfo,
  generateProfilePicture,
  useMultiFileAuthState;

// Load baileys functions when needed
async function loadBaileysIfNeeded() {
  if (!baileysLoaded) {
    const baileys = await import("baileys");
    makeWASocket = baileys.default;
    ({
      makeCacheableSignalKeyStore,
      fetchLatestBaileysVersion,
      DisconnectReason,
      delay,
      downloadMediaMessage,
      getUrlInfo,
      generateProfilePicture,
      useMultiFileAuthState,
    } = baileys);
    baileysLoaded = true;
  }
}

// ============= CONFIGURATION =============

// Storage configuration (loaded from database)
let STORAGE_METHOD = "local";
let MONGODB_URI = null;

// MySQL Configuration (from environment or defaults)
const MYSQL_CONFIG = {
  host: process.env.DBHOST || "localhost",
  port: process.env.DBPORT || 3306,
  user: process.env.DBUSER,
  password: process.env.DBPASS,
  database: process.env.DBNAME,
  tableName: "auth",
  retryRequestDelayMs: 200,
};

// Local file storage
const fs = require("fs");
const path = require("path");
const sessionsDir = (sessionId = "") =>
  path.join(process.cwd(), "sessions", sessionId ? `md_${sessionId}` : "");

// Active connections tracking
const activeConnections = new Map();
const connectingSessions = new Set();
const reconnectTimers = new Map();
const reconnectAttempts = new Map();
const connectionWatchdogs = new Map();
const contactNamesBySession = new Map();

function normalizeContactJid(value) {
  return String(value || "")
    .replace(/:\d+(?=@)/, "")
    .trim()
    .toLowerCase();
}

function getContactDisplayName(contact) {
  return String(
    contact?.name || contact?.notify || contact?.verifiedName || "",
  ).trim();
}

function cacheQrContacts(sessionId, contacts = []) {
  if (!sessionId || !Array.isArray(contacts)) return [];

  const sessionContacts = contactNamesBySession.get(sessionId) || new Map();
  const changed = [];

  contacts.forEach((contact) => {
    const name = getContactDisplayName(contact);
    if (!name) return;

    const keys = [contact?.id, contact?.jid, contact?.phoneNumber]
      .map(normalizeContactJid)
      .filter(Boolean);

    keys.forEach((key) => {
      sessionContacts.set(key, name);
      changed.push({ key, name });
    });
  });

  contactNamesBySession.set(sessionId, sessionContacts);
  return changed;
}

function getCachedQrContactName(sessionId, jid) {
  const normalized = normalizeContactJid(jid);
  const cache = contactNamesBySession.get(sessionId);
  return cache?.get(normalized) || cache?.get(normalized.split("@")[0]) || "";
}

async function syncQrContactNamesToChats(sessionId, contacts = []) {
  try {
    const [instance] = await query(
      `SELECT uid, number FROM instance WHERE uniqueId = ? LIMIT 1`,
      [sessionId],
    );
    if (!instance?.uid || !instance?.number) return;

    const changed = cacheQrContacts(sessionId, contacts);
    for (const { key, name } of changed) {
      const mobile = key.split("@")[0];
      if (!mobile || key.endsWith("@g.us")) continue;

      await query(
        `UPDATE beta_chats
         SET sender_name = ?,
             last_message = JSON_SET(COALESCE(last_message, '{}'), '$.senderName', ?)
         WHERE uid = ?
           AND sender_mobile = ?
           AND chat_id LIKE CONCAT(?, '_%')
           AND NOT EXISTS (
             SELECT 1 FROM contact c
             WHERE c.uid = ? AND c.mobile = ?
           )`,
        [name, name, instance.uid, mobile, instance.number, instance.uid, mobile],
      );
    }
  } catch (error) {
    newLogger.error("QR contact-name sync failed:", error);
  }
}

const MAX_RECONNECT_ATTEMPTS = Number(process.env.QR_MAX_RECONNECT_ATTEMPTS || 8);
const RECONNECT_BASE_DELAY_MS = Number(process.env.QR_RECONNECT_BASE_DELAY_MS || 5000);
const RECONNECT_MAX_DELAY_MS = Number(process.env.QR_RECONNECT_MAX_DELAY_MS || 300000);
const CONNECTION_STALL_TIMEOUT_MS = Number(process.env.QR_CONNECTION_STALL_TIMEOUT_MS || 120000);
const AUTH_RETENTION_DAYS = Number(process.env.QR_AUTH_RETENTION_DAYS || 7);
const AUTH_CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000;
const BAILEYS_VERSION_CACHE_MS = 24 * 60 * 60 * 1000;
let authCleanupTimer = null;
let cachedBaileysVersion = null;
let baileysVersionCachedAt = 0;

// Lazy load storage modules
let useMySQLAuthState = null;
let useMongoDBAuthState = null;

// Configuration loaded flag
let configLoaded = false;

/**
 * Load configuration from database
 */
async function loadConfigFromDatabase() {
  if (configLoaded) return;

  try {
    const [config] = await query(`SELECT * FROM web_private`, []);

    if (config) {
      // Load MongoDB connection string from database
      if (config.mongodb_string) {
        MONGODB_URI = config.mongodb_string;
        newLogger.log("MongoDB URI loaded from database");
      }

      // Load storage method from database
      if (config.qr_storage) {
        STORAGE_METHOD = config.qr_storage.toLowerCase(); // mongodb/mysql/local
        newLogger.log(`Storage method loaded from database: ${STORAGE_METHOD}`);
      }
    }

    configLoaded = true;
  } catch (error) {
    newLogger.error("Error loading config from database:", error);
    newLogger.log("Using default configuration");
    configLoaded = true;
  }
}

/**
 * Get MongoDB configuration
 */
function getMongoDBConfig() {
  return {
    mongoUri: MONGODB_URI || "mongodb://localhost:27017",
    dbName: process.env.MONGO_DB_NAME || "wacrm_session",
  };
}

/**
 * Load the appropriate auth state module based on storage method
 */
async function loadAuthStateModule() {
  // Ensure config is loaded first
  await loadConfigFromDatabase();

  if (STORAGE_METHOD === "mysql" && !useMySQLAuthState) {
    const mysqlBaileys = require("mysql-baileys");
    useMySQLAuthState = mysqlBaileys.useMySQLAuthState;
  } else if (STORAGE_METHOD === "mongodb" && !useMongoDBAuthState) {
    const mongoSession = require("./mongoSession");
    useMongoDBAuthState = mongoSession.useMongoDBAuthState;
  } else if (STORAGE_METHOD === "local") {
  }
}

/**
 * Extract user ID from session ID
 */
function extractUidFromSessionId(input) {
  return input.split("_")[0];
}

async function resolveUidFromSessionId(sessionId) {
  const quick = extractUidFromSessionId(String(sessionId || ""));
  if (quick && quick !== "qr") {
    return quick;
  }

  try {
    const [row] = await query(
      "SELECT uid FROM instance WHERE uniqueId = ? LIMIT 1",
      [sessionId],
    );
    return row?.uid ? String(row.uid) : quick;
  } catch (err) {
    newLogger.error("resolveUidFromSessionId error:", err);
    return quick;
  }
}

/**
 * Extract phone number from WhatsApp ID
 */
function extractPhoneNumber(str) {
  if (!str) return null;
  const match = str.match(/^(\d+)(?=:|\@)/);
  return match ? match[1] : null;
}

/**
 * Check if a session exists in active connections
 */
const isSessionExists = (sessionId) => {
  return activeConnections.has(sessionId);
};

function clearReconnectTimer(sessionId) {
  const timer = reconnectTimers.get(sessionId);
  if (timer) {
    clearTimeout(timer);
    reconnectTimers.delete(sessionId);
  }
}

function resetReconnectState(sessionId) {
  reconnectAttempts.delete(sessionId);
  clearReconnectTimer(sessionId);
  const watchdog = connectionWatchdogs.get(sessionId);
  if (watchdog) clearTimeout(watchdog);
  connectionWatchdogs.delete(sessionId);
}

function getReconnectDelay(attempt) {
  const delayMs = RECONNECT_BASE_DELAY_MS * Math.pow(2, Math.max(0, attempt - 1));
  return Math.min(delayMs, RECONNECT_MAX_DELAY_MS);
}

function closeSocketQuietly(sock) {
  if (!sock) return;
  try {
    if (typeof sock.end === "function") {
      sock.end();
    } else if (sock.ws?.close) {
      sock.ws.close();
    }
  } catch (error) {
    newLogger.warn("Socket close cleanup failed:", error?.message || error);
  }
}

async function markSessionStatus(sessionId, status) {
  try {
    await query(
      `UPDATE instance
       SET status = ?,
           inactiveSince = CASE
             WHEN ? = 'INACTIVE' THEN COALESCE(inactiveSince, NOW())
             ELSE NULL
           END
       WHERE uniqueId = ?`,
      [status, status, sessionId],
    );
  } catch (error) {
    newLogger.error(`Database update error (${status}):`, error);
  }
}

async function getCachedBaileysVersion(sessionId) {
  if (cachedBaileysVersion && Date.now() - baileysVersionCachedAt < BAILEYS_VERSION_CACHE_MS) {
    return cachedBaileysVersion;
  }
  try {
    const latest = await fetchLatestBaileysVersion();
    if (latest?.version) {
      cachedBaileysVersion = latest.version;
      baileysVersionCachedAt = Date.now();
    }
    if (latest?.error) {
      newLogger.warn(`Session ${sessionId}: Baileys version lookup failed; using cached or package fallback.`);
    }
  } catch (versionError) {
    newLogger.warn(`Session ${sessionId}: Baileys version lookup unavailable; using cached or package defaults.`);
  }
  return cachedBaileysVersion;
}

function scheduleReconnect(sessionId, title, options, statusCode) {
  if (reconnectTimers.has(sessionId)) {
    return;
  }

  const nextAttempt = (reconnectAttempts.get(sessionId) || 0) + 1;

  if (nextAttempt > MAX_RECONNECT_ATTEMPTS) {
    newLogger.warn(
      `Session ${sessionId} reconnect limit reached after ${MAX_RECONNECT_ATTEMPTS} attempts; marking inactive.`,
    );
    activeConnections.delete(sessionId);
    reconnectAttempts.delete(sessionId);
    markSessionStatus(sessionId, "INACTIVE");
    return;
  }

  reconnectAttempts.set(sessionId, nextAttempt);
  const delayMs = getReconnectDelay(nextAttempt);

  newLogger.log(
    `Session ${sessionId} disconnected (code: ${statusCode}), reconnecting in ${Math.round(
      delayMs / 1000,
    )}s (attempt ${nextAttempt}/${MAX_RECONNECT_ATTEMPTS})`,
  );

  const jitterMs = Math.floor(Math.random() * Math.min(5000, Math.max(1000, delayMs * 0.1)));
  const timer = setTimeout(() => {
    reconnectTimers.delete(sessionId);
    createSession(sessionId, title, options);
  }, delayMs + jitterMs);

  if (typeof timer.unref === "function") timer.unref();
  reconnectTimers.set(sessionId, timer);
}

/**
 * Helper to delete local session files
 */
const deleteSessionFiles = async (sessionId) => {
  const sessionDir = sessionsDir(sessionId);
  await fs.promises.rm(sessionDir, {
    recursive: true,
    force: true,
    maxRetries: 3,
    retryDelay: 500,
  });
};

// ============= AUTH STATE HANDLER =============

/**
 * Get authentication state based on storage method
 */
async function getAuthState(sessionId) {
  await loadAuthStateModule();

  switch (STORAGE_METHOD) {
    case "mysql":
      newLogger.log(`Using MySQL storage for session: ${sessionId}`);
      return await useMySQLAuthState({
        ...MYSQL_CONFIG,
        session: sessionId,
      });

    case "mongodb":
      newLogger.log(`Using MongoDB storage for session: ${sessionId}`);
      const mongoConfig = getMongoDBConfig();

      if (
        !mongoConfig.mongoUri ||
        mongoConfig.mongoUri === "mongodb://localhost:27017"
      ) {
        newLogger.warn("Warning: MongoDB URI not configured properly!");
      }

      return await useMongoDBAuthState({
        ...mongoConfig,
        session: sessionId,
      });

    case "local":
      return await useMultiFileAuthState(sessionsDir(sessionId));

    default:
      throw new Error(`Invalid storage method: ${STORAGE_METHOD}`);
  }
}

/**
 * Delete session data based on storage method
 */
async function deleteSessionData(sessionId) {
  switch (STORAGE_METHOD) {
    case "mysql":
      // MySQL cleanup is handled by removeCreds() during logout
      newLogger.log(`MySQL session data cleaned for: ${sessionId}`);
      break;

    case "mongodb":
      const { deleteSessionFromDB } = require("./mongoSession");
      await deleteSessionFromDB(sessionId);
      newLogger.log(`MongoDB session data deleted for: ${sessionId}`);
      break;

    case "local":
      await deleteSessionFiles(sessionId);
      newLogger.log(`Local files deleted for: ${sessionId}`);
      break;
  }
}

// ============= SESSION MANAGEMENT =============

/**
 * Create a new WhatsApp session
 */
const createSession = async (
  sessionId,
  title = "Chrome",
  options = { onQr: null, syncFullHistory: false },
) => {
  if (process.env.LOCAL_ONLY_MODE === "true") return "WhatsApp sessions are disabled in local training mode";
  if (!sessionId) return "Invalid session";

  if (connectingSessions.has(sessionId)) {
    newLogger.log(`Session ${sessionId} is already connecting`);
    return "Session already connecting";
  }

  const existingSession = activeConnections.get(sessionId);
  if (existingSession?.ws?.readyState === 1 || existingSession?.user) {
    newLogger.log(`Session ${sessionId} is already active`);
    return "Session already active";
  }

  if (existingSession) {
    activeConnections.delete(sessionId);
    closeSocketQuietly(existingSession);
  }

  connectingSessions.add(sessionId);

  try {
    // Load baileys functions first
    await loadBaileysIfNeeded();

    // Ensure configuration is loaded
    await loadConfigFromDatabase();

    const logger = pino({ level: "silent" });
    const version = await getCachedBaileysVersion(sessionId);

    // Get authentication state based on storage method
    const { state, saveCreds, removeCreds } = await getAuthState(sessionId);

    // Create WhatsApp connection
    const sock = makeWASocket({
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, logger),
      },
      version,
      logger,
      printQRInTerminal: false,
      browser: [title, "", ""],
      syncFullHistory: options.syncFullHistory,
      defaultQueryTimeoutMs: 60000,
      connectTimeoutMs: 60000,
      keepAliveIntervalMs: 30000,
      markOnlineOnConnect: true,
      generateHighQualityLinkPreview: true,
    });

    // Store active connection
    activeConnections.set(sessionId, sock);
    connectingSessions.delete(sessionId);

    // Handle credential updates
    sock.ev.on("creds.update", saveCreds);

    // WhatsApp address-book names arrive through contact sync events. Keep a
    // session-local cache and repair existing chat rows when those events land.
    sock.ev.on("contacts.upsert", async (contacts) => {
      await syncQrContactNamesToChats(sessionId, contacts);
    });

    sock.ev.on("contacts.update", async (contacts) => {
      await syncQrContactNamesToChats(sessionId, contacts);
    });

    sock.ev.on(
      "messaging-history.set",
      async ({ contacts = [], chats = [] } = {}) => {
        await syncQrContactNamesToChats(sessionId, [...contacts, ...chats]);
      },
    );

    sock.ev.on("chats.upsert", async (chats) => {
      await syncQrContactNamesToChats(sessionId, chats);
    });

    sock.ev.on("chats.update", async (chats) => {
      await syncQrContactNamesToChats(sessionId, chats);
    });

    // Handle messages update (for poll updates)
    sock.ev.on("messages.update", async (m) => {
      const message = m[0];

      if (message?.update && message?.key?.remoteJid !== "status@broadcast") {
        const uid = await resolveUidFromSessionId(sessionId);
        if (uid && message?.update?.status) {
          processMessage({
            body: message,
            uid,
            origin: "qr",
            getSession,
            sessionId,
            qrType: "update",
          });
        }
      }
    });

    const normalizeMessageJid = (msg) => {
      if (!msg?.key) return msg;

      const main = msg.key.remoteJid;
      const alt = msg.key.remoteJidAlt;

      if (main === "status@broadcast" || alt === "status@broadcast") {
        // Tag it so downstream code can detect it easily
        msg._isStatusBroadcast = true;
        return msg;
      }

      // For regular messages: pick the one ending with @s.whatsapp.net
      const correct =
        main && main.endsWith("@s.whatsapp.net")
          ? main
          : alt && alt.endsWith("@s.whatsapp.net")
            ? alt
            : main || alt;

      msg.key.remoteJid = correct;

      return msg;
    };

    sock.ev.on("messages.upsert", async (m) => {
      let message = m.messages[0];
      if (!message) return;

      message = normalizeMessageJid(message);

      const remoteJid = message.key.remoteJid;

      const savedContactName = getCachedQrContactName(sessionId, remoteJid);
      if (savedContactName) {
        message.pushName = savedContactName;
      }

      if (
        !remoteJid ||
        remoteJid === "status@broadcast" ||
        remoteJid.includes("broadcast") ||
        message._isStatusBroadcast === true ||
        message.key.fromMe === undefined ||
        // Stories often have a statusValue or status message type
        message.message?.protocolMessage?.type === 25 ||
        message.message?.senderKeyDistributionMessage?.groupId ===
          "status@broadcast"
      ) {
        return; // Skip — this is a Story/Status update
      }

      const isDirectChatJid =
        remoteJid.endsWith("@s.whatsapp.net") || remoteJid.endsWith("@lid");

      if ((m.type === "notify" || m.type === "append") && isDirectChatJid) {
        const uid = await resolveUidFromSessionId(sessionId);
        if (uid) {
          processMessage({
            body: message,
            uid,
            origin: "qr",
            getSession,
            sessionId,
            qrType: "upsert",
          });
        }
      }
    });

    // Handle connection updates
    sock.ev.on(
      "connection.update",
      async ({ connection, lastDisconnect, qr }) => {
        if (connection === "open") {
          const watchdog = connectionWatchdogs.get(sessionId);
          if (watchdog) clearTimeout(watchdog);
          connectionWatchdogs.delete(sessionId);
          resetReconnectState(sessionId);
          try {
            const userData = sock.user || {};
            await query(
              "UPDATE instance SET status = ?, inactiveSince = NULL, number = ?, data = ? WHERE uniqueId = ?",
              [
                "ACTIVE",
                extractPhoneNumber(userData?.id) || null,
                userData?.id ? JSON.stringify(userData) : null,
                sessionId,
              ],
            );
          } catch (error) {
            newLogger.error("Database update error (open):", error);
          }
        } else if (connection === "close") {
          const watchdog = connectionWatchdogs.get(sessionId);
          if (watchdog) clearTimeout(watchdog);
          connectionWatchdogs.delete(sessionId);
          const statusCode = lastDisconnect?.error?.output?.statusCode;
          activeConnections.delete(sessionId);
          connectingSessions.delete(sessionId);
          contactNamesBySession.delete(sessionId);
          closeSocketQuietly(sock);

          if (statusCode === DisconnectReason.loggedOut) {
            newLogger.log(`Session ${sessionId} logged out`);
            resetReconnectState(sessionId);

            // Remove confirmed logged-out credentials without allowing a
            // filesystem permission error to terminate the whole app process.
            try {
              if (removeCreds) await removeCreds();
            } catch (error) {
              newLogger.error(`Credential removal failed for a logged-out session:`, error?.message || error);
            }
            try {
              await deleteSessionData(sessionId);
            } catch (error) {
              newLogger.error(`Auth-folder cleanup failed for a logged-out session:`, error?.message || error);
            }

            try {
              await query("UPDATE instance SET status = ?, inactiveSince = NOW() WHERE uniqueId = ?", [
                "INACTIVE", sessionId,
              ]);
            } catch (error) {
              newLogger.error("Database update error (logout):", error);
            }
          } else {
            await markSessionStatus(sessionId, "RECONNECTING");
            scheduleReconnect(sessionId, title, options, statusCode);
          }
        }

        if (qr) {
          try {
            const qrCodeImage = await toDataURL(qr);
            try {
              await query("UPDATE instance SET qr = ? WHERE uniqueId = ?", [
                qrCodeImage,
                sessionId,
              ]);
            } catch (error) {
              newLogger.error("Database update error (qr):", error);
            }

            if (typeof options.onQr === "function") {
              options.onQr(qrCodeImage);
            }
          } catch (error) {
            newLogger.error("QR processing error:", error);
          }
        }
      },
    );

    if (sock.ws?.readyState !== 1 || !sock.user?.id) {
      const watchdog = setTimeout(async () => {
        connectionWatchdogs.delete(sessionId);
        if (activeConnections.get(sessionId) !== sock) return;
        if (sock.ws?.readyState === 1 && sock.user?.id) return;
        newLogger.warn(`Session ${sessionId} did not finish connecting within ${Math.round(CONNECTION_STALL_TIMEOUT_MS / 1000)}s; retrying with backoff.`);
        activeConnections.delete(sessionId);
        contactNamesBySession.delete(sessionId);
        closeSocketQuietly(sock);
        await markSessionStatus(sessionId, "RECONNECTING");
        scheduleReconnect(sessionId, title, options, "connection-timeout");
      }, CONNECTION_STALL_TIMEOUT_MS);
      if (typeof watchdog.unref === "function") watchdog.unref();
      connectionWatchdogs.set(sessionId, watchdog);
    }

    return "Session initiated";
  } catch (error) {
    connectingSessions.delete(sessionId);
    newLogger.error(`Error creating session ${sessionId}:`, error);
    if (sessionId) {
      await markSessionStatus(sessionId, "RECONNECTING");
      scheduleReconnect(sessionId, title, options, error?.output?.statusCode);
    }
    return "Failed to create session";
  }
};

/**
 * Get an active session
 */
const getSession = (sessionId) => {
  return activeConnections.get(sessionId) || null;
};

const getSessionStats = () => ({
  activeConnections: activeConnections.size,
  openConnections: [...activeConnections.values()].filter((sock) => sock?.ws?.readyState === 1 && sock?.user?.id).length,
  connectionWatchdogs: connectionWatchdogs.size,
  connectingSessions: connectingSessions.size,
  reconnectTimers: reconnectTimers.size,
  reconnectingSessions: reconnectAttempts.size,
});

async function cleanupLocalAuth() {
  if (STORAGE_METHOD !== "local") return { skipped: true };
  const root = path.resolve(sessionsDir());
  const rows = await query("SELECT uniqueId, status, inactiveSince FROM instance", []);
  const byId = new Map(rows.map((row) => [String(row.uniqueId), row]));
  let orphaned = 0;
  let expired = 0;
  const cutoff = Date.now() - AUTH_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  let entries;
  try {
    entries = await fs.promises.readdir(root, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") return { orphaned, expired };
    throw error;
  }

  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith("md_")) continue;
    const sessionId = entry.name.slice(3);
    if (!sessionId || sessionId.includes("/") || sessionId.includes("\\")) continue;
    const dir = path.resolve(root, entry.name);
    if (path.dirname(dir) !== root) continue;
    if (activeConnections.has(sessionId) || connectingSessions.has(sessionId)) continue;
    const row = byId.get(sessionId);
    if (!row) {
      const stat = await fs.promises.stat(dir);
      if (stat.mtimeMs > cutoff) continue;
      await fs.promises.rm(dir, { recursive: true, force: true, maxRetries: 2, retryDelay: 250 });
      orphaned += 1;
      break;
    }
    const inactiveAt = row.inactiveSince ? new Date(row.inactiveSince).getTime() : NaN;
    if (String(row.status).toUpperCase() === "INACTIVE" && Number.isFinite(inactiveAt) && inactiveAt <= cutoff) {
      await fs.promises.rm(dir, { recursive: true, force: true, maxRetries: 2, retryDelay: 250 });
      expired += 1;
      break;
    }
  }
  if (orphaned || expired) {
    newLogger.log(`QR auth retention cleanup removed ${orphaned} orphaned and ${expired} expired local auth folders.`);
  }
  return { orphaned, expired };
}

function startAuthCleanup() {
  if (authCleanupTimer || STORAGE_METHOD !== "local") return;
  const firstRunTimer = setTimeout(() => {
    cleanupLocalAuth().catch((error) => newLogger.error("QR auth cleanup failed:", error?.message || error));
  }, 15 * 60 * 1000);
  if (typeof firstRunTimer.unref === "function") firstRunTimer.unref();
  authCleanupTimer = setInterval(() => {
    cleanupLocalAuth().catch((error) => newLogger.error("QR auth cleanup failed:", error?.message || error));
  }, AUTH_CLEANUP_INTERVAL_MS);
  if (typeof authCleanupTimer.unref === "function") authCleanupTimer.unref();
}

/**
 * Delete a session
 */
const deleteSession = async (sessionId) => {
  try {
    resetReconnectState(sessionId);
    connectingSessions.delete(sessionId);
    const session = getSession(sessionId);
    if (session) {
      try {
        await session.logout();
      } catch (error) {
        newLogger.error(`Error logging out session ${sessionId}:`, error);
      }
      activeConnections.delete(sessionId);
    }

    // Delete session data based on storage method
    await deleteSessionData(sessionId);

    try {
      await query("UPDATE instance SET status = ?, inactiveSince = NOW() WHERE uniqueId = ?", [
        "INACTIVE", sessionId,
      ]);
    } catch (error) {
      newLogger.error("Database update error (deleteSession):", error);
    }
  } catch (error) {
    newLogger.error(`Error deleting session ${sessionId}:`, error);
  }
};

/**
 * Check if a phone number or group exists
 */
const isExists = async (session, jid, isGroup = false) => {
  try {
    let result;
    if (isGroup) {
      result = await session.groupMetadata(jid);
      return Boolean(result.id);
    }
    [result] = await session.onWhatsApp(jid);
    if (typeof result === "undefined") {
      const getNum = jid.replace("@s.whatsapp.net", "");
      [result] = await session.onWhatsApp(`+${getNum}`);
    }
    return result?.exists;
  } catch (err) {
    newLogger.error("isExists error:", err);
    return false;
  }
};

/**
 * Send a message
 */
const sendMessage = async (session, receiver, message) => {
  try {
    await loadBaileysIfNeeded();

    if (message?.text) {
      try {
        const linkPreview = await getUrlInfo(message.text, {
          thumbnailWidth: 1024,
          fetchOpts: { timeout: 5000 },
          uploadImage: session.waUploadToServer,
        });

        message = {
          text: message.text,
          linkPreview,
        };
      } catch (error) {
        newLogger.error("Error generating link preview:", error);
      }
    }

    await delay(1000);
    return session.sendMessage(receiver, message);
  } catch (err) {
    newLogger.error("sendMessage error:", err);
    return Promise.reject(null);
  }
};

/**
 * Get group metadata
 */
const getGroupData = async (session, jid) => {
  try {
    return await session.groupMetadata(jid);
  } catch (err) {
    newLogger.error("getGroupData error:", err);
    return Promise.reject(null);
  }
};

/**
 * Format phone number to WhatsApp JID
 */
const formatPhone = (phone) => {
  if (phone.endsWith("@s.whatsapp.net")) return phone;
  let formatted = phone.replace(/\D/g, "");
  return formatted + "@s.whatsapp.net";
};

/**
 * Format group ID to WhatsApp group JID
 */
const formatGroup = (group) => {
  if (group.endsWith("@g.us")) return group;
  let formatted = group.replace(/[^\d-]/g, "");
  return formatted + "@g.us";
};

/**
 * Cleanup function for graceful shutdown
 */
const cleanup = async () => {
  newLogger.log("Running cleanup before exit...");
  const cleanupPromises = [];

  activeConnections.forEach((session, sessionId) => {
    newLogger.log(`Closing session ${sessionId}`);
    cleanupPromises.push(
      session.end().catch((error) => {
        newLogger.error(`Error closing session ${sessionId}:`, error);
      }),
    );
  });

  await Promise.allSettled(cleanupPromises);
  newLogger.log("Cleanup completed");
};

/**
 * Initialize existing sessions from database or local files
 */
const init = async () => {
  try {
    await loadBaileysIfNeeded();
    await loadConfigFromDatabase();
    const syncFullHistory = process.env.QR_SYNC_FULL_HISTORY === "true";

    if (STORAGE_METHOD === "local") {
      // Initialize only sessions that the database still considers live.
      // Loading every auth folder revives stale QR sessions and can exhaust heap.
      const sessionsPath = sessionsDir();
      try {
        await fs.promises.access(sessionsPath);
      } catch {
        await fs.promises.mkdir(sessionsPath, { recursive: true });
      }

      const liveInstances = await query(
        "SELECT uniqueId, status, inactiveSince FROM instance WHERE status IN ('ACTIVE', 'RECONNECTING') OR (status = 'INACTIVE' AND inactiveSince >= DATE_SUB(NOW(), INTERVAL 1 DAY))",
        [],
      );
      const instanceById = new Map(liveInstances.map((row) => [String(row.uniqueId), row]));

      const files = await fs.promises.readdir(sessionsPath);
      const sessionFiles = [];
      for (const file of files) {
        if (!file.startsWith("md_")) continue;
        const stat = await fs.promises.lstat(path.join(sessionsPath, file));
        const sessionId = file.replace("md_", "");
        if (stat.isDirectory() && instanceById.has(sessionId)) {
          sessionFiles.push({ file, modified: stat.mtimeMs });
        }
      }
      // An earlier GET endpoint may have mislabeled a live device INACTIVE.
      // Only recover the most recently touched such folders, with a small cap.
      const inactiveCandidates = sessionFiles
        .filter(({ file }) => String(instanceById.get(file.slice(3))?.status).toUpperCase() === "INACTIVE")
        .sort((a, b) => b.modified - a.modified)
        .slice(0, 1);
      const candidateNames = new Set(inactiveCandidates.map(({ file }) => file));
      const orderedFiles = [
        ...sessionFiles.filter(({ file }) => !candidateNames.has(file)),
        ...inactiveCandidates,
      ];
      for (const { file } of orderedFiles) {
        const sessionId = file.slice(3);
        await markSessionStatus(sessionId, "RECONNECTING");
        await createSession(sessionId, undefined, { syncFullHistory });
        await delay(2000);
      }
    } else {
      // Initialize from database (MySQL/MongoDB)
      const instances = await query(
        "SELECT uniqueId FROM instance WHERE status = 'ACTIVE'",
        [],
      );

      for (const instance of instances) {
        await markSessionStatus(instance.uniqueId, "RECONNECTING");
        await createSession(instance.uniqueId, undefined, { syncFullHistory });
        await delay(500);
      }
    }
    startAuthCleanup();
  } catch (error) {
    newLogger.error("Error initializing sessions:", error);
  }
};

/**
 * Check if QR code functionality is available
 */
function checkQr() {
  return true;
}

/**
 * Get current storage configuration (for debugging/monitoring)
 */
const getStorageConfig = async () => {
  await loadConfigFromDatabase();
  return {
    method: STORAGE_METHOD,
    mongoUri: MONGODB_URI ? "***configured***" : "not set",
    mysqlHost: MYSQL_CONFIG.host,
  };
};

// Wrapper functions
const wrappedGetUrlInfo = async (...args) => {
  await loadBaileysIfNeeded();
  return getUrlInfo(...args);
};

const wrappedDownloadMediaMessage = async (...args) => {
  await loadBaileysIfNeeded();
  return downloadMediaMessage(...args);
};

const wrappedGenerateProfilePicture = async (...args) => {
  await loadBaileysIfNeeded();
  return generateProfilePicture(...args);
};

// ============= EXPORTS =============

module.exports = {
  isSessionExists,
  createSession,
  getSession,
  deleteSession,
  isExists,
  sendMessage,
  formatPhone,
  formatGroup,
  cleanup,
  init,
  getGroupData,
  getUrlInfo: wrappedGetUrlInfo,
  downloadMediaMessage: wrappedDownloadMediaMessage,
  checkQr,
  generateProfilePicture: wrappedGenerateProfilePicture,
  getStorageConfig, // Export for debugging
  getSessionStats,
};
