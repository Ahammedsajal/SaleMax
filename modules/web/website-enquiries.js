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
const industries = new Set([
  "business", "training", "real_estate", "apparel_wholesale",
  "retail_ecommerce", "electronics", "restaurants", "grocery",
  "healthcare", "construction", "automotive", "hospitality",
  "manufacturing", "other",
]);
const industryLabels = {
  business: "Sales & professional services",
  training: "Training & education",
  real_estate: "Real estate & property",
  apparel_wholesale: "Clothing, fashion & wholesale",
  retail_ecommerce: "Retail & ecommerce",
  electronics: "Electronics & appliances",
  restaurants: "Restaurants & cafes",
  grocery: "Groceries & supermarkets",
  healthcare: "Healthcare & wellness",
  construction: "Construction & contracting",
  automotive: "Automotive & transport",
  hospitality: "Hospitality & tourism",
  manufacturing: "Manufacturing & distribution",
  other: "Other",
};
const industryLabelsAr = {
  business: "المبيعات والخدمات المهنية",
  training: "التدريب والتعليم",
  real_estate: "العقارات وإدارة الممتلكات",
  apparel_wholesale: "الملابس والأزياء وتجارة الجملة",
  retail_ecommerce: "التجزئة والتجارة الإلكترونية",
  electronics: "الإلكترونيات والأجهزة",
  restaurants: "المطاعم والمقاهي",
  grocery: "البقالة والسوبرماركت",
  healthcare: "الصحة والعافية",
  construction: "الإنشاءات والمقاولات",
  automotive: "السيارات والنقل",
  hospitality: "الضيافة والسياحة",
  manufacturing: "التصنيع والتوزيع",
  other: "أخرى",
};
const consent = {
  version: "website-contact-whatsapp-v1",
  en: "I agree that 7Network may contact me about this enquiry by WhatsApp, email or phone. I understand my enquiry details will be shared with the 7Network Sales team for follow-up.",
  ar: "أوافق على أن يتواصل معي 7Network بشأن هذا الاستفسار عبر واتساب أو البريد الإلكتروني أو الهاتف، وأفهم أن تفاصيل استفساري ستُشارك مع فريق مبيعات 7Network للمتابعة.",
};
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
  const industry = text("industry", 40, false) || "other";
  if (!industries.has(industry)) fail("INVALID_INDUSTRY");
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
    industry,
    solution,
    content: text("content", 2000, false),
    consented: input.consent === true,
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
    payloadHash = hash(JSON.stringify({ ...data, token: undefined })),
    legacyPayloadHash = hash(
      JSON.stringify({ ...data, industry: undefined, consented: undefined, token: undefined }),
    );
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
    if (request.lead_id) {
      // Before WhatsApp notifications, industry and consent metadata were not
      // part of the idempotency hash. Keep retries from old open forms safe.
      if (request.payload_hash !== payloadHash && request.payload_hash !== legacyPayloadHash)
        fail("SUBMISSION_CHANGED", 409);
      await db.commit();
      return { reference: data.token, repeated: true };
    }
    if (request.payload_hash !== payloadHash) fail("SUBMISSION_CHANGED", 409);
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
      `SELECT t.id AS tenant_id,u.uid,NULLIF(u.mobile_with_country_code,'') AS owner_mobile,o.legacy_uid_hash
      FROM sx_tenants t JOIN sx_legacy_ownership o ON o.tenant_id=t.id AND o.source_table='user'
      JOIN user u ON CONVERT(CAST(u.id AS CHAR) USING utf8mb4) COLLATE utf8mb4_bin=CONVERT(o.source_id USING utf8mb4) COLLATE utf8mb4_bin JOIN sx_memberships m ON m.id=o.membership_id AND m.tenant_id=t.id
      JOIN sx_identities i ON i.id=m.identity_id
      WHERE t.category_key='7network_sales' AND t.status='active' AND m.role='owner' AND m.status='active' AND i.status='active'
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
    const industry = industryLabels[data.industry];
    const summary = [
      `Website enquiry · ${industry} · ${data.solution}`,
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
        title: `${data.company || data.name} · ${industry}`,
        contactName: data.name,
        mobile: data.mobile,
        email: data.email,
        sourceType: "public_form",
        qualificationData: {
          source: "website",
          referralSource: "7Network website",
          // The existing Pipeline qualification contract accepts only these
          // three values. The consent disclosure separately covers phone/email.
          preferredContactMethod: "whatsapp",
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
          industry: data.industry,
          industryLabel: industry,
          solution: data.solution,
          content: data.content,
          language: data.language,
        }),
      ],
    );
    await db.query(
      `UPDATE sx_website_enquiries SET contact_form_id=?,tenant_id=?,lead_id=?,industry=?,
      consent_version=?,consent_text_en=?,consent_text_ar=?,consented_at=IF(?,UTC_TIMESTAMP(3),NULL),language=?
      WHERE submission_token=?`,
      [contact.insertId, owner.tenant_id, lead.id, data.industry,
        data.consented ? consent.version : null,
        data.consented ? consent.en : null,
        data.consented ? consent.ar : null,
        Number(data.consented), data.language, data.token],
    );
    // The lead and both notification deliveries commit together. The worker
    // never sends within this request transaction.
    if (data.consented) {
      const notifications = require("./website-enquiry-notifications");
      await notifications.enqueue(db, {
        tenantId: owner.tenant_id,
        submissionToken: data.token,
        salesPhone: owner.owner_mobile,
        submitterPhone: data.mobile,
      });
    }
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
module.exports = { clean, submit, solutions, industries, industryLabels, industryLabelsAr, consent };
