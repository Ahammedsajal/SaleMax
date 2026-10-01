const crypto = require("crypto");
let defaultPool;
function getPromisePool(source) {
  const value=source||(defaultPool||(defaultPool=require("../../database/config")));
  return typeof value.promise==="function"?value.promise():value;
}

const DEFAULT_STAGES = [
  { key: "new", title: "New", position: 10, color: "#168c78", type: "open", probability: 5 },
  { key: "contacted", title: "Contacted", position: 20, color: "#4184d8", type: "open", probability: 15 },
  { key: "interested", title: "Interested", position: 30, color: "#8a63d2", type: "open", probability: 35 },
  { key: "qualified", title: "Qualified", position: 40, color: "#d38a27", type: "open", probability: 55 },
  { key: "proposal", title: "Proposal", position: 50, color: "#e46a36", type: "open", probability: 75 },
  { key: "won", title: "Won", position: 60, color: "#13966e", type: "won", probability: 100, system: 1 },
  { key: "lost", title: "Lost", position: 70, color: "#be5260", type: "lost", probability: 0, system: 1 },
];

const text = (value, limit = 255) => String(value || "").trim().slice(0, limit);
const sha = (value) => crypto.createHash("sha256").update(String(value)).digest("hex");

function normalizePhone(value) {
  const source = String(value || "").split("@")[0].split(":")[0];
  const digits = source.replace(/\D/g, "");
  return digits.length >= 7 && digits.length <= 15 ? `+${digits}` : null;
}

function normalizeEmail(value) {
  const email = String(value || "").trim().normalize("NFKC").toLocaleLowerCase("en-US");
  if (!email) return null;
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    const error = new Error("Enter a valid email address."); error.status = 400; throw error;
  }
  return email;
}

async function findContactMatches({ uid, phone, email, role = "owner", agentId, pool: sourcePool }) {
  const uidHash = sha(uid);
  const normalizedPhone = phone ? normalizePhone(phone) : null;
  const normalizedEmail = email ? normalizeEmail(email) : null;
  if (phone && !normalizedPhone) { const error = new Error("Enter a valid international phone number."); error.status = 400; throw error; }
  if (!normalizedPhone && !normalizedEmail) return [];
  const clauses = [], values = [uidHash];
  if (normalizedPhone) { clauses.push("normalized_phone = ?"); values.push(normalizedPhone); }
  if (normalizedEmail) { clauses.push("normalized_email = ?"); values.push(normalizedEmail); }
  let visibility = "";
  if (role === "agent") {
    visibility = ` AND EXISTS (SELECT 1 FROM pipeline_leads l
      WHERE l.uid_hash = pipeline_contacts.uid_hash AND l.contact_id = pipeline_contacts.id AND l.owner_agent_id = ?)`;
    values.push(Number(agentId));
  } else if (role !== "owner") {
    const error = new Error("You do not have access to contact suggestions."); error.status = 403; throw error;
  }
  const [rows] = await getPromisePool(sourcePool).query(
    `SELECT id, display_name AS name, normalized_phone AS phone, normalized_email AS email, created_at
     FROM pipeline_contacts WHERE uid_hash = ? AND (${clauses.join(" OR ")})${visibility}
     ORDER BY updated_at DESC, id DESC LIMIT 10`, values,
  );
  return rows;
}

