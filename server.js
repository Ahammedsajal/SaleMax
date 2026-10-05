require("dotenv").config({ silent: true });
const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const fileUpload = require("express-fileupload");
const nodeCleanup = require("node-cleanup");
const { initCampaign } = require("./loops/campaignBeta.js");
const { init, cleanup, getSessionStats } = require("./helper/addon/qr");
const { warmerLoopInit } = require("./helper/addon/qr/warmer/index.js");
const { initTele, cleanupTele } = require("./helper/addon/telegram/tele.js");
const {
  initWhatsAppRetentionCleanup,
} = require("./helper/maintenance/whatsappRetention.js");
const { query } = require("./database/dbpromise.js");
const { startCrmAccountSyncWorker } = require("./functions/crmAccountSync.js");
const { isLicenseActivated } = require("./middlewares/license.js");
const receiptWorkerRuntime = require("./modules/platform/training-receipt-worker-runtime");
const taskNotificationWorkerRuntime = require("./modules/platform/task-notification-worker-runtime");

const app = express();
let receiptWorkerProcess = null;
let taskNotificationWorkerProcess = null;
const currentDir = process.cwd();
const publicDir = path.resolve(currentDir, "./client/public");

const frontendAssetPathPattern = /(?:src|href)=["'](\/static\/[^"']+)["']/g;

function validateAndRepairFrontendShell() {
  const indexPath = path.join(publicDir, "index.html");
  const manifestPath = path.join(publicDir, "asset-manifest.json");

  if (!fs.existsSync(indexPath)) {
    throw new Error(`Frontend shell is missing: ${indexPath}`);
  }

  let html = fs.readFileSync(indexPath, "utf8");
  const missingAssets = [];
  let match;

  while ((match = frontendAssetPathPattern.exec(html)) !== null) {
    // Ignore cache-busting query strings when checking the local file path.
    const assetPath = match[1].split(/[?#]/, 1)[0];
    if (!fs.existsSync(path.join(publicDir, assetPath))) {
      missingAssets.push(assetPath);
    }
  }

  if (!missingAssets.length) return;

  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  } catch (error) {
    throw new Error(
      `Frontend references missing assets (${missingAssets.join(
        ", ",
      )}) and asset-manifest.json could not be read: ${error.message}`,
    );
  }

  const replacementByType = {
    ".js": manifest?.files?.["main.js"],
    ".css": manifest?.files?.["main.css"],
  };

  let repairedHtml = html;
  for (const missingAsset of missingAssets) {
    const ext = path.extname(missingAsset);
    const replacement = replacementByType[ext];
    if (!replacement || !fs.existsSync(path.join(publicDir, replacement))) {
      throw new Error(
        `Frontend references missing asset ${missingAsset}, and no valid replacement was found in asset-manifest.json`,
      );
    }
    repairedHtml = repairedHtml.split(missingAsset).join(replacement);
  }

  fs.writeFileSync(indexPath, repairedHtml);
  console.warn(
    `Repaired stale frontend asset references in index.html: ${missingAssets.join(
      ", ",
    )}`,
  );
}

validateAndRepairFrontendShell();

// Mounted before global body parsers so auth and contract limits remain effective.
require('./modules/platform/mount-existing-upgrade').mountConfiguredUpgrade(app);

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ limit: "10mb", extended: true }));
app.use(cors());
app.use(fileUpload());

app.get("/healthz", (request, response) => {
  const memory = process.memoryUsage();
  response.json({
    success: true,
    status: "ok",
    uptime: process.uptime(),
    memory: {
      rss: memory.rss,
      heapTotal: memory.heapTotal,
      heapUsed: memory.heapUsed,
      external: memory.external,
      arrayBuffers: memory.arrayBuffers,
    },
    qr: getSessionStats(),
    timestamp: new Date().toISOString(),
  });
});

// ─── Routes ───────────────────────────────────────────────────────────────────
app.use("/sso", (req, res, next) => {
  if (process.env.CRM_INTEGRATION_ENABLED === "false") {
    return res.status(503).json({ success: false, message: "External CRM sign-in is disabled for this Salemax deployment." });
  }
  next();
}, require("./routes/sso"));
app.use("/api/user", require("./routes/user"));
app.use("/api/web", require("./routes/web"));
app.use("/api/admin", require("./routes/admin"));
app.use("/api/phonebook", require("./routes/phonebook"));
app.use("/api/chat_flow", require("./routes/chatFlow"));
app.use("/api/inbox", require("./routes/inbox"));
app.use("/api/templet", require("./routes/templet"));
app.use("/api/chatbot", require("./routes/chatbot"));
app.use("/api/broadcast", require("./routes/broadcast"));
app.use("/api/v1", require("./routes/apiv2"));
app.use("/api/agent", require("./routes/agent"));
app.use("/api/qr", require("./routes/qr"));
app.use("/api/ai", require("./routes/ai"));
app.use("/api/webhook", require("./routes/webhook"));
app.use("/api/wa_call", require("./routes/waCall"));
app.use("/api/telegram", require("./routes/telegram"));
app.use("/api/theme", require("./routes/theme"));
app.use("/api/pipeline", require("./routes/pipeline"));
app.use("/api/internal", require("./routes/internal"));

