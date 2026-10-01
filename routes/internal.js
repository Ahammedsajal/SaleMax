const router = require("express").Router();
const bcrypt = require("bcrypt");
const randomstring = require("randomstring");
const { sign } = require("jsonwebtoken");
const { query } = require("../database/dbpromise.js");
const {
  createSession,
  getSession,
  deleteSession,
} = require("../helper/addon/qr/index.js");
const {
  runWhatsAppRetentionCleanup,
} = require("../helper/maintenance/whatsappRetention.js");

function getInternalSecret() {
  return String(process.env.CRM_INTERNAL_SECRET || "").trim();
}

function isAuthorized(req) {
  const expected = getInternalSecret();
  if (!expected) return false;

  const byHeader = String(req.get("x-internal-secret") || "").trim();
  if (byHeader && byHeader === expected) return true;

  const auth = String(req.get("Authorization") || "").trim();
  if (auth.toLowerCase().startsWith("bearer ")) {
    const token = auth.slice(7).trim();
    return token !== "" && token === expected;
  }

  return false;
}

function internalOnly(req, res, next) {
  if (!isAuthorized(req)) {
    return res.status(401).json({
      success: false,
      msg: "Unauthorized internal request",
    });
  }
  next();
}

function crmUidFromId(id) {
  return `crm_user_${id}`;
}

function safeJsonParse(value) {
  try {
    if (!value) return null;
    if (typeof value === "object") return value;
    return JSON.parse(String(value));
  } catch {
    return null;
  }
}

function extractProfileImage(row) {
  const lastMessage = safeJsonParse(row?.last_message);
  const profile = safeJsonParse(row?.profile);

  return (
    row?.profile_image ||
    lastMessage?.profileImage ||
    lastMessage?.profile_image ||
    profile?.profileImage ||
    profile?.profile_image ||
    null
  );
}

function extractLastMessageText(row) {
  const lastMessage = safeJsonParse(row?.last_message);
  if (!lastMessage) return String(row?.last_message || "").trim();

  if (lastMessage?.type === "text") {
    return String(lastMessage?.msgContext?.text?.body || "").trim();
  }

  if (lastMessage?.type === "image") {
    return String(lastMessage?.msgContext?.image?.caption || "Image").trim();
  }

  if (lastMessage?.type === "video") {
    return String(lastMessage?.msgContext?.video?.caption || "Video").trim();
  }

  if (lastMessage?.type === "document") {
    return String(
      lastMessage?.msgContext?.document?.caption ||
        lastMessage?.msgContext?.document?.filename ||
        "Document",
    ).trim();
  }

  if (lastMessage?.type === "audio") {
    return "Audio";
  }

  return String(row?.last_message || "").trim();
}

