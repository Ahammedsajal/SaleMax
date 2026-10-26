"use strict";
const express = require("express");
const crypto = require("node:crypto");
const path = require("node:path");
const net = require("node:net");
const tenantStorefront = require("../platform/tenant-storefront");
const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, character => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[character]));
async function sendTenantStorefront(req,res,pool) {
  const db=await pool.getConnection();let brand;
  try{brand=await tenantStorefront.publicBrand(db,req.crmTenantDomain.hostname);}finally{db.release();}
  if(!brand)return res.status(404).set("Cache-Control","no-store").type("text").send("This business website is not published.");
  if(brand.primaryHostname&&brand.primaryHostname!==req.crmTenantDomain.hostname)return res.redirect(308,`https://${brand.primaryHostname}${req.originalUrl}`);
  const content=brand.content||{},arabic=/^ar(?:[-,;]|$)/i.test(req.get('accept-language')||'');
  const name=escapeHtml(brand.name),headline=escapeHtml((arabic&&content.headlineAr)||content.headline||brand.name),tagline=escapeHtml((arabic&&content.taglineAr)||content.tagline||''),description=escapeHtml((arabic&&content.descriptionAr)||content.description||''),about=escapeHtml((arabic&&content.aboutAr)||content.about||'');
  const logo=brand.logoUrl?`<img class="logo" src="${escapeHtml(brand.logoUrl)}" alt="${name}">`:"";
  const phone=String(content.contactPhone||"").replace(/[^+\d]/g,"").slice(0,30),email=String(content.contactEmail||"").replace(/[^\w.@+-]/g,"").slice(0,254),wa=String(content.whatsappNumber||"").replace(/\D/g,"").slice(0,15);
  const contact=[phone?`<a href="tel:${escapeHtml(phone)}">${escapeHtml(phone)}</a>`:"",email?`<a href="mailto:${escapeHtml(email)}">${escapeHtml(email)}</a>`:""].filter(Boolean).join(" · ");
  const sections=Array.isArray(content.sections)?content.sections.map(section=>`<section class="section"><h2>${escapeHtml((arabic&&section.titleAr)||section.title||section.type)}</h2><p>${escapeHtml((arabic&&section.bodyAr)||section.body)}</p></section>`).join(""):"";
  res.setHeader("Cache-Control","public, max-age=60, s-maxage=60, stale-while-revalidate=30");res.setHeader("Vary","Host, Accept-Language");res.setHeader("Referrer-Policy","strict-origin-when-cross-origin");res.setHeader("Content-Security-Policy","default-src 'self'; script-src 'none'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
  return res.type("html").send(`<!doctype html><html lang="${arabic?'ar':'en'}" dir="${arabic?'rtl':'ltr'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="description" content="${description.slice(0,320)}"><title>${headline} | ${name}</title><link rel="stylesheet" href="/tenant-storefront.css"><link rel="canonical" href="https://${escapeHtml(brand.primaryHostname||req.crmTenantDomain.hostname)}/"></head><body><header>${logo}<span>${name}</span></header><main><section class="hero"><p class="eyebrow">${tagline}</p><h1>${headline}</h1><p>${description}</p><a class="button" href="#contact">${arabic?'تواصل معنا':'Contact us'}</a></section>${about?`<section class="section"><h2>${arabic?'من نحن':'About us'}</h2><p>${about}</p></section>`:""}${sections}<section class="section" id="contact"><h2>${arabic?'اتصل بنا':'Contact'}</h2><p>${contact|| (arabic?'تواصل معنا لمعرفة المزيد.':'Contact us to learn more.')}</p>${wa?`<a class="whatsapp" href="https://wa.me/${wa}" rel="noopener noreferrer">${arabic?'تواصل عبر واتساب':'Chat on WhatsApp'}</a>`:""}</section></main><footer>${name}</footer></body></html>`);
}
function mountPublicWebsite(app, { pool, key, origin }) {
  const router = express.Router();
  router.use((req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    if (req.crmTenantDomain || !require("../platform/request-origin").matches(req, origin))
      return res.status(403).json({ success: false, code: "ORIGIN_DENIED" });
    return next();
  });
  router.use(express.json({ limit: "16kb", strict: true }));
  router.use(express.urlencoded({ limit: "16kb", extended: false }));
  router.post("/", async (req, res, next) => {
    try {
      if (req.body?.website)
        return res
          .status(201)
          .json({ success: true, reference: crypto.randomUUID() });
      if (
        req.baseUrl === "/api/public/website/enquiries" &&
        req.body?.consent !== true
      )
        return res
          .status(400)
          .json({ success: false, code: "CONSENT_REQUIRED" });
      // nginx appends its direct peer last; earlier user-supplied forwarding entries are ignored.
      const forwarded = String(req.get("X-Forwarded-For") || "")
        .split(",")
        .at(-1)
        ?.trim();
      const remote = req.socket.remoteAddress || "unknown";
      const trustedProxy =
        /^(?:127\.|::1$|::ffff:127\.|172\.(?:1[6-9]|2\d|3[01])\.)/.test(remote);
      const visitor =
        trustedProxy && net.isIP(forwarded || "") ? forwarded : remote;
      const visitorHash = crypto
        .createHmac("sha256", key)
        .update(visitor)
        .digest("hex");
      const result = await require("./website-enquiries").submit(
        pool,
        req.body,
        visitorHash,
      );
      res
        .status(result.repeated ? 200 : 201)
        .json({
          success: true,
          ...result,
          msg: "Thank you. Your enquiry is with the 7Network sales team.",
        });
    } catch (error) {
      next(error);
    }
  });
  router.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    const status =
      error.type === "entity.too.large"
        ? 413
        : error.type === "entity.parse.failed"
          ? 400
          : error.status || 503;
    res
      .status(status)
      .json({
        success: false,
        code:
          status === 503
            ? "ENQUIRY_UNAVAILABLE"
            : error.code || "INVALID_ENQUIRY",
      });
  });
  app.use(
    ["/api/public/website/enquiries", "/api/web/submit_contact_form"],
    router,
  );
  app.get("/", (req, res, next) => {
    if (req.crmTenantDomain) return sendTenantStorefront(req,res,pool).catch(next);
    if (!require("../platform/request-origin").matchesPlatformHost(req, origin))
      return next();
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
    );
    res.sendFile(
      path.resolve(__dirname, "../../client/public/website/index.html"),
    );
  });
  app.get(/^\/(?:courses|products|services|updates|careers|contact)(?:\/.*)?$/,(req,res,next)=>{
    if(!req.crmTenantDomain)return next();
    return sendTenantStorefront(req,res,pool).catch(next);
  });
  app.get("/tenant-storefront.css",async(req,res,next)=>{
    if(!req.crmTenantDomain)return next();
    const db=await pool.getConnection();let brand;try{brand=await tenantStorefront.publicBrand(db,req.crmTenantDomain.hostname);}catch(error){return next(error);}finally{db.release();}if(!brand)return res.status(404).end();
    const primary=/^#[0-9a-f]{6}$/i.test(brand.content.primaryColor||'')?brand.content.primaryColor:'#1768d4',accent=/^#[0-9a-f]{6}$/i.test(brand.content.accentColor||'')?brand.content.accentColor:'#12c9f4';
    res.setHeader("Cache-Control","public, max-age=300, s-maxage=300");res.setHeader("Vary","Host");res.type("text/css").send(`:root{--brand-color:${primary};--accent-color:${accent}}*{box-sizing:border-box}body{margin:0;color:#15243a;font:16px/1.6 system-ui,-apple-system,"Segoe UI",sans-serif;background:#f6f8fb}header,main,footer{width:min(1080px,100% - 32px);margin:auto}header{display:flex;align-items:center;gap:12px;padding:18px 0;font-weight:700}.logo{max-width:180px;max-height:58px;object-fit:contain}.hero{padding:clamp(48px,12vw,112px) clamp(22px,7vw,76px);border-radius:28px;background:linear-gradient(135deg,#081630,var(--brand-color));color:white}.hero h1{max-width:760px;font-size:clamp(36px,7vw,68px);line-height:1.08;margin:8px 0 20px}.hero p{max-width:700px}.eyebrow{color:var(--accent-color)}.button,.whatsapp{display:inline-flex;margin-top:12px;padding:12px 20px;border-radius:999px;background:white;color:#081630;font-weight:700;text-decoration:none}.section{padding:38px clamp(6px,3vw,28px);border-bottom:1px solid #dce3ec}.section h2{font-size:clamp(23px,4vw,34px)}.section p{max-width:760px;white-space:pre-line;color:#46566d}.whatsapp{background:#087b53;color:white}footer{text-align:center;padding:30px;color:#667085}a:focus-visible{outline:3px solid #f7b63c;outline-offset:3px}@media(max-width:600px){header,main,footer{width:calc(100% - 24px)}.hero{border-radius:20px;padding:42px 22px}.section{padding:28px 4px}}`);
  });
}
module.exports = { mountPublicWebsite };