function parseDate(value) {
  if (value === null || value === undefined || value === "") return new Date();
  const numeric = Number(value);
  const date = Number.isFinite(numeric) && numeric > 0
    ? new Date(numeric < 100000000000 ? numeric * 1000 : numeric)
    : new Date(value);
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

function dbDate(value) {
  return parseDate(value).toISOString().slice(0, 23).replace("T", " ");
}

function inputDbDate(value){
  if(value===null||value===undefined||value==='')return null;
  const numeric=typeof value==='number'||(typeof value==='string'&&/^\d+(?:\.\d+)?$/.test(value))?Number(value):NaN;
  const date=Number.isFinite(numeric)&&numeric>0?new Date(numeric<100000000000?numeric*1000:numeric):new Date(value);
  if(Number.isNaN(date.getTime())){const error=new Error('Enter a valid follow-up date and time.');error.status=400;throw error;}
  return dbDate(date);
}

function bodyText(message, normalized) {
  const candidate = message?.text?.body || message?.button?.text ||
    message?.interactive?.button_reply?.title || message?.interactive?.list_reply?.title ||
    normalized?.msgContext?.text?.body || normalized?.msgContext?.caption ||
    normalized?.msgContext?.conversation || "";
  return text(candidate, 4000).normalize("NFKC").toLocaleLowerCase();
}

function normalizeMetaAdsOpeningMessage(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .replace(/\s+/gu, " ")
    .trim();
}

function matchMetaAdsOpeningMessage(incomingMessage, configuredMessages) {
  const normalizedIncoming = normalizeMetaAdsOpeningMessage(incomingMessage);
  if (!normalizedIncoming || !Array.isArray(configuredMessages)) return null;
  return configuredMessages.find((message) =>
    normalizeMetaAdsOpeningMessage(message) === normalizedIncoming
  ) || null;
}

function parseMetaAdsMessages(raw) {
  let values = raw;
  if (typeof raw === "string") {
    try { values = JSON.parse(raw || "[]"); }
    catch (_) { values = raw.split(/\r?\n/); }
  }
  if (values == null) return [];
  if (!Array.isArray(values)) {
    const error = new Error("Meta Ads opening messages must be a list.");
    error.status = 400;
    throw error;
  }
  if (values.length > 30) {
    const error = new Error("You can configure up to 30 Meta Ads opening messages.");
    error.status = 400;
    throw error;
  }
  const messages = [];
  const seen = new Set();
  for (const value of values) {
    const message = String(value ?? "").trim();
    if (!message) continue;
    if (message.length > 2000) {
      const error = new Error("Each Meta Ads opening message must be 2,000 characters or fewer.");
      error.status = 400;
      throw error;
    }
    const normalized = normalizeMetaAdsOpeningMessage(message);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    messages.push(message);
  }
  return messages;
}

function verifiedAdReferral(referral) {
  const sourceType = text(referral?.source_type, 64).toLowerCase();
  return sourceType === "ad" && Boolean(text(referral?.source_id, 191) || text(referral?.ctwa_clid, 255));
}

async function inTransaction(work, sourcePool) {
  const connection = await getPromisePool(sourcePool).getConnection();
  try {
    await connection.beginTransaction();
    const result = await work(connection);
    await connection.commit();
    return result;
  } catch (error) {
    try { await connection.rollback(); } catch (_) { /* preserve the original error */ }
    throw error;
  } finally {
    connection.release();
  }
}

async function ensureWorkspace(connection, uid) {
  const uidHash = sha(uid);
  await connection.query(
    "INSERT IGNORE INTO pipeline_settings (uid_hash, uid) VALUES (?, ?)",
    [uidHash, uid],
  );
  for (const stage of DEFAULT_STAGES) {
    await connection.query(
      `INSERT IGNORE INTO pipeline_stages
        (uid_hash, uid, stage_key, title, position, color, stage_type, probability, is_system)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [uidHash, uid, stage.key, stage.title, stage.position, stage.color, stage.type, stage.probability, stage.system || 0],
    );
  }
  const [settings] = await connection.query(
    "SELECT * FROM pipeline_settings WHERE uid_hash = ? LIMIT 1",
    [uidHash],
  );
  return { uidHash, settings: settings[0] };
}

async function stageExists(connection, uidHash, stageKey) {
  const [rows] = await connection.query(
    "SELECT stage_key, position, stage_type FROM pipeline_stages WHERE uid_hash = ? AND stage_key = ? LIMIT 1",
    [uidHash, stageKey],
  );
  return rows[0] || null;
}

async function addActivity(connection, uidHash, leadId, type, summary, details = null, actorType = "system", actorId = null) {
  await connection.query(
    `INSERT INTO pipeline_activity
      (uid_hash, lead_id, actor_type, actor_id, activity_type, summary, details, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(3))`,
    [uidHash, leadId, actorType, actorId, type, text(summary, 500), details ? JSON.stringify(details) : null],
  );
}

async function ensurePhonebook(connection, uidHash, uid, kind) {
  await connection.query(
    `INSERT IGNORE INTO pipeline_phonebook_map (uid_hash, uid, book_kind, phonebook_id)
     VALUES (?, ?, ?, NULL)`,
    [uidHash, uid, kind],
  );
  const [maps] = await connection.query(
    "SELECT phonebook_id FROM pipeline_phonebook_map WHERE uid_hash = ? AND book_kind = ? FOR UPDATE",
    [uidHash, kind],
  );
  if (!maps.length) throw new Error("Phonebook map could not be initialized");
  let phonebookId = Number(maps[0].phonebook_id || 0);
  if (phonebookId > 0) return phonebookId;

  const name = kind === "meta_ads" ? "Facebook Ads WhatsApp Leads" : "WhatsApp Leads";
  const [existing] = await connection.query(
    "SELECT id FROM phonebook WHERE uid = ? AND name = ? ORDER BY id ASC LIMIT 1 FOR UPDATE",
    [uid, name],
  );
  if (existing.length) {
    phonebookId = Number(existing[0].id);
  } else {
    const [inserted] = await connection.query(
      "INSERT INTO phonebook (name, uid) VALUES (?, ?)",
      [name, uid],
    );
    phonebookId = Number(inserted.insertId);
  }
  await connection.query(
    "UPDATE pipeline_phonebook_map SET phonebook_id = ? WHERE uid_hash = ? AND book_kind = ?",
    [phonebookId, uidHash, kind],
  );
  return phonebookId;
}

async function ensurePhonebookContact(connection, { uidHash, uid, kind, phonebookId, phone, name, receivedAt }) {
  const identityKey = sha(phone);
  await connection.query(
    `INSERT IGNORE INTO pipeline_phonebook_memberships
      (uid_hash, phonebook_id, identity_key, contact_id) VALUES (?, ?, ?, NULL)`,
    [uidHash, phonebookId, identityKey],
  );
  const [memberships] = await connection.query(
    `SELECT contact_id FROM pipeline_phonebook_memberships
     WHERE uid_hash = ? AND phonebook_id = ? AND identity_key = ? FOR UPDATE`,
    [uidHash, phonebookId, identityKey],
  );
  if (!memberships.length) throw new Error("Phonebook membership could not be initialized");
  if (memberships[0].contact_id) return Number(memberships[0].contact_id);

  const [existing] = await connection.query(
    `SELECT id FROM contact
     WHERE uid = ? AND phonebook_id = ? AND mobile = ?
     ORDER BY id ASC LIMIT 1 FOR UPDATE`,
    [uid, phonebookId, phone],
  );
  let contactId;
  if (existing.length) {
    contactId = Number(existing[0].id);
  } else {
    const bookName = kind === "meta_ads" ? "Facebook Ads WhatsApp Leads" : "WhatsApp Leads";
    const safeName = text(name, 255) || phone;
    const [inserted] = await connection.query(
      `INSERT INTO contact
        (uid, phonebook_id, phonebook_name, name, mobile, var1, var2, var3, var4, var5, createdAt)
       VALUES (?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, NULL, ?)`,
      [uid, phonebookId, bookName, safeName, phone, receivedAt],
    );
    contactId = Number(inserted.insertId);
  }
  await connection.query(
    `UPDATE pipeline_phonebook_memberships SET contact_id = ?
     WHERE uid_hash = ? AND phonebook_id = ? AND identity_key = ?`,
    [contactId, uidHash, phonebookId, identityKey],
  );
  return contactId;
}

function parseKeywords(raw) {
  try {
    const value = Array.isArray(raw) ? raw : JSON.parse(raw || "[]");
    if (!Array.isArray(value)) return [];
    return [...new Set(value.map((item) => text(item, 80).normalize("NFKC").toLocaleLowerCase()).filter(Boolean))].slice(0, 30);
  } catch (_) {
    return [];
  }
}

async function maybeApplyIntentRule(connection, { uidHash, lead, stage, settings, messageBody, now }) {
  if (lead.automation_paused || !messageBody) return lead.stage_key;
  const keywords = parseKeywords(settings.interest_keywords);
  const match = keywords.find((keyword) => messageBody.includes(keyword));
  if (!match) return lead.stage_key;
  const targetKey = text(settings.interested_stage, 64) || "interested";
  const target = await stageExists(connection, uidHash, targetKey);
  const [sourceRows] = await connection.query(
    "SELECT position FROM pipeline_stages WHERE uid_hash = ? AND stage_key = ? LIMIT 1",
    [uidHash, lead.stage_key],
  );
  if (!target || !sourceRows.length || Number(target.position) <= Number(sourceRows[0].position)) return lead.stage_key;
  await connection.query(
    "UPDATE pipeline_leads SET stage_key = ?, stage_entered_at = ?, last_activity_at = ? WHERE id = ? AND uid_hash = ?",
    [targetKey, now, now, lead.id, uidHash],
  );
  await addActivity(connection, uidHash, lead.id, "automation_stage_move", `Automation moved lead to ${targetKey}`, { rule: "configured_intent_keyword", matchedKeyword: match, stageFrom: lead.stage_key, stageTo: targetKey });
  return targetKey;
}

async function captureInbound({ uid, origin, chatId, senderMobile, senderName, message, normalizedMessage, providerMessageId, timestamp, referral }) {
  if (!uid || !["qr", "meta"].includes(origin)) return { skipped: true };
  if (origin === "qr" && (normalizedMessage?.route || message?.route) !== "INCOMING") return { skipped: true };
  const phone = normalizePhone(senderMobile || message?.from || message?.key?.remoteJid);
  const safeChatId = text(chatId, 999);
  if (!phone || !safeChatId) return { skipped: true, reason: "missing_contact_or_conversation" };

  const uidValue = String(uid);
  const uidHash = sha(uidValue);
  const identityKey = sha(`phone:${phone}`);
  const conversationKey = sha(`${origin}:${safeChatId}`);
  const providerId = text(providerMessageId || message?.id || message?.key?.id, 191) || null;
  const eventKey = sha(providerId ? `${origin}:${providerId}` : `${origin}:${safeChatId}:${phone}:${timestamp || message?.timestamp || message?.messageTimestamp || "unknown"}`);
  const now = dbDate(timestamp || message?.timestamp || normalizedMessage?.timestamp);
  const name = text(senderName || message?.profile?.name || message?.pushName, 255);
  const adReferral = origin === "meta" && verifiedAdReferral(referral);
  const referralType = text(referral?.source_type, 64) || "";
  const messageBody = bodyText(message, normalizedMessage);

  return inTransaction(async (connection) => {
    const { settings } = await ensureWorkspace(connection, uidValue);
    if (!settings.enabled || (origin === "qr" && !settings.auto_capture_qr) || (origin === "meta" && !settings.auto_capture_meta)) {
      return { skipped: true, reason: "capture_disabled" };
    }
    const [adMessageRules] = origin === "qr"
      ? await connection.query(
        "SELECT message_text FROM pipeline_meta_ads_messages WHERE uid_hash = ? ORDER BY position ASC",
        [uidHash],
      )
      : [[]];
    const matchedAdMessage = matchMetaAdsOpeningMessage(
      messageBody,
      adMessageRules.map((rule) => rule.message_text),
    );
    const messageMatchedAd = Boolean(matchedAdMessage);
    const isMetaAds = adReferral || messageMatchedAd;
    const entryKey = text(origin === "meta" ? settings.meta_entry_stage : settings.qr_entry_stage, 64) || "new";
    const entryStage = await stageExists(connection, uidHash, entryKey);
    const initialStage = entryStage ? entryKey : "new";

    const [eventInsert] = await connection.query(
      `INSERT IGNORE INTO pipeline_events
        (uid_hash, uid, event_key, origin, conversation_key, chat_id, provider_message_id,
         event_at, status, processed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'processed', CURRENT_TIMESTAMP(3))`,
      [uidHash, uidValue, eventKey, origin, conversationKey, safeChatId, providerId, now],
    );
    if (!eventInsert.affectedRows) {
      const [duplicates] = await connection.query(
        "SELECT lead_id FROM pipeline_events WHERE uid_hash = ? AND event_key = ? LIMIT 1",
        [uidHash, eventKey],
      );
      return { duplicate: true, leadId: duplicates[0]?.lead_id || null };
    }

    await connection.query(
      "INSERT IGNORE INTO pipeline_identity_locks (uid_hash, identity_key, current_lead_id) VALUES (?, ?, NULL)",
      [uidHash, identityKey],
    );
    const [locks] = await connection.query(
      "SELECT current_lead_id FROM pipeline_identity_locks WHERE uid_hash = ? AND identity_key = ? FOR UPDATE",
      [uidHash, identityKey],
    );
    let lead = null;
    if (locks[0]?.current_lead_id) {
      const [leads] = await connection.query(
        "SELECT * FROM pipeline_leads WHERE uid_hash = ? AND id = ? LIMIT 1 FOR UPDATE",
        [uidHash, locks[0].current_lead_id],
      );
      lead = leads[0] || null;
    }

    let created = false;
    if (!lead) {
      const id = crypto.randomUUID();
      const contactId = crypto.randomUUID();
      const sourceType = isMetaAds ? "meta_ads_whatsapp" : origin === "meta" ? "meta_whatsapp" : "qr_whatsapp";
      await connection.query(
        `INSERT INTO pipeline_contacts (id, uid_hash, uid, display_name, normalized_phone)
         VALUES (?, ?, ?, ?, ?)`,
        [contactId, uidHash, uidValue, name || phone, phone],
      );
      await connection.query(
        `INSERT INTO pipeline_leads
          (id, uid_hash, uid, contact_id, identity_key, title, contact_name, learner_name, mobile, chat_id, primary_origin,
           source_type, source_id, source_url, source_headline, stage_key, stage_entered_at,
           status, priority, first_inbound_at, last_activity_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', 'normal', ?, ?, UTC_TIMESTAMP(3))`,
        [id, uidHash, uidValue, contactId, identityKey, name ? `${name} · WhatsApp inquiry` : "WhatsApp inquiry", name || null, name || null, phone, safeChatId, origin,
          sourceType, adReferral ? text(referral.source_id, 191) || text(referral.ctwa_clid, 191) : null,
          adReferral ? text(referral.source_url, 2000) || null : null,
          adReferral ? text(referral.headline, 500) || null : null,
          initialStage, now, now, now],
      );
      await connection.query(
        "UPDATE pipeline_identity_locks SET current_lead_id = ? WHERE uid_hash = ? AND identity_key = ?",
        [id, uidHash, identityKey],
      );
      lead = { id, contact_id: contactId, stage_key: initialStage, automation_paused: 0 };
      created = true;
      await addActivity(connection, uidHash, id, "lead_created", "Lead created from inbound WhatsApp conversation", { origin, sourceType, receivedAt: now });
    } else if (!lead.contact_id) {
      const contactId = crypto.randomUUID();
      await connection.query(
        `INSERT INTO pipeline_contacts (id, uid_hash, uid, display_name, normalized_phone)
         VALUES (?, ?, ?, ?, ?)`,
        [contactId, uidHash, uidValue, name || lead.contact_name || phone, phone],
      );
      await connection.query("UPDATE pipeline_leads SET contact_id = ?, learner_name = COALESCE(learner_name, contact_name) WHERE uid_hash = ? AND id = ?", [contactId, uidHash, lead.id]);
      lead.contact_id = contactId;
    }
    if (lead && !created && lead.status !== "open") {
      await connection.query(
        `UPDATE pipeline_leads SET status = 'open', closed_at = NULL, stage_key = ?, stage_entered_at = ?,
          last_activity_at = ?, chat_id = COALESCE(chat_id, ?), contact_name = COALESCE(NULLIF(contact_name, ''), ?)
         WHERE uid_hash = ? AND id = ?`,
        [initialStage, now, now, safeChatId, name || null, uidHash, lead.id],
      );
      await addActivity(connection, uidHash, lead.id, "lead_reopened", "Lead reopened by a new inbound WhatsApp conversation", { origin, receivedAt: now });
      lead.stage_key = initialStage;
      lead.status = "open";
    } else {
      await connection.query(
        `UPDATE pipeline_leads SET last_activity_at = ?, first_inbound_at = COALESCE(first_inbound_at, ?), chat_id = COALESCE(chat_id, ?),
          contact_name = COALESCE(NULLIF(contact_name, ''), ?), mobile = COALESCE(NULLIF(mobile, ''), ?)
         WHERE uid_hash = ? AND id = ?`,
        [now, now, safeChatId, name || null, phone, uidHash, lead.id],
      );
    }

    const wasAlreadyMetaAds = lead.source_type === "meta_ads_whatsapp";
    if (messageMatchedAd && !wasAlreadyMetaAds) {
      await connection.query(
        `UPDATE pipeline_leads SET source_type = 'meta_ads_whatsapp',
          source_headline = COALESCE(NULLIF(source_headline, ''), 'Matched configured QR opening message')
         WHERE uid_hash = ? AND id = ?`,
        [uidHash, lead.id],
      );
      lead.source_type = "meta_ads_whatsapp";
      await addActivity(
        connection,
        uidHash,
        lead.id,
        "meta_ads_opening_message_match",
        "Lead source matched a configured QR WhatsApp ad opening message",
        { method: "exact_qr_opening_message", messageRuleHash: sha(normalizeMetaAdsOpeningMessage(matchedAdMessage)) },
      );
    }

    lead.stage_key = await maybeApplyIntentRule(connection, { uidHash, lead, stage: lead.stage_key, settings, messageBody, now });
    await connection.query(
      `INSERT INTO pipeline_conversations
        (uid_hash, lead_id, conversation_key, chat_id, origin, first_inbound_at, last_inbound_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE last_inbound_at = GREATEST(last_inbound_at, VALUES(last_inbound_at))`,
      [uidHash, lead.id, conversationKey, safeChatId, origin, now, now],
    );

    if (referral && referralType) {
      await connection.query(
        `INSERT IGNORE INTO pipeline_attributions
          (uid_hash, lead_id, conversation_key, event_key, provider_message_id, source_type, source_id,
           source_url, headline, body, media_type, ctwa_clid, is_verified_ad, event_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [uidHash, lead.id, conversationKey, eventKey, providerId, referralType,
          text(referral.source_id, 191) || null, text(referral.source_url, 2000) || null,
          text(referral.headline, 500) || null, text(referral.body, 1000) || null,
          text(referral.media_type, 64) || null, text(referral.ctwa_clid, 255) || null,
          adReferral ? 1 : 0, now],
      );
    }

    const whatsappBook = await ensurePhonebook(connection, uidHash, uidValue, "whatsapp");
    await ensurePhonebookContact(connection, { uidHash, uid: uidValue, kind: "whatsapp", phonebookId: whatsappBook, phone, name, receivedAt: now });
    if (isMetaAds) {
      const adsBook = await ensurePhonebook(connection, uidHash, uidValue, "meta_ads");
      await ensurePhonebookContact(connection, { uidHash, uid: uidValue, kind: "meta_ads", phonebookId: adsBook, phone, name, receivedAt: now });
    }

    await connection.query(
      "UPDATE pipeline_events SET lead_id = ?, status = 'processed', processed_at = CURRENT_TIMESTAMP(3) WHERE uid_hash = ? AND event_key = ?",
      [lead.id, uidHash, eventKey],
    );
    return { leadId: lead.id, created, duplicate: false, metaAdsAttributed: adReferral, metaAdsMessageMatched: messageMatchedAd, metaAdsClassified: isMetaAds, stageKey: lead.stage_key };
  });
}

async function captureMetaWebhook({ uid, body }) {
  const valueRecords = [];
  for (const entry of body?.entry || []) {
    for (const change of entry?.changes || []) {
      if (change?.field === "messages" && Array.isArray(change?.value?.messages)) valueRecords.push(change.value);
    }
  }
  let captured = 0;
  for (const value of valueRecords) {
    const phoneNumberId = text(value?.metadata?.phone_number_id, 191);
    if (!phoneNumberId) continue;
    const [accounts] = await getPromisePool().query(
      "SELECT id FROM meta_api WHERE uid = ? AND business_phone_number_id = ? LIMIT 1",
      [uid, phoneNumberId],
    );
    if (!accounts.length) continue;
    const contacts = new Map((value.contacts || []).map((contact) => [String(contact.wa_id || ""), contact]));
    for (const message of value.messages || []) {
      if (!message?.from || !message?.id) continue;
      const contact = contacts.get(String(message.from)) || value.contacts?.[0] || {};
      const phone = normalizePhone(contact.wa_id || message.from);
      if (!phone) continue;
      const chatId = `meta_${phone.replace(/\D/g, "")}`;
      const result = await captureInbound({
        uid,
        origin: "meta",
        chatId,
        senderMobile: phone,
        senderName: contact?.profile?.name || "",
        message,
        providerMessageId: message.id,
        timestamp: message.timestamp,
        referral: message.referral || null,
      });
      if (!result.skipped) captured += 1;
    }
  }
  return { captured };
}

async function captureQrMessage({ uid, chatId, message, normalizedMessage }) {
  const event = {
    uid,
    origin: "qr",
    chatId,
    senderMobile: normalizedMessage?.senderMobile || message?.key?.remoteJid,
    senderName: normalizedMessage?.senderName || message?.pushName,
    message,
    normalizedMessage,
    providerMessageId: message?.key?.id,
    timestamp: normalizedMessage?.timestamp || message?.messageTimestamp,
  };
  let lastError;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try { return await captureInbound(event); }
    catch (error) {
      lastError = error;
      if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 500 * (2 ** attempt)));
    }
  }
  throw lastError;
}

async function getBoard({ uid, role, agentId, filters = {}, pool:sourcePool }) {
  return inTransaction(async (connection) => {
    const { uidHash } = await ensureWorkspace(connection, uid);
    const conditions = ["l.uid_hash = ?"];
    const values = [uidHash];
    if (role === "agent") {
      conditions.push("l.owner_agent_id = ?");
      values.push(agentId);
    }
    if (filters.stage) { conditions.push("l.stage_key = ?"); values.push(text(filters.stage, 64)); }
    if (filters.origin && ["qr", "meta", "manual"].includes(filters.origin)) { conditions.push("l.primary_origin = ?"); values.push(filters.origin); }
    const requestedSource = text(filters.sourceType, 64);
    if (requestedSource === "meta_ads_whatsapp") {
      conditions.push(`(l.source_type = 'meta_ads_whatsapp' OR EXISTS (
        SELECT 1 FROM pipeline_attributions pa
        WHERE pa.uid_hash = l.uid_hash AND pa.lead_id = l.id AND pa.is_verified_ad = 1
      ))`);
    } else {
      const sourceType = ({ qr: "qr_whatsapp", qr_whatsapp: "qr_whatsapp" })[requestedSource] || requestedSource;
      if (["qr_whatsapp", "meta_whatsapp", "manual"].includes(sourceType)) {
        conditions.push("l.source_type = ?"); values.push(sourceType);
      }
    }
    if (filters.owner && role !== "agent") { conditions.push("l.owner_agent_id = ?"); values.push(Number(filters.owner)); }
    if (filters.search) {
      const like = `%${text(filters.search, 100).replace(/[\\%_]/g, "\\$&")}%`;
      conditions.push("(l.title LIKE ? OR l.contact_name LIKE ? OR l.mobile LIKE ? OR l.source_headline LIKE ?)");
      values.push(like, like, like, like);
    }
    const page = Math.max(1, Number(filters.page) || 1);
    const limit = Math.min(500, Math.max(20, Number(filters.limit) || 300));
    const offset = (page - 1) * limit;
    const [stages] = await connection.query(
      "SELECT stage_key, title, position, color, stage_type, probability, is_system FROM pipeline_stages WHERE uid_hash = ? ORDER BY position ASC, id ASC",
      [uidHash],
    );
    const [leads] = await connection.query(
      `SELECT l.id, l.title, l.contact_name, l.mobile, l.chat_id, l.primary_origin, l.source_type,
        l.source_id, l.source_url, l.source_headline, l.stage_key, l.stage_entered_at,
        l.owner_agent_id, a.name AS owner_name, l.status, l.priority, l.expected_value,
        l.currency, l.next_follow_up_at, l.first_inbound_at, l.last_activity_at, l.created_at, l.updated_at,
        (SELECT pc.origin FROM pipeline_conversations pc WHERE pc.uid_hash = l.uid_hash AND pc.lead_id = l.id ORDER BY pc.last_inbound_at DESC LIMIT 1) AS latest_origin,
        (SELECT pc.chat_id FROM pipeline_conversations pc WHERE pc.uid_hash = l.uid_hash AND pc.lead_id = l.id ORDER BY pc.last_inbound_at DESC LIMIT 1) AS latest_chat_id,
        EXISTS (SELECT 1 FROM pipeline_attributions pa WHERE pa.uid_hash = l.uid_hash AND pa.lead_id = l.id AND pa.is_verified_ad = 1) AS has_verified_ad_attribution
       FROM pipeline_leads l LEFT JOIN agents a ON a.id = l.owner_agent_id
        AND a.owner_uid COLLATE utf8mb4_general_ci = l.uid COLLATE utf8mb4_general_ci
       WHERE ${conditions.join(" AND ")}
       ORDER BY l.last_activity_at DESC, l.created_at DESC LIMIT ? OFFSET ?`,
      [...values, limit, offset],
    );
    const [countRows] = await connection.query(
      `SELECT COUNT(*) AS total FROM pipeline_leads l WHERE ${conditions.join(" AND ")}`,
      values,
    );
    const [agents] = await connection.query(
      "SELECT id, name, email, is_active FROM agents WHERE owner_uid = ? AND is_active = 1 ORDER BY name ASC",
      [uid],
    );
    const grouped = stages.map((stage) => ({ ...stage, leads: leads.filter((lead) => lead.stage_key === stage.stage_key) }));
    return { stages: grouped, leads, agents, total: Number(countRows[0]?.total || 0), page, limit };
  },sourcePool);
}

async function getSettings(uid) {
  return inTransaction(async (connection) => {
    const { uidHash, settings } = await ensureWorkspace(connection, uid);
    const [stages] = await connection.query(
      "SELECT stage_key, title, position, color, stage_type, probability, is_system FROM pipeline_stages WHERE uid_hash = ? ORDER BY position ASC, id ASC",
      [uidHash],
    );
    const [metaAdsMessages] = await connection.query(
      "SELECT message_text FROM pipeline_meta_ads_messages WHERE uid_hash = ? ORDER BY position ASC",
      [uidHash],
    );
    return {
      enabled: Boolean(settings.enabled),
      autoCaptureQr: Boolean(settings.auto_capture_qr),
      autoCaptureMeta: Boolean(settings.auto_capture_meta),
      qrEntryStage: settings.qr_entry_stage,
      metaEntryStage: settings.meta_entry_stage,
      interestedStage: settings.interested_stage,
      interestKeywords: parseKeywords(settings.interest_keywords),
      metaAdsMessages: metaAdsMessages.map((row) => row.message_text),
      stages,
    };
  });
}

async function updateSettings(uid, input) {
  await inTransaction(async (connection) => {
    const { uidHash } = await ensureWorkspace(connection, uid);
    const qrEntry = text(input.qrEntryStage, 64) || "new";
    const metaEntry = text(input.metaEntryStage, 64) || "new";
    const interestedStage = text(input.interestedStage, 64) || "interested";
    const qr = await stageExists(connection, uidHash, qrEntry);
    const meta = await stageExists(connection, uidHash, metaEntry);
    const interested = await stageExists(connection, uidHash, interestedStage);
    if (!qr || qr.stage_type !== "open" || !meta || meta.stage_type !== "open" || !interested || interested.stage_type !== "open") {
      const error = new Error("Choose existing open stages for the entry and intent rules.");
      error.status = 400;
      throw error;
    }
    const keywords = parseKeywords(input.interestKeywords);
    const hasMetaAdsMessages = Object.prototype.hasOwnProperty.call(input, "metaAdsMessages");
    const metaAdsMessages = hasMetaAdsMessages ? parseMetaAdsMessages(input.metaAdsMessages) : null;
    await connection.query(
      `UPDATE pipeline_settings SET enabled = ?, auto_capture_qr = ?, auto_capture_meta = ?,
        qr_entry_stage = ?, meta_entry_stage = ?, interested_stage = ?, interest_keywords = ?
       WHERE uid_hash = ?`,
      [input.enabled === false ? 0 : 1, input.autoCaptureQr === false ? 0 : 1,
        input.autoCaptureMeta === false ? 0 : 1, qrEntry, metaEntry, interestedStage,
        JSON.stringify(keywords), uidHash],
    );
    if (hasMetaAdsMessages) {
      await connection.query(
        "DELETE FROM pipeline_meta_ads_messages WHERE uid_hash = ?",
        [uidHash],
      );
      for (const [index, message] of metaAdsMessages.entries()) {
        const normalized = normalizeMetaAdsOpeningMessage(message);
        await connection.query(
          `INSERT INTO pipeline_meta_ads_messages
            (uid_hash, uid, message_hash, message_text, position)
           VALUES (?, ?, ?, ?, ?)`,
          [uidHash, String(uid), sha(normalized), message, index],
        );
      }
    }
  });
  return getSettings(uid);
}

function makeStageKey(title) {
  const slug = text(title, 100).normalize("NFKD").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48);
  return slug || `stage-${crypto.randomBytes(4).toString("hex")}`;
}

async function createStage(uid, input) {
  return inTransaction(async (connection) => {
    const { uidHash } = await ensureWorkspace(connection, uid);
    const [counts] = await connection.query("SELECT COUNT(*) AS count FROM pipeline_stages WHERE uid_hash = ?", [uidHash]);
    if (Number(counts[0]?.count || 0) >= 15) {
      const error = new Error("A pipeline can have at most 15 stages."); error.status = 400; throw error;
    }
    const title = text(input.title, 100);
    if (!title) { const error = new Error("Stage name is required."); error.status = 400; throw error; }
    const stageKey = `${makeStageKey(title).slice(0, 42)}-${crypto.randomBytes(3).toString("hex")}`;
    const color = /^#[0-9a-f]{6}$/i.test(input.color || "") ? input.color : "#168c78";
    const probability = Math.max(0, Math.min(100, Math.round(Number(input.probability) || 0)));
    const [last] = await connection.query("SELECT COALESCE(MAX(position), 0) AS position FROM pipeline_stages WHERE uid_hash = ?", [uidHash]);
    await connection.query(
      `INSERT INTO pipeline_stages (uid_hash, uid, stage_key, title, position, color, stage_type, probability)
       VALUES (?, ?, ?, ?, ?, ?, 'open', ?)`,
      [uidHash, uid, stageKey, title, Number(last[0]?.position || 0) + 10, color, probability],
    );
    return { stageKey, title };
  });
}

async function updateStage(uid, stageKey, input) {
  return inTransaction(async (connection) => {
    const { uidHash } = await ensureWorkspace(connection, uid);
    const current = await stageExists(connection, uidHash, stageKey);
    if (!current) { const error = new Error("Stage not found."); error.status = 404; throw error; }
    const title = text(input.title, 100);
    if (!title) { const error = new Error("Stage name is required."); error.status = 400; throw error; }
    const color = /^#[0-9a-f]{6}$/i.test(input.color || "") ? input.color : "#168c78";
    const probability = Math.max(0, Math.min(100, Math.round(Number(input.probability) || 0)));
    await connection.query(
      "UPDATE pipeline_stages SET title = ?, color = ?, probability = ? WHERE uid_hash = ? AND stage_key = ?",
      [title, color, probability, uidHash, stageKey],
    );
    return { stageKey, title };
  });
}

async function reorderStages(uid, stageKeys) {
  return inTransaction(async (connection) => {
    const { uidHash } = await ensureWorkspace(connection, uid);
    if (!Array.isArray(stageKeys) || stageKeys.length < 2 || stageKeys.length > 15) {
      const error = new Error("Provide the full ordered list of pipeline stages."); error.status = 400; throw error;
    }
    const [rows] = await connection.query("SELECT stage_key FROM pipeline_stages WHERE uid_hash = ? ORDER BY position, id", [uidHash]);
    const existing = rows.map((row) => row.stage_key);
    if (new Set(stageKeys).size !== stageKeys.length || existing.length !== stageKeys.length || existing.some((key) => !stageKeys.includes(key))) {
      const error = new Error("The ordered stage list must include every stage exactly once."); error.status = 400; throw error;
    }
    for (let i = 0; i < stageKeys.length; i += 1) {
      await connection.query("UPDATE pipeline_stages SET position = ? WHERE uid_hash = ? AND stage_key = ?", [(i + 1) * 10, uidHash, stageKeys[i]]);
    }
    return true;
  });
}

async function deleteStage(uid, stageKey, targetStage) {
  return inTransaction(async (connection) => {
    const { uidHash } = await ensureWorkspace(connection, uid);
    const [rows] = await connection.query("SELECT stage_type, is_system FROM pipeline_stages WHERE uid_hash = ? AND stage_key = ? LIMIT 1 FOR UPDATE", [uidHash, stageKey]);
    if (!rows.length) { const error = new Error("Stage not found."); error.status = 404; throw error; }
    if (rows[0].is_system || rows[0].stage_type !== "open") { const error = new Error("Won and Lost are protected stages."); error.status = 400; throw error; }
    if (!targetStage || targetStage === stageKey) { const error = new Error("Choose a different stage for its leads."); error.status = 400; throw error; }
    const target = await stageExists(connection, uidHash, targetStage);
    if (!target) { const error = new Error("Target stage not found."); error.status = 404; throw error; }
    const [affected] = await connection.query("SELECT id FROM pipeline_leads WHERE uid_hash = ? AND stage_key = ? FOR UPDATE", [uidHash, stageKey]);
    const now = dbDate(new Date());
    const status = target.stage_type === "won" ? "won" : target.stage_type === "lost" ? "lost" : "open";
    await connection.query(
      "UPDATE pipeline_leads SET stage_key = ?, stage_entered_at = ?, status = ?, closed_at = ? WHERE uid_hash = ? AND stage_key = ?",
      [targetStage, now, status, status === "open" ? null : now, uidHash, stageKey],
    );
    for (const lead of affected) await addActivity(connection, uidHash, lead.id, "stage_changed", `Stage removed; lead moved to ${targetStage}`, { stageFrom: stageKey, stageTo: targetStage });
    await connection.query(
      `UPDATE pipeline_settings SET qr_entry_stage = IF(qr_entry_stage = ?, ?, qr_entry_stage),
        meta_entry_stage = IF(meta_entry_stage = ?, ?, meta_entry_stage),
        interested_stage = IF(interested_stage = ?, ?, interested_stage) WHERE uid_hash = ?`,
      [stageKey, targetStage, stageKey, targetStage, stageKey, targetStage, uidHash],
    );
    await connection.query("DELETE FROM pipeline_stages WHERE uid_hash = ? AND stage_key = ?", [uidHash, stageKey]);
    return { moved: affected.length, targetStage };
  });
}

async function createManualLead({ uid, actorType, actorId, agentId, role, input }) {
  return inTransaction(async (connection) => {
    const { uidHash } = await ensureWorkspace(connection, uid);
    const title = text(input.title, 180);
    if (!title) { const error = new Error("Lead title is required."); error.status = 400; throw error; }
    const stageKey = text(input.stageKey, 64) || "new";
    if (!await stageExists(connection, uidHash, stageKey)) { const error = new Error("Choose an existing pipeline stage."); error.status = 400; throw error; }
    const contactName = text(input.contactName, 255) || null;
    const learnerName = text(input.learnerName, 255) || contactName;
    const phone = normalizePhone(input.mobile);
    if (input.mobile && !phone) { const error = new Error("Enter a valid international phone number."); error.status = 400; throw error; }
    const email = normalizeEmail(input.email);
    const identityKey = sha(`opportunity:${crypto.randomUUID()}`);
    let owner = null;
    if (role === "agent") owner = agentId;
    else if (input.ownerAgentId !== undefined && input.ownerAgentId !== null && input.ownerAgentId !== "") {
      const [agents] = await connection.query("SELECT id FROM agents WHERE id = ? AND owner_uid = ? AND is_active = 1 LIMIT 1", [Number(input.ownerAgentId), uid]);
      if (!agents.length) { const error = new Error("Choose an active agent in this workspace."); error.status = 400; throw error; }
      owner = Number(agents[0].id);
    }
    let contactId = text(input.contactId, 36);
    if (contactId) {
      const assignedContactClause = role === "agent" ? ` AND EXISTS (
        SELECT 1 FROM pipeline_leads l WHERE l.uid_hash = c.uid_hash AND l.contact_id = c.id AND l.owner_agent_id = ?)` : "";
      const contactParams = role === "agent" ? [uidHash, contactId, agentId] : [uidHash, contactId];
      const [contacts] = await connection.query(
        `SELECT c.id, c.display_name, c.normalized_phone, c.normalized_email
         FROM pipeline_contacts c WHERE c.uid_hash = ? AND c.id = ?${assignedContactClause} LIMIT 1 FOR UPDATE`,
        contactParams,
      );
      if (!contacts.length) { const error = new Error("Choose a contact in this workspace."); error.status = 404; throw error; }
      if ((phone && contacts[0].normalized_phone && phone !== contacts[0].normalized_phone) ||
          (email && contacts[0].normalized_email && email !== contacts[0].normalized_email)) {
        const error = new Error("The selected contact has different contact details. Choose a matching contact or create a separate learner."); error.status = 409; throw error;
      }
      if (phone || email) {
        await connection.query(
          `UPDATE pipeline_contacts SET normalized_phone = COALESCE(normalized_phone, ?),
             normalized_email = COALESCE(normalized_email, ?), updated_at = UTC_TIMESTAMP(3)
           WHERE uid_hash = ? AND id = ?`, [phone, email, uidHash, contactId],
        );
      }
    } else {
      contactId = crypto.randomUUID();
      await connection.query(
        `INSERT INTO pipeline_contacts (id, uid_hash, uid, display_name, normalized_phone, normalized_email)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [contactId, uidHash, uid, contactName || learnerName || phone || email || "Unnamed contact", phone, email],
      );
    }
    const id = crypto.randomUUID();
    const now = dbDate(new Date());
    const amount = input.expectedValue === "" || input.expectedValue === null || input.expectedValue === undefined ? null : Number(input.expectedValue);
    if (amount !== null && (!Number.isFinite(amount) || amount < 0)) { const error = new Error("Expected value must be zero or greater."); error.status = 400; throw error; }
    const currency = /^[A-Z]{3}$/.test(String(input.currency || "QAR")) ? String(input.currency || "QAR") : "QAR";
    await connection.query(
      `INSERT INTO pipeline_leads
        (id, uid_hash, uid, contact_id, identity_key, title, contact_name, learner_name, mobile, primary_origin, source_type,
         stage_key, stage_entered_at, owner_agent_id, expected_value, currency, next_follow_up_at, last_activity_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'manual', 'manual', ?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(3))`,
      [id, uidHash, uid, contactId, identityKey, title, contactName, learnerName, phone, stageKey, now, owner, amount, currency,
        input.nextFollowUpAt ? dbDate(input.nextFollowUpAt) : null, now],
    );
    await addActivity(connection, uidHash, id, "lead_created", "Opportunity added manually", { title, contactId }, actorType, actorId);
    return { id, contactId };
  });
}