router.get("/users/list", internalOnly, async (req, res) => {
  try {
    const q = String(req.query?.q || "").trim();
    const offset = Math.max(0, parseInt(String(req.query?.offset || "0"), 10) || 0);
    const limit = Math.min(50, Math.max(1, parseInt(String(req.query?.limit || "30"), 10) || 30));

    const where = [];
    const params = [];

    if (q) {
      where.push("(uid LIKE ? OR email LIKE ? OR name LIKE ? OR mobile_with_country_code LIKE ?)");
      const like = `%${q}%`;
      params.push(like, like, like, like);
    }

    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const users = await query(
      `SELECT id, uid, name, email, mobile_with_country_code, timezone, role, trial
       FROM user
       ${whereSql}
       ORDER BY id DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset],
    );

    const uids = (users || []).map((u) => String(u.uid || "").trim()).filter(Boolean);
    const countsByUid = {};
    if (uids.length) {
      const placeholders = uids.map(() => "?").join(",");
      const rows = await query(
        `SELECT uid, COUNT(*) as instance_count FROM instance WHERE uid IN (${placeholders}) GROUP BY uid`,
        uids,
      );
      for (const row of rows || []) {
        const key = String(row.uid || "").trim();
        if (key) countsByUid[key] = Number(row.instance_count || 0) || 0;
      }
    }

    const items = (users || []).map((u) => ({
      id: Number(u.id || 0) || 0,
      uid: String(u.uid || "").trim(),
      name: String(u.name || "").trim(),
      email: String(u.email || "").trim(),
      mobile_with_country_code: String(u.mobile_with_country_code || "").trim(),
      timezone: String(u.timezone || "").trim(),
      role: String(u.role || "").trim(),
      trial: Number(u.trial || 0) || 0,
      instance_count: countsByUid[String(u.uid || "").trim()] || 0,
    }));

    return res.json({
      success: true,
      data: {
        items,
        next_offset: items.length === limit ? offset + limit : null,
      },
    });
  } catch (err) {
    console.error("internal.users.list error", err);
    return res.status(500).json({
      success: false,
      msg: "Internal user list failed",
      err: err.message,
    });
  }
});

router.get("/agents/list", internalOnly, async (req, res) => {
  try {
    const q = String(req.query?.q || "").trim();
    const offset = Math.max(0, parseInt(String(req.query?.offset || "0"), 10) || 0);
    const limit = Math.min(50, Math.max(1, parseInt(String(req.query?.limit || "30"), 10) || 30));
    const where = ["is_active = 1"];
    const params = [];

    if (q) {
      where.push("(uid LIKE ? OR owner_uid LIKE ? OR email LIKE ? OR name LIKE ? OR mobile LIKE ?)");
      const like = `%${q}%`;
      params.push(like, like, like, like, like);
    }

    const rows = await query(
      `SELECT uid, owner_uid, email, name, mobile, is_active
       FROM agents
       ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
       ORDER BY id DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset],
    );

    return res.json({
      success: true,
      data: {
        items: (rows || []).map((row) => ({
          uid: String(row.uid || ""),
          owner_uid: String(row.owner_uid || ""),
          email: String(row.email || ""),
          name: String(row.name || ""),
          mobile: String(row.mobile || ""),
          is_active: true,
        })),
        offset,
        limit,
      },
    });
  } catch (err) {
    return res.status(500).json({ success: false, msg: "Unable to list Node agents" });
  }
});

router.get("/identity/lookup", internalOnly, async (req, res) => {
  try {
    const uid = String(req.query?.uid || "").trim();
    if (!uid) return res.status(422).json({ success: false, msg: "uid is required" });

    const [users, agents] = await Promise.all([
      query(`SELECT uid, role FROM user WHERE uid = ? LIMIT 1`, [uid]),
      query(`SELECT uid, owner_uid, is_active FROM agents WHERE uid = ? LIMIT 1`, [uid]),
    ]);
    if ((users || []).length + (agents || []).length !== 1) {
      return res.status(404).json({ success: false, msg: "Node identity is missing or ambiguous" });
    }

    if (agents?.length) {
      if (Number(agents[0].is_active) < 1) {
        return res.status(403).json({ success: false, msg: "Node agent is inactive" });
      }
      return res.json({ success: true, identity: { uid, role: "agent", owner_uid: String(agents[0].owner_uid || "") } });
    }

    if (users[0].role !== "user") {
      return res.status(403).json({ success: false, msg: "Node account role is not eligible" });
    }
    return res.json({ success: true, identity: { uid, role: "user", owner_uid: null } });
  } catch (err) {
    return res.status(500).json({ success: false, msg: "Unable to look up Node identity" });
  }
});

router.get("/inbox/threads", internalOnly, async (req, res) => {
  try {
    const uid = String(req.query?.uid || "").trim();
    if (!uid) {
      return res.status(422).json({ success: false, msg: "uid is required" });
    }

    const offset = Math.max(0, parseInt(String(req.query?.offset || "0"), 10) || 0);
    const limit = Math.min(200, Math.max(1, parseInt(String(req.query?.limit || "50"), 10) || 50));

    const rows = await query(
      `SELECT chat_id, sender_mobile, unread_count, last_message, profile, origin, assigned_agent, origin_instance_id, createdAt
       FROM beta_chats
       WHERE uid = ?
       ORDER BY id DESC
       LIMIT ? OFFSET ?`,
      [uid, limit, offset],
    );

    const items = (rows || []).map((row) => ({
      ...row,
      profile_image: extractProfileImage(row),
      last_message: extractLastMessageText(row),
    }));

    return res.json({
      success: true,
      data: {
        items,
        next_offset: items.length === limit ? offset + limit : null,
      },
    });
  } catch (err) {
    console.error("internal.inbox.threads error", err);
    return res.status(500).json({
      success: false,
      msg: "Internal inbox threads export failed",
      err: err.message,
    });
  }
});

