function safeJsonParse(value) {
  try {
    if (!value) return null;
    if (typeof value === "object") return value;
    return JSON.parse(String(value));
  } catch {
    return null;
  }
}

function toUnixTimestamp(value) {
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) {
    return Math.trunc(numeric);
  }

  if (!value) return 0;

  const parsed = Date.parse(String(value));
  if (Number.isNaN(parsed)) return 0;

  return Math.trunc(parsed / 1000);
}

function inferOrigin(origin, chatId) {
  const normalizedOrigin = String(origin || "")
    .trim()
    .toLowerCase();

  if (normalizedOrigin) return normalizedOrigin;

  const normalizedChatId = String(chatId || "").trim().toLowerCase();
  if (normalizedChatId.startsWith("meta_")) return "meta";
  if (normalizedChatId.includes("_")) return "qr";

  return "";
}

function normalizeOriginFilter(origin) {
  const normalizedOrigin = String(origin || "")
    .trim()
    .toLowerCase();

  if (!normalizedOrigin || normalizedOrigin === "all") return "";

  if (normalizedOrigin === "whatsapp_web") return "qr";
  if (normalizedOrigin === "whatsappweb") return "qr";
  if (normalizedOrigin === "assigned" || normalizedOrigin === "transferred") return "assigned";

  return normalizedOrigin;
}

function getChatDedupeKey(chat) {
  const chatId = String(chat?.chat_id || "").trim();
  if (chatId) return `chat:${chatId}`;

  const senderMobile = String(chat?.sender_mobile || "").trim();
  const origin = inferOrigin(chat?.origin, chat?.chat_id);
  return `mobile:${origin}:${senderMobile}`;
}

function getChatSortTimestamp(chat) {
  const lastMessage = safeJsonParse(chat?.last_message);

  return (
    toUnixTimestamp(lastMessage?.timestamp) ||
    toUnixTimestamp(chat?.updatedAt) ||
    toUnixTimestamp(chat?.last_message_came) ||
    toUnixTimestamp(chat?.createdAt) ||
    0
  );
}

function sortGroupChatsByActivity(chats = []) {
  const groups = require('../../modules/platform/qr-inbox-groups');
  const activity = (chat) => {
    const lastMessage = safeJsonParse(chat?.last_message);
    return groups.isGroup(chat)
      ? toUnixTimestamp(lastMessage?.timestamp) || toUnixTimestamp(chat?.last_message_came)
      : getChatSortTimestamp(chat);
  };
  return [...chats].sort((left, right) => {
    const diff = activity(right) - activity(left);
    if (diff) return diff;
    const leftGroup = groups.isGroup(left), rightGroup = groups.isGroup(right);
    if (leftGroup && rightGroup && !activity(left) && !activity(right)) {
      return String(left.sender_name || '').localeCompare(String(right.sender_name || ''));
    }
    const updatedDiff = toUnixTimestamp(right?.updatedAt || right?.createdAt) - toUnixTimestamp(left?.updatedAt || left?.createdAt);
    if (updatedDiff) return updatedDiff;
    return Number(right?.id || 0) - Number(left?.id || 0);
  });
}

function normalizeChat(chat, source = "beta") {
  const normalized = {
    ...chat,
    origin: inferOrigin(chat?.origin, chat?.chat_id),
    _source: source,
    _sortTimestamp: getChatSortTimestamp(chat),
  };
  if (require('../../modules/platform/qr-inbox-groups').isGroup(chat)) {
    normalized.isGroup = true;
    normalized.sender_name = String(chat.sender_name || 'WhatsApp group');
  }

  return normalized;
}

function mergeChatLists({ betaChats = [], legacyChats = [] }) {
  const byKey = new Map();

  for (const row of betaChats || []) {
    const normalized = normalizeChat(row, "beta");
    byKey.set(getChatDedupeKey(normalized), normalized);
  }

  for (const row of legacyChats || []) {
    const normalized = normalizeChat(row, "legacy");
    const key = getChatDedupeKey(normalized);
    const existing = byKey.get(key);

    if (!existing) {
      byKey.set(key, normalized);
      continue;
    }

    byKey.set(key, {
      ...normalized,
      ...existing,
      sender_name: existing.sender_name || normalized.sender_name,
      sender_mobile: existing.sender_mobile || normalized.sender_mobile,
      last_message: existing.last_message || normalized.last_message,
      origin: existing.origin || normalized.origin,
      unread_count:
        existing.unread_count ?? normalized.unread_count ?? normalized.is_opened,
      _sortTimestamp: Math.max(
        existing._sortTimestamp || 0,
        normalized._sortTimestamp || 0,
      ),
      _source: existing._source || normalized._source,
    });
  }

  return Array.from(byKey.values()).sort((left, right) => {
    const timestampDiff =
      (right._sortTimestamp || 0) - (left._sortTimestamp || 0);
    if (timestampDiff !== 0) return timestampDiff;

    const updatedDiff =
      toUnixTimestamp(right?.updatedAt || right?.createdAt) -
      toUnixTimestamp(left?.updatedAt || left?.createdAt);
    if (updatedDiff !== 0) return updatedDiff;

    return Number(right?.id || 0) - Number(left?.id || 0);
  });
}

