const { query } = require("../database/dbpromise.js");
const fetch = require("node-fetch");

const CRM_PROVISION_URL = "https://crm.gccbot.com/api/internal/gccbot/sso/provision-user";
const MAX_ATTEMPTS_PER_PASS = 10;
let workerStarted = false;
let workerRunning = false;
const activeSyncs = new Set();

function activePaidPlan(user) {
  let plan = {};
  try {
    plan = JSON.parse(user.plan || "{}") || {};
  } catch (_) {
    plan = {};
  }

  return Number(plan.price || 0) > 0
    && Number(plan.is_trial || 0) !== 1
    && Number(user.plan_expire || 0) > Date.now();
}

async function queueUser(uid) {
  await query(
    `INSERT INTO crm_user_sync_queue (uid, attempts, next_attempt_at, last_status)
     VALUES (?, 0, NOW(), NULL)
     ON DUPLICATE KEY UPDATE attempts = 0, next_attempt_at = NOW(), last_status = NULL`,
    [String(uid)],
  );
}

async function provisionUser(uid) {
  const [user] = await query(
    `SELECT uid, email, name, plan, plan_expire FROM user WHERE uid = ? LIMIT 1`,
    [String(uid)],
  );

  if (!user) {
    await query(`DELETE FROM crm_user_sync_queue WHERE uid = ?`, [String(uid)]);
    return true;
  }

  const secret = String(process.env.CRM_INTERNAL_SECRET || "").trim();
  if (!secret) throw Object.assign(new Error("CRM is not configured"), { syncStatus: "not_configured" });

  const response = await fetch(CRM_PROVISION_URL, {
    method: "POST",
    timeout: 8000,
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "x-internal-secret": secret,
    },
    body: JSON.stringify({
      uid: String(user.uid),
      email: String(user.email || "").trim().toLowerCase(),
      name: String(user.name || "").trim(),
      paid_plan_active: activePaidPlan(user),
    }),
  });
  const payload = await response.json().catch(() => ({}));

  if (!response.ok || payload.success !== true) {
    throw Object.assign(new Error("CRM account sync failed"), {
      syncStatus: response.status === 409 ? "identity_conflict" : `http_${response.status}`,
      permanent: response.status === 409,
    });
  }

  await query(`DELETE FROM crm_user_sync_queue WHERE uid = ?`, [String(uid)]);
  return true;
}

async function attemptSync(uid) {
  const key = String(uid);
  if (activeSyncs.has(key)) return;
  activeSyncs.add(key);

  try {
    await provisionUser(key);
  } catch (error) {
    const status = String(error.syncStatus || "crm_unavailable").slice(0, 32);
    const retryAfterSeconds = error.permanent ? 86400 : 30;
    await query(
      `UPDATE crm_user_sync_queue
       SET attempts = attempts + 1,
           next_attempt_at = DATE_ADD(NOW(), INTERVAL ? SECOND),
           last_status = ?
       WHERE uid = ?`,
      [retryAfterSeconds, status, key],
    ).catch(() => {});
    console.warn("CRM account sync deferred", { status });
  } finally {
    activeSyncs.delete(key);
  }
}

async function syncOrQueueNodeUser(uid) {
  if (process.env.LOCAL_ONLY_MODE === "true") return;
  const key = String(uid || "").trim();
  if (!key) return;

  try {
    await queueUser(key);
    await attemptSync(key);
  } catch (_) {
    // Keep account creation and paid-plan activation available if the CRM sync
    // queue is temporarily unavailable; SSO also retries provisioning.
    console.error("CRM account sync could not be queued");
  }
}

async function processPending() {
  if (workerRunning) return;
  workerRunning = true;
  try {
    const pending = await query(
      `SELECT uid, attempts FROM crm_user_sync_queue
       WHERE next_attempt_at <= NOW()
       ORDER BY next_attempt_at ASC
       LIMIT ?`,
      [MAX_ATTEMPTS_PER_PASS],
    );

    for (const job of pending || []) {
      const key = String(job.uid);
      if (activeSyncs.has(key)) continue;
      activeSyncs.add(key);
      try {
        await provisionUser(key);
      } catch (error) {
        const attempts = Number(job.attempts || 0) + 1;
        const delay = error.permanent ? 86400 : Math.min(3600, 30 * (2 ** Math.min(attempts - 1, 7)));
        await query(
          `UPDATE crm_user_sync_queue
           SET attempts = ?, next_attempt_at = DATE_ADD(NOW(), INTERVAL ? SECOND), last_status = ?
           WHERE uid = ?`,
          [attempts, delay, String(error.syncStatus || "crm_unavailable").slice(0, 32), key],
        );
      } finally {
        activeSyncs.delete(key);
      }
    }
  } catch (_) {
    console.error("CRM account sync worker could not process its queue");
  } finally {
    workerRunning = false;
  }
}

function startCrmAccountSyncWorker() {
  if (process.env.LOCAL_ONLY_MODE === "true") return;
  if (workerStarted) return;
  workerStarted = true;
  const timer = setInterval(processPending, 30000);
  timer.unref();
  setTimeout(processPending, 5000).unref();
}

module.exports = { syncOrQueueNodeUser, startCrmAccountSyncWorker };