router.get("/inbox/messages", internalOnly, async (req, res) => {
  try {
    const uid = String(req.query?.uid || "").trim();
    const chatId = String(req.query?.chat_id || "").trim();
    if (!uid || !chatId) {
      return res.status(422).json({ success: false, msg: "uid and chat_id are required" });
    }

    const offset = Math.max(0, parseInt(String(req.query?.offset || "0"), 10) || 0);
    const limit = Math.min(500, Math.max(1, parseInt(String(req.query?.limit || "300"), 10) || 300));

    const rows = await query(
      `SELECT id, uid, chat_id, route, type, msgContext, metaChatId, timestamp, createdAt, status, reaction
       FROM beta_conversation
       WHERE uid = ? AND chat_id = ?
       ORDER BY id ASC
       LIMIT ? OFFSET ?`,
      [uid, chatId, limit, offset],
    );

    return res.json({
      success: true,
      data: {
        items: rows || [],
        next_offset: rows && rows.length === limit ? offset + limit : null,
      },
    });
  } catch (err) {
    console.error("internal.inbox.messages error", err);
    return res.status(500).json({
      success: false,
      msg: "Internal inbox messages export failed",
      err: err.message,
    });
  }
});

router.post("/users/upsert", internalOnly, async (req, res) => {
  try {
    const inputUid = String(req.body?.uid || "").trim();
    const uid = inputUid || crmUidFromId(req.body?.user_id || "0");
    const email = String(req.body?.email || "").trim().toLowerCase();
    const name = String(req.body?.name || "").trim();
    const mobile = String(req.body?.mobile_with_country_code || "").trim();
    const timezone = String(req.body?.timezone || "Asia/Qatar").trim();
    const role = "user";
    const isActive = req.body?.is_active === false ? 0 : 1;

    if (!uid || !email || !name) {
      return res.status(422).json({
        success: false,
        msg: "uid, email and name are required",
      });
    }

    const existingByUid = await query(`SELECT * FROM user WHERE uid = ? LIMIT 1`, [
      uid,
    ]);
    const existing = existingByUid[0] || null;

    if (existing) {
      await query(
        `UPDATE user SET name = ?, email = ?, mobile_with_country_code = ?, timezone = ?, role = ? WHERE uid = ?`,
        [name, email, mobile, timezone, role, uid],
      );
    } else {
      const randomPassword = randomstring.generate(32);
      const hashedPassword = await bcrypt.hash(randomPassword, 10);
      await query(
        `INSERT INTO user (role, uid, name, email, password, mobile_with_country_code, timezone, trial) VALUES (?,?,?,?,?,?,?,?)`,
        [role, uid, name, email, hashedPassword, mobile, timezone, isActive ? 0 : 1],
      );
    }

    const [user] = await query(`SELECT * FROM user WHERE uid = ? LIMIT 1`, [uid]);
    if (!user) {
      return res.status(500).json({
        success: false,
        msg: "Unable to load synced user",
      });
    }

    const loginToken = sign(
      {
        uid: user.uid,
        role: user.role || "user",
        password: user.password,
        email: user.email,
      },
      process.env.JWTKEY,
      {},
    );

    await query(`UPDATE user SET api_key = ? WHERE uid = ?`, [loginToken, uid]);

    return res.json({
      success: true,
      data: {
        uid: user.uid,
        email: user.email,
        name: user.name,
        role: user.role || "user",
        is_active: isActive === 1,
        access_token: loginToken,
        api_key: loginToken,
      },
    });
  } catch (err) {
    console.error("internal.users.upsert error", err);
    return res.status(500).json({
      success: false,
      msg: "Internal sync failed",
      err: err.message,
    });
  }
});

module.exports = router;