function filterChats(chats, filters = {}) {
  const {
    search = "",
    origin = "",
    unreadOnly = false,
    dateRange = {},
    statusFilter = "all",
    hasNote = false,
    instance = "",
    assignedOnly = false,
    conversationKind = 'direct',
  } = filters;

  const normalizedOrigin = normalizeOriginFilter(origin);
  const normalizedSearch = String(search || "").trim().toLowerCase();
  const normalizedInstance = String(instance || "").trim();
  const startTimestamp = dateRange?.start
    ? toUnixTimestamp(dateRange.start)
    : 0;
  const endTimestamp = dateRange?.end ? toUnixTimestamp(dateRange.end) : 0;

  return (chats || []).filter((chat) => {
    // Group metadata is browsed through the dedicated Inbox group directory.
    // Do not feed non-phone group JIDs into the legacy direct-chat list.
    const group = require('../../modules/platform/qr-inbox-groups').isGroup(chat);
    if ((conversationKind === 'group') !== group) return false;
    const chatOrigin = inferOrigin(chat?.origin, chat?.chat_id);
    const unreadCount = Number(chat?.unread_count || 0);
    const labels = String(chat?.chat_label || "");
    const lastMessage = safeJsonParse(chat?.last_message);
    const messageText = JSON.stringify(lastMessage || chat?.last_message || "")
      .toLowerCase();

    if (normalizedOrigin === 'assigned') {
      let assigned = chat?.assigned_agent;
      if (typeof assigned === 'string') { try { assigned = JSON.parse(assigned); } catch { assigned = null; } }
      if (!assigned || (Array.isArray(assigned) && assigned.length === 0)) return false;
    } else if (normalizedOrigin && chatOrigin !== normalizedOrigin) {
      return false;
    }
    if (assignedOnly) {
      let assigned = chat?.assigned_agent;
      if (typeof assigned === 'string') { try { assigned = JSON.parse(assigned); } catch { assigned = null; } }
      if (!assigned || (Array.isArray(assigned) && assigned.length === 0)) return false;
    }

    if (
      normalizedInstance &&
      (chatOrigin !== 'qr' || (!String(chat?.chat_id || "").startsWith(`${normalizedInstance}_`) &&
       String(chat?.origin_instance_unique_id || '') !== normalizedInstance &&
       String(chat?.origin_instance_number || '') !== normalizedInstance))
    ) {
      return false;
    }

    if (normalizedSearch) {
      const haystack = [
        chat?.sender_name,
        chat?.sender_mobile,
        messageText,
        labels,
        chat?.chat_id,
      ]
        .map((value) => String(value || "").toLowerCase())
        .join(" ");

      if (!haystack.includes(normalizedSearch)) {
        return false;
      }
    }

    if (unreadOnly && unreadCount <= 0) {
      return false;
    }

    if (statusFilter === "read" && unreadCount > 0) {
      return false;
    }

    if (statusFilter === "unread" && unreadCount <= 0) {
      return false;
    }

    if (hasNote && !String(chat?.chat_note || "").trim()) {
      return false;
    }

    if (startTimestamp && (chat._sortTimestamp || 0) < startTimestamp) {
      return false;
    }

    if (endTimestamp && (chat._sortTimestamp || 0) > endTimestamp) {
      return false;
    }

    return true;
  });
}

function getConversationDedupeKey(message) {
  if (message?.metaChatId) {
    return `meta:${message.metaChatId}`;
  }

  return JSON.stringify([
    message?.route || "",
    message?.type || "",
    Number(message?.timestamp || 0),
    message?.senderMobile || "",
    message?.senderName || "",
    message?.msgContext || null,
  ]);
}