async function getLead(uid, id, {role,agentId,pool:sourcePool}={}) {
  const uidHash = sha(uid);
  return inTransaction(async(connection)=>{
    const scoped=role==='agent'?' AND l.owner_agent_id=?':'';
    const [leads] = await connection.query(
      `SELECT l.*, a.name AS owner_name, c.display_name AS relationship_name,
         c.normalized_email AS contact_email, c.preferred_language AS contact_language
       FROM pipeline_leads l
       LEFT JOIN agents a ON a.id = l.owner_agent_id
         AND a.owner_uid COLLATE utf8mb4_general_ci = l.uid COLLATE utf8mb4_general_ci
       LEFT JOIN pipeline_contacts c ON c.uid_hash = l.uid_hash AND c.id = l.contact_id
       WHERE l.uid_hash = ? AND l.id = ?${scoped} LIMIT 1 FOR UPDATE`,
      role==='agent'?[uidHash,id,agentId]:[uidHash,id],
    );
    if (!leads.length) return null;
    const [activities] = await connection.query(
      "SELECT id, actor_type, actor_id, activity_type, summary, details, created_at FROM pipeline_activity WHERE uid_hash = ? AND lead_id = ? ORDER BY created_at DESC, id DESC LIMIT 100",
      [uidHash, id],
    );
    const [conversations] = await connection.query(
      `SELECT pc.chat_id, pc.origin, pc.first_inbound_at, pc.last_inbound_at,
         EXISTS (SELECT 1 FROM pipeline_attributions pa WHERE pa.uid_hash = pc.uid_hash AND pa.conversation_key = pc.conversation_key AND pa.is_verified_ad = 1) AS has_verified_ad_attribution
       FROM pipeline_conversations pc WHERE pc.uid_hash = ? AND pc.lead_id = ? ORDER BY pc.last_inbound_at DESC`,
      [uidHash, id],
    );
    const [attributions] = await connection.query(
      `SELECT source_type, source_id, source_url, headline, body, media_type, ctwa_clid, is_verified_ad, event_at, received_at
       FROM pipeline_attributions WHERE uid_hash = ? AND lead_id = ? ORDER BY received_at DESC LIMIT 50`,
      [uidHash, id],
    );
    return { ...leads[0], activities, conversations, attributions };
  },sourcePool);
}