router.post("/qr/gen", internalOnly, async (req, res) => {
  try {
    const uid = String(req.body?.uid || "").trim();
    const title = String(req.body?.title || req.body?.name || "").trim();
    const uniqueId = String(req.body?.uniqueId || "").trim();

    if (!uid || !title || !uniqueId) {
      return res.status(422).json({
        success: false,
        msg: "uid, title and uniqueId are required",
      });
    }

    const exists = await query(`SELECT id FROM instance WHERE uniqueId = ?`, [
      uniqueId,
    ]);
    if (exists.length > 0) {
      return res.json({ success: false, msg: "Instance already exists" });
    }

    await query(
      `INSERT INTO instance (uid, title, uniqueId, status) VALUES (?,?,?,?)`,
      [uid, title, uniqueId, "GENERATING"],
    );

    await createSession(uniqueId, title.length > 20 ? title.slice(0, 20) : title);
    return res.json({ success: true, msg: "Qr code is generating" });
  } catch (err) {
    return res.status(500).json({
      success: false,
      msg: "Internal QR create failed",
      err: err.message,
    });
  }
});

router.get("/qr/list", internalOnly, async (req, res) => {
  try {
    const uid = String(req.query?.uid || req.body?.uid || "").trim();
    if (!uid) {
      return res.status(422).json({ success: false, msg: "uid is required" });
    }

    const instances = await query(`SELECT * FROM instance WHERE uid = ?`, [uid]);
    return res.json({ success: true, data: instances });
  } catch (err) {
    return res.status(500).json({
      success: false,
      msg: "Internal QR list failed",
      err: err.message,
    });
  }
});

router.post("/qr/delete", internalOnly, async (req, res) => {
  try {
    const uid = String(req.body?.uid || "").trim();
    const uniqueId = String(req.body?.uniqueId || "").trim();
    if (!uid || !uniqueId) {
      return res.status(422).json({
        success: false,
        msg: "uid and uniqueId are required",
      });
    }

    const session = getSession(uniqueId);
    if (session) {
      try {
        await session.logout();
      } catch {
      } finally {
        deleteSession(uniqueId);
      }
    }

    // Clean up stored auth keys for this session to prevent unbounded growth.
    // (Auth keys are stored per-session in the `auth` table.)
    try {
      await query(`DELETE FROM auth WHERE session = ?`, [uniqueId]);
    } catch (err) {
      console.error("internal.qr.delete auth cleanup failed", err?.message || err);
    }

    await query(`DELETE FROM instance WHERE uniqueId = ? AND uid = ?`, [
      uniqueId,
      uid,
    ]);

    return res.json({ success: true, msg: "WhatsApp deleted successfully" });
  } catch (err) {
    return res.status(500).json({
      success: false,
      msg: "Internal QR delete failed",
      err: err.message,
    });
  }
});

router.post("/qr/send-text", internalOnly, async (req, res) => {
  try {
    const uid = String(req.body?.uid || "").trim();
    const from = String(req.body?.from || "").replace("+", "").trim();
    const to = String(req.body?.to || "").replace("+", "").trim();
    const text = String(req.body?.text || "").trim();

    if (!uid || !from || !to || !text) {
      return res.status(422).json({
        success: false,
        msg: "uid, from, to and text are required",
      });
    }

    const [instance] = await query(
      `SELECT * FROM instance WHERE uid = ? AND number = ? AND status = ? LIMIT 1`,
      [uid, from, "ACTIVE"],
    );
    if (!instance) {
      return res.status(404).json({
        success: false,
        msg: "No active instance found for from number",
      });
    }

    const session = await getSession(instance.uniqueId);
    if (!session) {
      return res.status(500).json({
        success: false,
        msg: "Session is not active for this instance",
      });
    }

    const sent = await session.sendMessage(`${to}@s.whatsapp.net`, { text });
    return res.json({
      success: true,
      msg: "Message sent",
      data: {
        messageId: sent?.key?.id || null,
      },
      other: sent,
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      msg: "Internal QR send failed",
      err: err.message,
    });
  }
});