function normalizeInboxDisplayMessage(message, msgContext) {
  const type = String(message?.type || msgContext?.type || "unknown").toLowerCase();
  const nativeTypes = new Set(["text", "image", "video", "audio", "document", "location", "button", "list"]);
  if (nativeTypes.has(type)) return { ...message, type, msgContext };

  const interactive = msgContext?.interactive || {};
  // The existing renderer supports button/list cards, while Meta and bot
  // storage use the transport name "interactive". Adapt the display contract
  // without changing the stored payload or what is sent to WhatsApp.
  if (type === "interactive" && Array.isArray(interactive?.action?.buttons)) {
    return { ...message, type: "button", msgContext };
  }
  if (type === "interactive" && Array.isArray(interactive?.action?.sections)) {
    return { ...message, type: "list", msgContext };
  }
  let body = "";

  if (type === "interactive") {
    body = interactive?.button_reply?.title || interactive?.list_reply?.title || interactive?.body?.text || interactive?.header?.text || "Interactive message";
  } else if (type === "reaction") {
    body = msgContext?.reaction?.emoji || message?.reaction || "Reaction";
  } else if (type === "sticker") {
    const link = msgContext?.sticker?.link;
    if (link) {
      return {
        ...message,
        type: "image",
        msgContext: { type: "image", image: { link, sticker: true } },
      };
    }
    body = "Sticker received";
  } else if (type === "contact" || type === "contacts") {
    body = (msgContext?.contact?.contacts || msgContext?.contacts || [])
      .map((contact) => {
        const name = contact?.name?.formatted_name || "Contact";
        const phone = (contact?.phones || []).map((item) => item?.phone || item?.wa_id).filter(Boolean).join(", ");
        return phone ? `${name}: ${phone}` : name;
      }).join("\n") || "Contact shared";
  } else if (type === "order") {
    const order = msgContext?.order || {};
    body = order.text || (order.product_items || [])
      .map((item) => `${item?.product_retailer_id || "Item"} × ${item?.quantity || 1}`)
      .join("\n") || "Catalog order received";
  } else if (type === "template") {
    const template = msgContext?.template || {};
    body = template.text || [template.name, ...(template.components || []).flatMap((component) =>
      (component?.parameters || []).map((parameter) => parameter?.text || parameter?.payload || ""),
    )].filter(Boolean).join("\n") || "Template message";
  } else if (type === "poll") {
    body = msgContext?.poll?.question || "Poll";
  } else {
    body = msgContext?.text?.body || msgContext?.[type]?.text || `WhatsApp ${type} message received`;
  }

  return {
    ...message,
    type: "text",
    msgContext: {
      type: "text",
      text: { body: String(body), preview_url: false },
      meta: { originalType: type, originalPayload: msgContext?.[type] || msgContext },
    },
  };
}

function normalizeConversationMessage(message, source = "db") {
  const msgContext = safeJsonParse(message?.msgContext) || message?.msgContext || null;
  const context = safeJsonParse(message?.context) || message?.context || null;
  const displayMessage = normalizeInboxDisplayMessage(message, msgContext);
  if (msgContext?.group?.participantName && message.route === 'INCOMING') {
    const name = String(msgContext.group.participantName).slice(0, 256);
    const body = displayMessage.msgContext;
    if (displayMessage.type === 'text') displayMessage.msgContext = { ...body, text: { ...body.text, body: `${name}\n${body.text?.body || ''}` } };
    else if (['image', 'video', 'document'].includes(displayMessage.type)) displayMessage.msgContext = { ...body, [displayMessage.type]: { ...body[displayMessage.type], caption: `${name}\n${body[displayMessage.type]?.caption || ''}` } };
  }

  return {
    ...displayMessage,
    context,
    _source: source,
    _sortTimestamp: toUnixTimestamp(message?.timestamp),
  };
}

function mergeConversationLists({ dbMessages = [], fileMessages = [] }) {
  const byKey = new Map();

  for (const row of dbMessages || []) {
    const normalized = normalizeConversationMessage(row, "db");
    byKey.set(getConversationDedupeKey(normalized), normalized);
  }

  for (const row of fileMessages || []) {
    const normalized = normalizeConversationMessage(row, "legacy");
    const key = getConversationDedupeKey(normalized);
    if (!byKey.has(key)) {
      byKey.set(key, normalized);
    }
  }

  return Array.from(byKey.values()).sort((left, right) => {
    const timestampDiff =
      (left._sortTimestamp || 0) - (right._sortTimestamp || 0);
    if (timestampDiff !== 0) return timestampDiff;

    return Number(left?.id || 0) - Number(right?.id || 0);
  });
}

function sanitizeMergedRows(rows = []) {
  return rows.map(({ _sortTimestamp, _source, ...rest }) => rest);
}

module.exports = {
  filterChats,
  mergeChatLists,
  sortGroupChatsByActivity,
  mergeConversationLists,
  normalizeOriginFilter,
  sanitizeMergedRows,
  safeJsonParse,
};