async function getFollowUps({ uid, role, agentId, period = "all", page = 1, limit = 20, pool: sourcePool }) {
  if (!['owner', 'agent'].includes(role)) { const error = new Error("You do not have access to pipeline follow-ups."); error.status = 403; throw error; }
  const pageNumber = Number(page), pageSize = Number(limit);
  if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > 10000 || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) {
    const error = new Error("Choose a valid follow-up page and page size."); error.status = 400; throw error;
  }
  if (!['all', 'overdue', 'upcoming'].includes(period)) { const error = new Error("Choose all, overdue, or upcoming follow-ups."); error.status = 400; throw error; }
  const uidHash = sha(uid), conditions = ["l.uid_hash = ?", "l.status = 'open'", "l.next_follow_up_at IS NOT NULL"], values = [uidHash];
  if (role === 'agent') { conditions.push("l.owner_agent_id = ?"); values.push(agentId); }
  if (period === 'overdue') conditions.push("l.next_follow_up_at < UTC_TIMESTAMP(3)");
  if (period === 'upcoming') conditions.push("l.next_follow_up_at >= UTC_TIMESTAMP(3)");
  const where = conditions.join(' AND '), pool = getPromisePool(sourcePool);
  const [[count]] = await pool.query(`SELECT COUNT(*) AS total FROM pipeline_leads l WHERE ${where}`, values);
  const summaryConditions = ["l.uid_hash = ?", "l.status = 'open'", "l.next_follow_up_at IS NOT NULL"];
  const summaryValues = [uidHash];
  if (role === 'agent') { summaryConditions.push("l.owner_agent_id = ?"); summaryValues.push(agentId); }
  const [[summary]] = await pool.query(
    `SELECT COUNT(*) AS total,
       SUM(l.next_follow_up_at < UTC_TIMESTAMP(3)) AS overdue,
       SUM(l.next_follow_up_at >= UTC_TIMESTAMP(3)) AS upcoming
     FROM pipeline_leads l WHERE ${summaryConditions.join(' AND ')}`, summaryValues,
  );
  const [items] = await pool.query(
    `SELECT l.id AS lead_id, l.title, l.contact_name, l.learner_name, l.mobile,
       l.stage_key, l.next_follow_up_at,
       DATE_FORMAT(l.next_follow_up_at, '%Y-%m-%d %H:%i:%s.%f') AS due_revision,
       l.owner_agent_id, a.name AS owner_name,
       s.title AS stage_title, (l.next_follow_up_at < UTC_TIMESTAMP(3)) AS overdue
     FROM pipeline_leads l
     LEFT JOIN agents a ON a.id = l.owner_agent_id AND a.owner_uid COLLATE utf8mb4_general_ci = l.uid COLLATE utf8mb4_general_ci
     LEFT JOIN pipeline_stages s ON s.uid_hash = l.uid_hash AND s.stage_key = l.stage_key
     WHERE ${where} ORDER BY l.next_follow_up_at ASC, l.id ASC LIMIT ? OFFSET ?`,
    [...values, pageSize, (pageNumber - 1) * pageSize],
  );
  return { items, page: pageNumber, limit: pageSize, total: Number(count.total), pages: Math.ceil(Number(count.total) / pageSize),
    summary: { total: Number(summary.total || 0), overdue: Number(summary.overdue || 0), upcoming: Number(summary.upcoming || 0) }, period, role };
}