router.post("/qr/send-message", internalOnly, async (req, res) => {
  try {
    const uid = String(req.body?.uid || "").trim();
    const from = String(req.body?.from || "").replace("+", "").trim();
    const to = String(req.body?.to || "").replace("+", "").trim();
    const messageType = String(req.body?.messageType || req.body?.type || "text")
      .trim()
      .toLowerCase();
    const text = String(req.body?.text || req.body?.message || "").trim();
    const caption = String(req.body?.caption || "").trim();
    const mediaUrl = String(req.body?.media_url || req.body?.mediaUrl || "").trim();

    if (!uid || !from || !to) {
      return res.status(422).json({
        success: false,
        msg: "uid, from and to are required",
      });
    }

    let msgContent;
    switch (messageType) {
      case "text":
        if (!text) {
          return res.status(422).json({ success: false, msg: "Text is required" });
        }
        msgContent = { text };
        break;
      case "image":
        if (!mediaUrl) {
          return res.status(422).json({ success: false, msg: "media_url is required for image" });
        }
        msgContent = { image: { url: mediaUrl }, caption };
        break;
      case "video":
        if (!mediaUrl) {
          return res.status(422).json({ success: false, msg: "media_url is required for video" });
        }
        msgContent = { video: { url: mediaUrl }, caption };
        break;
      case "audio":
        if (!mediaUrl) {
          return res.status(422).json({ success: false, msg: "media_url is required for audio" });
        }
        msgContent = { audio: { url: mediaUrl }, ptt: true };
        break;
      case "document":
        if (!mediaUrl) {
          return res.status(422).json({ success: false, msg: "media_url is required for document" });
        }
        msgContent = {
          document: { url: mediaUrl },
          caption,
          fileName: mediaUrl.split("/").pop()?.split("?")[0] || "document",
        };
        break;
      case "location":
        if (!req.body?.lat || !req.body?.long) {
          return res.status(422).json({ success: false, msg: "lat and long are required for location" });
        }
        msgContent = {
          location: {
            degreesLatitude: parseFloat(req.body.lat),
            degreesLongitude: parseFloat(req.body.long),
            name: String(req.body?.title || "Shared Location"),
          },
        };
        break;
      default:
        return res.status(422).json({
          success: false,
          msg: "Unsupported message type",
        });
    }

    const [instance] = await query(
      `SELECT * FROM instance WHERE uid = ? AND number = ? AND status = ? LIMIT 1`,
      [uid, from, "ACTIVE"],
    );
    if (!instance) {
      return res.status(404).json({
        success: false,
        msg: "No active instance found for from number",
      });
    }

    const session = await getSession(instance.uniqueId);
    if (!session) {
      return res.status(500).json({
        success: false,
        msg: "Session is not active for this instance",
      });
    }

    const sent = await session.sendMessage(`${to}@s.whatsapp.net`, msgContent);
    return res.json({
      success: true,
      msg: "Message sent",
      data: {
        messageId: sent?.key?.id || null,
      },
      other: sent,
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      msg: "Internal QR send failed",
      err: err.message,
    });
  }
});

router.post("/messages/media", internalOnly, async (req, res) => {
  try {
    const metaChatId = String(req.body?.metaChatId || req.body?.message_id || "").trim();
    if (!metaChatId) {
      return res.status(422).json({
        success: false,
        msg: "metaChatId is required",
      });
    }

    const [message] = await query(
      `SELECT id, type, msgContext FROM beta_conversation WHERE metaChatId = ? LIMIT 1`,
      [metaChatId],
    );

    if (!message) {
      return res.status(404).json({
        success: false,
        msg: "Message not found",
      });
    }

    let msgContext = {};
    try {
      msgContext = message.msgContext ? JSON.parse(message.msgContext) : {};
    } catch (err) {
      msgContext = {};
    }

    return res.json({
      success: true,
      data: {
        id: message.id,
        type: message.type,
        msgContext,
      },
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      msg: "Internal media lookup failed",
      err: err.message,
    });
  }
});

router.post("/retention/cleanup", internalOnly, async (req, res) => {
  try {
    const days = Math.max(
      1,
      Math.min(3650, parseInt(String(req.body?.days || req.query?.days || "30"), 10) || 30),
    );
    const deleteFiles = String(req.body?.deleteFiles ?? req.query?.deleteFiles ?? "true").toLowerCase() !== "false";

    const result = await runWhatsAppRetentionCleanup({
      days,
      deleteFiles,
    });

    return res.json({
      success: true,
      msg: "Retention cleanup completed",
      data: result,
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      msg: "Retention cleanup failed",
      err: err.message,
    });
  }
});