// ─── Media Streaming Middleware ───────────────────────────────────────────────
const createMediaMiddleware = (folderPath) => {
  const mimeTypes = {
    // Video
    ".mp4": "video/mp4",
    ".webm": "video/webm",
    ".mov": "video/quicktime",
    ".avi": "video/x-msvideo",
    // Audio
    ".mp3": "audio/mpeg",
    ".ogg": "audio/ogg",
    ".opus": "audio/opus",
    ".wav": "audio/wav",
    ".m4a": "audio/mp4",
    ".aac": "audio/aac",
  };

  return express.static(path.resolve(currentDir, folderPath), {
    setHeaders: (res, filePath) => {
      res.setHeader("Accept-Ranges", "bytes");

      const ext = path.extname(filePath).toLowerCase();
      if (mimeTypes[ext]) {
        res.setHeader("Content-Type", mimeTypes[ext]);
      }

      res.setHeader("Cache-Control", "public, max-age=31536000");
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Range");
    },
    index: false,
    acceptRanges: true,
  });
};

app.use("/media", createMediaMiddleware("./client/public/media"));
app.use("/meta-media", createMediaMiddleware("./client/public/meta-media"));

// ─── Static & Catch-All ───────────────────────────────────────────────────────
app.use(express.static(publicDir));

app.use(["/static", "/assets"], (request, response) => {
  response.status(404).json({
    success: false,
    message: "Static asset not found",
    path: request.path,
  });
});

// Admin setup screen route
app.get("/admin-setup", (req, res) => {
  return res.sendFile(path.resolve(publicDir, "admin-setup.html"));
});

// If license is activated but no admin exists yet, force the admin setup screen
app.get("*", async (request, response, next) => {
  try {
    if (request.method !== "GET") return next();

    const accept = request.get("accept") || "";
    if (!accept.includes("text/html")) return next();

    const p = request.path || "/";
    if (
      p === "/admin-setup" ||
      p === "/admin-setup.html" ||
      p.startsWith("/api") ||
      p.startsWith("/media") ||
      p.startsWith("/meta-media") ||
      p.startsWith("/static") ||
      p.startsWith("/assets")
    ) {
      return next();
    }

    if (!isLicenseActivated()) {
      return next();
    }

    // If DB is not ready, don't block the UI
    let hasAdmin = false;
    try {
      const rows = await query(`SELECT uid FROM admin LIMIT 1`, []);
      hasAdmin = rows?.length > 0;
    } catch (_) {
      hasAdmin = false;
    }

    if (!hasAdmin) {
      return response.sendFile(path.resolve(publicDir, "admin-setup.html"));
    }

    return next();
  } catch (err) {
    return next();
  }
});

app.get("*", function (request, response) {
  response.sendFile(path.resolve(publicDir, "index.html"));
});

// ─── Server ───────────────────────────────────────────────────────────────────
const server = app.listen(process.env.PORT || 3010, process.env.HOST || "127.0.0.1", () => {
  console.log(`SaleMaX server is running on port ${process.env.PORT}`);
  receiptWorkerProcess = receiptWorkerRuntime.start();
  if (receiptWorkerProcess) {
    receiptWorkerProcess.once("error", () => console.error("Receipt email worker could not start."));
    receiptWorkerProcess.once("exit", (code) => {
      receiptWorkerProcess = null;
      if (code !== 0 && code !== null) console.error("Receipt email worker stopped with an error.");
    });
  }
  if (process.env.LOCAL_ONLY_MODE === "true") {
    console.log("Local training mode: external provider workers are disabled; receipt email requires its separate explicit opt-in.");
    return;
  }
  taskNotificationWorkerProcess = taskNotificationWorkerRuntime.start();
  if (taskNotificationWorkerProcess) {
    taskNotificationWorkerProcess.once("error", () => console.error("Task email worker could not start."));
    taskNotificationWorkerProcess.once("exit", (code) => {
      taskNotificationWorkerProcess = null;
      if (code !== 0 && code !== null) console.error("Task email worker stopped with an error.");
    });
  }
  startCrmAccountSyncWorker();
  init();
  setTimeout(() => {
    warmerLoopInit();
    initCampaign();
    initTele();
    initWhatsAppRetentionCleanup();
  }, 1000);
});

// ─── Socket.IO ────────────────────────────────────────────────────────────────
const io = require("./socket").initializeSocket(server);
module.exports = io;

// ─── Cleanup ──────────────────────────────────────────────────────────────────
nodeCleanup(async (exitCode, signal) => {
  const receiptWorker = receiptWorkerProcess;
  if (receiptWorker && receiptWorker.exitCode === null) {
    await new Promise((resolve) => {
      const timeout = setTimeout(() => { receiptWorker.kill("SIGKILL"); resolve(); }, 2000);
      receiptWorker.once("exit", () => { clearTimeout(timeout); resolve(); });
      receiptWorker.kill("SIGTERM");
    });
  }
  const taskWorker = taskNotificationWorkerProcess;
  if (taskWorker && taskWorker.exitCode === null) {
    await new Promise((resolve) => {
      const timeout = setTimeout(() => { taskWorker.kill("SIGKILL"); resolve(); }, 2000);
      taskWorker.once("exit", () => { clearTimeout(timeout); resolve(); });
      taskWorker.kill("SIGTERM");
    });
  }
  await cleanupTele();
  cleanup();
});

