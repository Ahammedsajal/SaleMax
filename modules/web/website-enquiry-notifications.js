"use strict";

const crypto = require("node:crypto");
const whatsapp = require("../platform/business-whatsapp");
const enquiries = require("./website-enquiries");

const uuid = () => crypto.randomUUID();
const hash = (value) =>
  crypto.createHash("sha256").update(String(value)).digest("hex");
const clean = (value, limit = 1600) =>
  String(value || "")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/gu, " ")
    .replace(/\r\n?/g, "\n")
    .trim()
    .slice(0, limit);

async function enqueue(db, { tenantId, submissionToken, salesPhone, submitterPhone }) {
  const recipients = [
    ["sales_owner", salesPhone],
    ["submitter", submitterPhone],
  ];
  for (const [kind, value] of recipients) {
    const destination = whatsapp.phone(value);
    await db.query(
      `INSERT IGNORE INTO sx_website_enquiry_deliveries
      (id,submission_token,tenant_id,recipient_kind,destination_hash,status,available_at)
      VALUES (?,?,?,?,?,'queued',UTC_TIMESTAMP(3))`,
      [
        uuid(),
        submissionToken,
        tenantId,
        kind,
        destination ? hash(destination) : null,
      ],
    );
  }
}

async function claim(db) {
  await db.beginTransaction();
  try {
    // A timed-out provider call may already have delivered. Never auto-resend it.
    await db.query(
      `UPDATE sx_website_enquiry_deliveries
       SET status='unknown',error_code='SEND_OUTCOME_UNKNOWN',lease_token=NULL,lease_expires_at=NULL
       WHERE status='sending' AND lease_expires_at<=UTC_TIMESTAMP(3) LIMIT 100`,
    );
    const [[item]] = await db.query(
      `SELECT id,submission_token,tenant_id,recipient_kind,destination_hash,attempts
       FROM sx_website_enquiry_deliveries
       WHERE status='queued' AND available_at<=UTC_TIMESTAMP(3)
       ORDER BY available_at,id LIMIT 1 FOR UPDATE SKIP LOCKED`,
    );
    if (!item) {
      await db.commit();
      return null;
    }
    const token = uuid();
    await db.query(
      `UPDATE sx_website_enquiry_deliveries SET status='sending',attempts=attempts+1,
       lease_token=?,lease_expires_at=DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 90 SECOND)
       WHERE id=? AND status='queued'`,
      [token, item.id],
    );
    await db.commit();
    return { ...item, token, attempts: Number(item.attempts) + 1 };
  } catch (error) {
    await db.rollback();
    throw error;
  }
}

async function load(db, item) {
  const [[row]] = await db.query(
    `SELECT e.contact_form_id AS contactFormId,e.lead_id AS leadId,e.industry,e.language,
      e.submission_token AS reference,c.name,c.email,c.mobile,c.content
     FROM sx_website_enquiries e
     JOIN contact_form c ON c.id=e.contact_form_id
     JOIN sx_tenants t ON t.id=e.tenant_id AND t.status='active'
     WHERE e.submission_token=? AND e.tenant_id=? AND e.lead_id IS NOT NULL LIMIT 1`,
    [item.submission_token, item.tenant_id],
  );
  if (!row) return { errorCode: "ENQUIRY_RECORD_UNAVAILABLE" };
  let salesPhone = null;
  if (item.recipient_kind === "sales_owner") {
    const [owners] = await db.query(
      `SELECT NULLIF(u.mobile_with_country_code,'') AS mobile
       FROM sx_memberships m
       JOIN sx_identities i ON i.id=m.identity_id AND i.status='active'
       JOIN sx_legacy_ownership o ON o.membership_id=m.id AND o.tenant_id=m.tenant_id AND o.source_table='user'
       JOIN user u ON o.source_table='user' AND o.source_id=CAST(u.id AS CHAR)
       WHERE m.tenant_id=? AND m.role='owner' AND m.status='active'
         AND i.email_normalized='admin@salemax.qa'
         AND o.legacy_uid_hash=CONVERT(SHA2(u.uid,256) USING ascii) COLLATE ascii_bin
       LIMIT 2`,
      [item.tenant_id],
    );
    if (owners.length !== 1) return { errorCode: "SALES_OWNER_UNAVAILABLE" };
    salesPhone = whatsapp.phone(owners[0].mobile);
    if (!salesPhone || !item.destination_hash || hash(salesPhone) !== item.destination_hash)
      return { errorCode: "SALES_OWNER_DESTINATION_UNAVAILABLE" };
  }
  const submitterPhone = whatsapp.phone(row.mobile);
  if (item.recipient_kind === "submitter" && !submitterPhone)
    return { errorCode: "SUBMITTER_DESTINATION_UNAVAILABLE" };
  return { row, salesPhone, submitterPhone };
}