async function resolveFollowUp({ uid, id, action, at, expectedDueAt, actorType, actorId, role, agentId, pool: sourcePool }) {
  if (!['complete', 'reschedule'].includes(action)) { const error = new Error("Choose complete or reschedule."); error.status = 400; throw error; }
  if (typeof expectedDueAt !== 'string' || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{6}$/.test(expectedDueAt)) {
    const error = new Error("Refresh this follow-up and try again."); error.status = 400; throw error;
  }
  const nextAt = action === 'reschedule' ? inputDbDate(at) : null;
  if (action === 'reschedule' && !nextAt) { const error = new Error("Choose the next follow-up date and time."); error.status = 400; throw error; }
  return inTransaction(async (connection) => {
    const { uidHash } = await ensureWorkspace(connection, uid);
    const [rows] = await connection.query(
      `SELECT l.*, DATE_FORMAT(l.next_follow_up_at, '%Y-%m-%d %H:%i:%s.%f') AS due_revision
       FROM pipeline_leads l WHERE l.uid_hash = ? AND l.id = ? LIMIT 1 FOR UPDATE`, [uidHash, id],
    );
    if (!rows.length) { const error = new Error("Lead not found."); error.status = 404; throw error; }
    const lead = rows[0]; assertAssignedAgent(role, agentId, lead);
    if (lead.status !== 'open' || !lead.next_follow_up_at) { const error = new Error("This follow-up is already completed or no longer active."); error.status = 409; throw error; }
    if (lead.due_revision !== expectedDueAt) { const error = new Error("This follow-up changed after you opened it. Refresh before updating."); error.status = 409; throw error; }
    const now = dbDate(new Date());
    await connection.query("UPDATE pipeline_leads SET next_follow_up_at = ?, last_activity_at = ? WHERE uid_hash = ? AND id = ?", [nextAt, now, uidHash, id]);
    await addActivity(connection, uidHash, id, action === 'complete' ? 'follow_up_completed' : 'follow_up_rescheduled', action === 'complete' ? 'Follow-up completed' : 'Follow-up rescheduled', { previousDueAt: lead.next_follow_up_at, nextDueAt: nextAt }, actorType, actorId);
    return { leadId: id, action, nextFollowUpAt: nextAt };
  }, sourcePool);
}

