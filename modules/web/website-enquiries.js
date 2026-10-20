"use strict";
const crypto = require("node:crypto");
const hash = (value) => crypto.createHash("sha256").update(value).digest("hex");
const fail = (code, status = 400) => {
  throw Object.assign(new Error(code), { code, status });
};
const solutions = new Set([
  "crm",
  "automation",
  "messaging",
  "campaigns",
  "training",
  "finance",
  "custom",
  "other",
]);
function clean(input) {
  if (!input || typeof input !== "object" || Array.isArray(input))
    fail("INVALID_ENQUIRY");
  const text = (key, max, required = true) => {
    const value = input[key];
    if (value === undefined && !required) return "";
    if (
      typeof value !== "string" ||
      value.length > max ||
      /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(value) ||
      (required && !value.trim())
    )
      fail("INVALID_" + key.toUpperCase());
    return value.trim();
  };
  const name = text("name", 120),
    email = text("email", 254).toLowerCase(),
    mobile = text("mobile", 40);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail("INVALID_EMAIL");
  // Website requests require a country code; legacy contact forms retain local-number support.
  if (
    !/^\+?[\d ()-]{7,40}$/.test(mobile) ||
    mobile.replace(/\D/g, "").length < 7 ||
    mobile.replace(/\D/g, "").length > 15
  )
    fail("INVALID_MOBILE");
  const solution = text("solution", 30, false) || "other";
  if (!solutions.has(solution)) fail("INVALID_SOLUTION");
  if (input.consent !== undefined && input.consent !== true)
    fail("CONSENT_REQUIRED");
  const token =
    input.submissionToken === undefined
      ? crypto.randomUUID()
      : input.submissionToken;
  if (
    typeof token !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      token,
    )
  )
    fail("INVALID_SUBMISSION_TOKEN");
  return {
    name,
    email,
    mobile: "+" + mobile.replace(/\D/g, ""),
    company: text("company", 160, false),
    solution,
    content: text("content", 2000),
    token: token.toLowerCase(),
    language: input.language === "ar" ? "ar" : "en",
  };
}
async function submitOnce(
  pool,
  input,
  visitorHash,
  {
    createLead = require("../../helper/pipeline/leadPipeline").createManualLead,
  } = {},
) {
  const data = clean(input),
    payloadHash = hash(JSON.stringify({ ...data, token: undefined }));
  const db = await pool.getConnection();
  try {
    await db.beginTransaction();
    // The unique request row serializes simultaneous retries before either business record is created.
    await db.query(
      "INSERT INTO sx_website_enquiries(submission_token,payload_hash) VALUES (?,?) ON DUPLICATE KEY UPDATE submission_token=VALUES(submission_token)",
      [data.token, payloadHash],
    );
    const [[request]] = await db.query(
      "SELECT payload_hash,lead_id FROM sx_website_enquiries WHERE submission_token=? FOR UPDATE",
      [data.token],
    );
    if (request.payload_hash !== payloadHash) fail("SUBMISSION_CHANGED", 409);
    if (request.lead_id) {
      await db.commit();
      return { reference: data.token, repeated: true };
    }
    const window = Math.floor(Date.now() / 3600000);
    await db.query(
      "INSERT INTO sx_website_rate_limits(visitor_hash,window_start,requests) VALUES (?,?,1) ON DUPLICATE KEY UPDATE requests=requests+1",
      [visitorHash, window],
    );
    const [[rate]] = await db.query(
      "SELECT requests FROM sx_website_rate_limits WHERE visitor_hash=? AND window_start=? FOR UPDATE",
      [visitorHash, window],
    );
    if (rate.requests > 8) fail("ENQUIRY_RATE_LIMITED", 429);
    // Resolve only the explicitly designated first-party tenant, never a client-supplied tenant/owner.
    const [owners] = await db.query(
      `SELECT t.id AS tenant_id,u.uid,o.legacy_uid_hash
      FROM sx_tenants t JOIN sx_legacy_ownership o ON o.tenant_id=t.id AND o.source_table='user'
      JOIN user u ON CONVERT(CAST(u.id AS CHAR) USING utf8mb4) COLLATE utf8mb4_bin=CONVERT(o.source_id USING utf8mb4) COLLATE utf8mb4_bin JOIN sx_memberships m ON m.id=o.membership_id AND m.tenant_id=t.id
      JOIN sx_identities i ON i.id=m.identity_id
      WHERE t.category_key='salemax_sales' AND t.status='active' AND m.role='owner' AND m.status='active' AND i.status='active'
      AND t.slug=? LIMIT 2 FOR UPDATE`,
      [
        process.env.SALEMAX_WEBSITE_SALES_TENANT_SLUG ||
          "salemax-sales-86c35173",
      ],
    );
    if (
      owners.length !== 1 ||
      owners[0].legacy_uid_hash !== hash(owners[0].uid)
    )
      fail("SALES_ROUTING_UNAVAILABLE", 503);
    const owner = owners[0];
    const summary = [
      `Website enquiry · ${data.solution}`,
      data.company && `Company: ${data.company}`,
      `Language: ${data.language}`,
      data.content,
    ]
      .filter(Boolean)
      .join("\n");
    const [contact] = await db.query(
      "INSERT INTO contact_form(email,name,mobile,content) VALUES (?,?,?,?)",
      [data.email, data.name, data.mobile, summary],
    );
    const lead = await createLead({
      uid: owner.uid,
      actorType: "system",
      role: "owner",
      connection: db,
      input: {
        title: `${data.company || data.name} · ${data.solution}`,
        contactName: data.name,
        mobile: data.mobile,
        email: data.email,
        sourceType: "public_form",
        qualificationData: {
          source: "website",
          referralSource: "SaleMaX website",
          preferredContactMethod: "email",
        },
      },
    });
    await db.query(
      `INSERT INTO pipeline_activity(uid_hash,lead_id,actor_type,activity_type,summary,details,created_at)
      VALUES (?,?,'system','note_added',?,?,UTC_TIMESTAMP(3))`,
      [
        hash(owner.uid),
        lead.id,
        summary.slice(0, 500),
        JSON.stringify({
          source: "salemax_website",
          request: data.token,
          company: data.company,
          solution: data.solution,
          content: data.content,
          language: data.language,
        }),
      ],
    );
    await db.query(
      "UPDATE sx_website_enquiries SET contact_form_id=?,tenant_id=?,lead_id=? WHERE submission_token=?",
      [contact.insertId, owner.tenant_id, lead.id, data.token],
    );
    // Keep anonymous rate buckets bounded without removing enquiry/audit history.
    await db.query(
      "DELETE FROM sx_website_rate_limits WHERE window_start<? LIMIT 100",
      [window - 48],
    );
    await db.commit();
    return { reference: data.token, repeated: false };
  } catch (error) {
    await db.rollback();
    throw error;
  } finally {
    db.release();
  }
}
async function submit(pool, input, visitorHash, options) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await submitOnce(pool, input, visitorHash, options);
    } catch (error) {
      if (
        !["ER_LOCK_DEADLOCK", "ER_LOCK_WAIT_TIMEOUT"].includes(error.code) ||
        attempt === 2
      )
        throw error;
    }
  }
}
module.exports = { clean, submit, solutions };