function salesMessage(row) {
  const labels = row.language === "ar" ? enquiries.industryLabelsAr : enquiries.industryLabels;
  const industry = labels[row.industry] || labels.other;
  const [request, ...details] = String(row.content || "").split("\n");
  return [
    "New 7Network website enquiry",
    "",
    `Reference: ${row.reference}`,
    `Name: ${clean(row.name, 120)}`,
    `Phone: ${clean(row.mobile, 40)}`,
    `Email: ${clean(row.email, 254)}`,
    `Industry: ${industry}`,
    `Request: ${clean(request, 180)}`,
    ...details.map((line) => clean(line, 1000)).filter(Boolean),
    "Lead saved in the 7Network Sales Pipeline.",
  ].join("\n");
}

function submitterMessage(row) {
  const labels = row.language === "ar" ? enquiries.industryLabelsAr : enquiries.industryLabels;
  const industry = labels[row.industry] || labels.other;
  if (row.language === "ar")
    return `مرحباً ${clean(row.name, 120)}، استلم فريق مبيعات 7Network استفسارك عن ${industry}. سنتواصل معك قريباً.\nالمرجع: ${row.reference}`;
  return `Hello ${clean(row.name, 120)}, 7Network Sales received your enquiry about ${industry}. Our team will follow up with you soon.\nReference: ${row.reference}`;
}

async function dispatch(db, item, options = {}) {
  const loaded = await load(db, item);
  if (loaded.errorCode) return { status: "blocked", errorCode: loaded.errorCode };
  const { row, salesPhone, submitterPhone } = loaded;
  let message = salesMessage(row);
  if (item.recipient_kind === "submitter") {
    message = submitterMessage(row);
  }
  const result = await (options.send || whatsapp.send)({
    tenantId: item.tenant_id,
    to: item.recipient_kind === "sales_owner" ? salesPhone : submitterPhone,
    text: message,
    ...(options.env ? { env: options.env } : {}),
    ...(options.http ? { http: options.http } : {}),
  });
  if (result.status === "accepted")
    return { status: "accepted", providerMessageId: result.providerMessageId };
  if (result.status === "unknown")
    return { status: "unknown", errorCode: result.errorCode || "QR_SEND_OUTCOME_UNKNOWN" };
  return { status: "blocked", errorCode: result.errorCode || "QR_DELIVERY_BLOCKED" };
}

async function finish(db, item, result) {
  const status = ["accepted", "unknown"].includes(result.status) ? result.status : "queued";
  const backoffSeconds = Math.min(3600, 60 * 2 ** Math.min(item.attempts - 1, 6));
  const [updated] = await db.query(
    `UPDATE sx_website_enquiry_deliveries SET status=?,error_code=?,provider_message_id=?,
      accepted_at=IF(?='accepted',UTC_TIMESTAMP(3),NULL),
      available_at=IF(?='queued',DATE_ADD(UTC_TIMESTAMP(3),INTERVAL ? SECOND),available_at),
      lease_token=NULL,lease_expires_at=NULL
     WHERE id=? AND status='sending' AND lease_token=?`,
    [
      status,
      result.errorCode || null,
      result.providerMessageId || null,
      status,
      status,
      backoffSeconds,
      item.id,
      item.token,
    ],
  );
  if (updated.affectedRows !== 1) throw Object.assign(Error("ENQUIRY_DELIVERY_LEASE_LOST"), { code: "ENQUIRY_DELIVERY_LEASE_LOST" });
  return status;
}

async function tick(pool, { limit = 10 } = {}) {
  const totals = { accepted: 0, queued: 0, unknown: 0 };
  for (let index = 0; index < limit; index++) {
    const db = await pool.getConnection();
    try {
      const item = await claim(db);
      if (!item) break;
      let result;
      try {
        result = await dispatch(db, item);
      } catch (error) {
        result = {
          status: "unknown",
          errorCode: /^[A-Z0-9_]{2,64}$/.test(error.code || "") ? error.code : "ENQUIRY_DELIVERY_UNCONFIRMED",
        };
      }
      const status = await finish(db, item, result);
      totals[status]++;
    } finally {
      db.release();
    }
  }
  return totals;
}

function start({ env = process.env, pool } = {}) {
  if (env.LOCAL_ONLY_MODE === "true") return { stop() {} };
  pool = pool || require("../../database/config").promise();
  let stopped = false;
  let busy = false;
  let timer;
  const loop = async () => {
    if (stopped || busy) return;
    busy = true;
    try {
      const result = await tick(pool);
      if (result.accepted || result.unknown)
        console.log(JSON.stringify({ websiteEnquiryDeliveries: result }));
    } catch (error) {
      console.error(JSON.stringify({
        event: "website_enquiry_delivery_worker_failed",
        code: /^[A-Z0-9_]{2,64}$/.test(error.code || "") ? error.code : "WORKER_FAILED",
      }));
    } finally {
      busy = false;
      if (!stopped) timer = setTimeout(loop, 15000);
    }
  };
  timer = setTimeout(loop, 20000);
  return { stop() { stopped = true; clearTimeout(timer); } };
}

module.exports = { enqueue, claim, load, salesMessage, submitterMessage, dispatch, finish, tick, start };