function assertAssignedAgent(role,agentId,lead){
  if(role==='agent'&&!require('./access').canAgentAccessLead(agentId,lead.owner_agent_id)){
    const error=new Error('This lead is not assigned to this agent.');error.status=403;throw error;
  }
}

async function moveLead({ uid, id, stageKey, actorType, actorId, role, agentId, pool:sourcePool }) {
  return inTransaction(async (connection) => {
    const { uidHash } = await ensureWorkspace(connection, uid);
    const [leads] = await connection.query("SELECT * FROM pipeline_leads WHERE uid_hash = ? AND id = ? LIMIT 1 FOR UPDATE", [uidHash, id]);
    if (!leads.length) { const error = new Error("Lead not found."); error.status = 404; throw error; }
    assertAssignedAgent(role,agentId,leads[0]);
    const target = await stageExists(connection, uidHash, stageKey);
    if (!target) { const error = new Error("Choose an existing stage."); error.status = 400; throw error; }
    const lead = leads[0];
    if (lead.stage_key === stageKey) return { id, stageKey: lead.stage_key, status: lead.status, unchanged: true };
    const now = dbDate(new Date());
    const status = target.stage_type === "won" ? "won" : target.stage_type === "lost" ? "lost" : "open";
    await connection.query(
      `UPDATE pipeline_leads SET stage_key = ?, stage_entered_at = ?, status = ?,
        closed_at = ?, last_activity_at = ? WHERE uid_hash = ? AND id = ?`,
      [stageKey, now, status, status === "open" ? null : now, now, uidHash, id],
    );
    if (status === "open") {
      await connection.query("UPDATE pipeline_identity_locks SET current_lead_id = ? WHERE uid_hash = ? AND identity_key = ?", [id, uidHash, lead.identity_key]);
    }
    await addActivity(connection, uidHash, id, "stage_changed", `Stage changed from ${lead.stage_key} to ${stageKey}`, { stageFrom: lead.stage_key, stageTo: stageKey }, actorType, actorId);
    return { id, stageKey, status, stageEnteredAt: now };
  },sourcePool);
}

