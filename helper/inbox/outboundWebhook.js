const fetch = require("node-fetch");
const { query } = require("../../database/dbpromise");

function normalizeNumber(value) {
  return String(value || "").replace(/\D+/g, "");
}

function extractTextFromMessage(msg) {
  if (!msg) return "";
  if (msg.type === "text") return msg?.msgContext?.text?.body || "";
  if (msg.type === "image") return msg?.msgContext?.image?.caption || "";
  if (msg.type === "video") return msg?.msgContext?.video?.caption || "";
  if (msg.type === "document") return msg?.msgContext?.document?.caption || "";
  if (msg.type === "location") {
    const location = msg?.msgContext?.location || {};
    const label = [location.name, location.address].filter(Boolean).join(" - ");
    const coords = [location.latitude, location.longitude].filter((value) => value !== undefined && value !== null && value !== "").join(",");
    return [label, coords].filter(Boolean).join(" | ");
  }
  if (msg.type === "contact") {
    const contact = msg?.msgContext?.contact || {};
    return contact.name || contact.displayName || contact.vcard || "";
  }
  return "";
}

function extractMediaUrlFromMessage(msg) {
  if (!msg) return "";
  if (msg.type === "image") return msg?.msgContext?.image?.link || "";
  if (msg.type === "video") return msg?.msgContext?.video?.link || "";
  if (msg.type === "audio") return msg?.msgContext?.audio?.link || "";
  if (msg.type === "document") return msg?.msgContext?.document?.link || "";
  return "";
}

function normalizeCrmMessage(message) {
  const originalType = String(message?.type || "text").toLowerCase();
  const supportedTypes = new Set([
    "text",
    "image",
    "video",
    "audio",
    "document",
    "template",
    "interactive",
  ]);
  const mediaUrl = extractMediaUrlFromMessage(message);
  let messageType = supportedTypes.has(originalType) ? originalType : "text";
  let text = extractTextFromMessage(message);

  if (!text && mediaUrl) {
    text = mediaUrl;
  }

  if (!supportedTypes.has(originalType)) {
    if (!text) {
      text = `[${originalType || "unsupported"} WhatsApp message]`;
    }
    messageType = "text";
  }

  return {
    originalType,
    messageType,
    text,
    mediaUrl,
  };
}

function channelKeyFromChatId(chatId) {
  const id = String(chatId || "");
  if (!id.includes("_")) return "";
  return normalizeNumber(id.split("_")[0]);
}

function resolveIncomingWebhookUrl() {
  const explicit = String(process.env.GCCBOT_CRM_INCOMING_WEBHOOK_URL || "").trim();
  if (explicit) return explicit;
  const base = String(process.env.GCCBOT_CRM_BASE_URL || "").trim().replace(/\/+$/, "");
  if (!base) return "";
  return `${base}/api/whatsapp/incoming`;
}

function resolveQrStatusWebhookUrl() {
  const explicit = String(process.env.GCCBOT_CRM_QR_STATUS_WEBHOOK_URL || "").trim();
  if (explicit) return explicit;
  const base = String(process.env.GCCBOT_CRM_BASE_URL || "").trim().replace(/\/+$/, "");
  if (!base) return "";
  return `${base}/api/whatsapp/qr-status`;
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

async function lookupProfileImage({ uid, chatId }) {
  try {
    if (!uid || !chatId) return null;
    // Prefer beta tables (QR + meta both store chats here)
    const rows = await query(
      `SELECT last_message, profile FROM beta_chats WHERE uid = ? AND chat_id = ? LIMIT 1`,
      [uid, chatId],
    );
    const row = rows?.[0];
    if (!row) return null;

    const lastMsg = safeJsonParse(row.last_message);
    const profile = safeJsonParse(row.profile);
    return (
      lastMsg?.profileImage ||
      profile?.profileImage ||
      profile?.profile_image ||
      null
    );
  } catch (err) {
    return null;
  }
}

async function postJson(url, payload, headers = {}) {
  if (!url) return { ok: false, skipped: true, reason: "missing_url" };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        ...headers,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    const raw = await resp.text();
    return {
      ok: resp.ok,
      status: resp.status,
      body: raw,
    };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      error: err?.message || String(err),
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function sendIncomingToCrm({
  user,
  message,
  chatId,
  origin,
  sessionId,
  channelKey,
}) {
  try {
    const webhookUrl = resolveIncomingWebhookUrl();
    if (!webhookUrl) return { ok: false, skipped: true, reason: "missing_url" };

    const normalizedChannelKey =
      normalizeNumber(channelKey) || channelKeyFromChatId(chatId);
    const incomingSecret = String(process.env.GCCBOT_CRM_INCOMING_SECRET || "").trim();

    // Ensure profileImage is included so CRM can render WhatsApp avatars.
    if (!message?.profileImage) {
      const userUid = user?.uid || user?.id || user?.user_id || null;
      const found = await lookupProfileImage({ uid: userUid, chatId });
      if (found) {
        message = { ...message, profileImage: found };
      }
    }

    const crmMessage = normalizeCrmMessage(message);
    const payload = {
      business_token: null,
      auth_token: null,
      source: "gccbot",
      node_uid: user?.uid || user?.id || user?.user_id || null,
      channel_type: origin === "qr" ? "qr" : origin,
      channel_id: String(sessionId || normalizedChannelKey || ""),
      channel_external_id: String(sessionId || ""),
      channel_key: normalizedChannelKey || null,
      channel_mobile: normalizedChannelKey || null,
      connected_number: normalizedChannelKey || null,
      to_number: normalizedChannelKey || null,
      sender_name: message?.senderName || null,
      sender_mobile: normalizeNumber(message?.senderMobile || ""),
      message_type: crmMessage.messageType,
      message: crmMessage.text,
      media_url: crmMessage.mediaUrl || null,
      message_id: message?.metaChatId || null,
      external_message_id: message?.metaChatId || null,
      chat_id: chatId || null,
      timestamp: message?.timestamp || null,
      route: message?.route || null,
      raw_payload: {
        origin,
        session_id: sessionId || null,
        channel_key: normalizedChannelKey || null,
        original_message_type: crmMessage.originalType,
        message,
      },
    };

    const headers = incomingSecret ? { "X-Gccbot-Secret": incomingSecret } : {};
    return await postJson(webhookUrl, payload, headers);
  } catch (err) {
    return {
      ok: false,
      status: 0,
      error: err?.message || String(err),
    };
  }
}

async function sendQrStatusToCrm({
  user,
  channelId,
  status,
  phone,
  title,
}) {
  const webhookUrl = resolveQrStatusWebhookUrl();
  if (!webhookUrl) return { ok: false, skipped: true, reason: "missing_url" };
  if (!user?.api_key) return { ok: false, skipped: true, reason: "missing_api_key" };

  const payload = {
    channel_id: String(channelId || ""),
    status: String(status || "disconnected"),
    phone: normalizeNumber(phone || ""),
    node_uid: user?.uid || user?.id || user?.user_id || null,
    title: title || null,
    auth_token: user.api_key,
  };

  return await postJson(webhookUrl, payload, {
    "X-Gccbot-Secret": user.api_key,
  });
}

module.exports = {
  sendIncomingToCrm,
  sendQrStatusToCrm,
};
