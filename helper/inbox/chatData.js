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

function normalizeChat(chat, source = "beta") {
  const normalized = {
    ...chat,
    origin: inferOrigin(chat?.origin, chat?.chat_id),
    _source: source,
    _sortTimestamp: getChatSortTimestamp(chat),
  };

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
  } = filters;

  const normalizedOrigin = normalizeOriginFilter(origin);
  const normalizedSearch = String(search || "").trim().toLowerCase();
  const normalizedInstance = String(instance || "").trim();
  const startTimestamp = dateRange?.start
    ? toUnixTimestamp(dateRange.start)
    : 0;
  const endTimestamp = dateRange?.end ? toUnixTimestamp(dateRange.end) : 0;

  return (chats || []).filter((chat) => {
    const chatOrigin = inferOrigin(chat?.origin, chat?.chat_id);
    const unreadCount = Number(chat?.unread_count || 0);
    const labels = String(chat?.chat_label || "");
    const lastMessage = safeJsonParse(chat?.last_message);
    const messageText = JSON.stringify(lastMessage || chat?.last_message || "")
      .toLowerCase();

    if (normalizedOrigin && chatOrigin !== normalizedOrigin) {
      return false;
    }

    if (
      normalizedInstance &&
      !String(chat?.chat_id || "").startsWith(`${normalizedInstance}_`)
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

function normalizeConversationMessage(message, source = "db") {
  const msgContext = safeJsonParse(message?.msgContext) || message?.msgContext || null;
  const context = safeJsonParse(message?.context) || message?.context || null;

  return {
    ...message,
    msgContext,
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
  mergeConversationLists,
  normalizeOriginFilter,
  sanitizeMergedRows,
  safeJsonParse,
};