async function updateLead({ uid, id, input, actorType, actorId, role, agentId, pool:sourcePool }) {
  return inTransaction(async (connection) => {
    const { uidHash } = await ensureWorkspace(connection, uid);
    const [rows] = await connection.query("SELECT * FROM pipeline_leads WHERE uid_hash = ? AND id = ? LIMIT 1 FOR UPDATE", [uidHash, id]);
    if (!rows.length) { const error = new Error("Lead not found."); error.status = 404; throw error; }
    const lead = rows[0];
    assertAssignedAgent(role,agentId,lead);
    const changes = [];
    const values = [];
    const add = (column, value) => { changes.push(`${column} = ?`); values.push(value); };
    const activityAt=dbDate(new Date());
    if (input.title !== undefined) { const value = text(input.title, 180); if (!value) { const error = new Error("Lead title is required."); error.status = 400; throw error; } add("title", value); }
    if (input.contactName !== undefined) add("contact_name", text(input.contactName, 255) || null);
    if (input.mobile !== undefined) {
      const normalized = normalizePhone(input.mobile);
      if (input.mobile && !normalized) { const error = new Error("Enter a valid international phone number."); error.status = 400; throw error; }
      add("mobile", normalized);
      const identityKey = normalized ? sha(`phone:${normalized}`) : sha(`manual:${crypto.randomUUID()}`);
      add("identity_key", identityKey);
      await connection.query("INSERT IGNORE INTO pipeline_identity_locks (uid_hash, identity_key, current_lead_id) VALUES (?, ?, NULL)", [uidHash, identityKey]);
      const [identityRows] = await connection.query("SELECT current_lead_id FROM pipeline_identity_locks WHERE uid_hash = ? AND identity_key = ? FOR UPDATE", [uidHash, identityKey]);
      const existingLeadId = identityRows[0]?.current_lead_id;
      if (existingLeadId && existingLeadId !== id) {
        const [existingLeads] = await connection.query("SELECT status FROM pipeline_leads WHERE uid_hash = ? AND id = ? LIMIT 1 FOR UPDATE", [uidHash, existingLeadId]);
        if (existingLeads[0]?.status === "open") {
          const error = new Error("Another open lead already uses this WhatsApp number.");
          error.status = 409;
          throw error;
        }
      }
      if (lead.identity_key !== identityKey) {
        await connection.query("UPDATE pipeline_identity_locks SET current_lead_id = NULL WHERE uid_hash = ? AND identity_key = ? AND current_lead_id = ?", [uidHash, lead.identity_key, id]);
      }
      await connection.query("UPDATE pipeline_identity_locks SET current_lead_id = ? WHERE uid_hash = ? AND identity_key = ?", [id, uidHash, identityKey]);
    }
    if (input.priority !== undefined) {
      if (!["low", "normal", "high", "urgent"].includes(input.priority)) { const error = new Error("Invalid lead priority."); error.status = 400; throw error; }
      add("priority", input.priority);
    }
    const requestedFollowUp=input.nextFollowUpAt===undefined?undefined:inputDbDate(input.nextFollowUpAt);
    if (requestedFollowUp !== undefined) add("next_follow_up_at", requestedFollowUp);
    const outcomes=['no_answer','connected','interested','not_interested','follow_up_scheduled','wrong_number','requested_call','sale_requested'];
    let contactOutcome=null;
    if(input.outcome!==undefined){
      if(!outcomes.includes(input.outcome)){const error=new Error('Choose a valid contact outcome.');error.status=400;throw error;}
      contactOutcome=input.outcome;
    }
    if(input.followUpRequired!==undefined&&typeof input.followUpRequired!=='boolean'){
      const error=new Error('Follow-up required must be true or false.');error.status=400;throw error;
    }
    const followUpRequired=input.followUpRequired===undefined?contactOutcome==='follow_up_scheduled'||contactOutcome==='requested_call':input.followUpRequired;
    const existingFollowUp=lead.next_follow_up_at;
    const providedFollowUp=requestedFollowUp!==undefined?requestedFollowUp:existingFollowUp;
    if(followUpRequired&&!providedFollowUp){const error=new Error('Set a follow-up date and time when follow-up is required.');error.status=400;throw error;}
    if(input.followUpRequired===false&&input.nextFollowUpAt===undefined&&existingFollowUp)add('next_follow_up_at',null);
    if (input.expectedValue !== undefined) {
      const amount = input.expectedValue === null || input.expectedValue === "" ? null : Number(input.expectedValue);
      if (amount !== null && (!Number.isFinite(amount) || amount < 0)) { const error = new Error("Expected value must be zero or greater."); error.status = 400; throw error; }
      add("expected_value", amount);
    }
    if (input.currency !== undefined) {
      const currency = String(input.currency || "").toUpperCase();
      if (!/^[A-Z]{3}$/.test(currency)) { const error = new Error("Currency must be a three-letter code."); error.status = 400; throw error; }
      add("currency", currency);
    }
    if (input.ownerAgentId !== undefined && role !== "agent") {
      let owner = null;
      if (input.ownerAgentId !== null && input.ownerAgentId !== "") {
        const [agents] = await connection.query("SELECT id FROM agents WHERE id = ? AND owner_uid = ? AND is_active = 1 LIMIT 1", [Number(input.ownerAgentId), uid]);
        if (!agents.length) { const error = new Error("Choose an active agent in this workspace."); error.status = 400; throw error; }
        owner = Number(agents[0].id);
      }
      add("owner_agent_id", owner);
    }
    if (changes.length) {
      values.push(activityAt, uidHash, id);
      await connection.query(`UPDATE pipeline_leads SET ${changes.join(", ")}, last_activity_at = ? WHERE uid_hash = ? AND id = ?`, values);
      await addActivity(connection, uidHash, id, "lead_updated", "Lead details updated", { fields: changes.map((value) => value.split(" ")[0]) }, actorType, actorId);
    }
    if(contactOutcome){
      await addActivity(connection,uidHash,id,'contact_outcome',`Contact outcome: ${contactOutcome}`,{outcome:contactOutcome,followUpRequired,nextFollowUpAt:providedFollowUp||null},actorType,actorId);
      if(!changes.length)await connection.query('UPDATE pipeline_leads SET last_activity_at=? WHERE uid_hash=? AND id=?',[activityAt,uidHash,id]);
    }
    if (input.note !== undefined && text(input.note, 2000)) {
      await addActivity(connection, uidHash, id, "note_added", text(input.note, 2000), null, actorType, actorId);
      if(!changes.length&&!contactOutcome)await connection.query('UPDATE pipeline_leads SET last_activity_at=? WHERE uid_hash=? AND id=?',[activityAt,uidHash,id]);
    }
    if (input.automationPaused !== undefined && role !== "agent") {
      await connection.query("UPDATE pipeline_leads SET automation_paused = ?, last_activity_at = ? WHERE uid_hash = ? AND id = ?", [input.automationPaused ? 1 : 0, dbDate(new Date()), uidHash, id]);
      await addActivity(connection, uidHash, id, "automation_setting", input.automationPaused ? "Lead automation paused" : "Lead automation resumed", { paused: Boolean(input.automationPaused) }, actorType, actorId);
    }
    return { id };
  },sourcePool);
}

module.exports = {
  DEFAULT_STAGES,
  normalizePhone,
  normalizeEmail,
  findContactMatches,
  verifiedAdReferral,
  normalizeMetaAdsOpeningMessage,
  matchMetaAdsOpeningMessage,
  parseMetaAdsMessages,
  captureMetaWebhook,
  captureQrMessage,
  getBoard,
  getSettings,
  updateSettings,
  createStage,
  updateStage,
  reorderStages,
  deleteStage,
  createManualLead,
  getLead,
  getFollowUps,
  resolveFollowUp,
  moveLead,
  updateLead,
};
