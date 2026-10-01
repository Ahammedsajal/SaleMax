const router = require("express").Router();
const { sign } = require("jsonwebtoken");
const fetch = require("node-fetch");
const { query } = require("../database/dbpromise.js");
const validateUser = require("../middlewares/user.js");
const validateAgent = require("../middlewares/agent.js");

const CRM_ISSUE_URL = "https://crm.gccbot.com/api/internal/gccbot/sso/issue";
const CRM_PROVISION_URL = "https://crm.gccbot.com/api/internal/gccbot/sso/provision-paid";
const CRM_EXCHANGE_URL = "https://crm.gccbot.com/api/internal/gccbot/sso/exchange";

function validVerifier(value) {
  return typeof value === "string" && /^[A-Za-z0-9._~-]{43,128}$/.test(value);
}

function challengeForVerifier(verifier) {
  return require("crypto").createHash("sha256").update(verifier).digest("base64url");
}

function setNoStore(res) {
  res.set("Cache-Control", "no-store, private");
  res.set("Referrer-Policy", "no-referrer");
  res.set("X-Content-Type-Options", "nosniff");
}

async function startCrmSignIn({ uid, role, ownerUid }, res) {
  try {
    if (role === "user") {
      const [nodeUser] = await query(
        `SELECT uid, email, name, plan, plan_expire FROM user WHERE uid = ? LIMIT 1`,
        [String(uid)],
      );
      if (!nodeUser) {
        return res.status(403).json({ success: false, message: "This Node account is unavailable." });
      }

      let plan = {};
      try {
        plan = JSON.parse(nodeUser.plan || "{}") || {};
      } catch (_) {
        plan = {};
      }
      const planExpiry = Number(nodeUser.plan_expire || 0);
      const hasActivePaidPlan = Number(plan.price || 0) > 0
        && Number(plan.is_trial || 0) !== 1
        && planExpiry > Date.now();

      if (hasActivePaidPlan) {
        const provision = await fetch(CRM_PROVISION_URL, {
          method: "POST",
          timeout: 10000,
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
            "x-internal-secret": String(process.env.CRM_INTERNAL_SECRET || ""),
          },
          body: JSON.stringify({
            uid: String(nodeUser.uid),
            email: String(nodeUser.email || "").trim().toLowerCase(),
            name: String(nodeUser.name || "").trim(),
            paid_plan_active: true,
          }),
        });
        const provisionResult = await provision.json().catch(() => ({}));
        if (!provision.ok || provisionResult.success !== true) {
          return res.status(403).json({
            success: false,
            message: "This paid account could not be safely linked to its CRM user.",
          });
        }
      }
    }

    const verifier = require("crypto").randomBytes(32).toString("base64url");
    const response = await fetch(CRM_ISSUE_URL, {
      method: "POST",
      timeout: 10000,
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "x-internal-secret": String(process.env.CRM_INTERNAL_SECRET || ""),
      },
      body: JSON.stringify({
        uid: String(uid),
        role,
        ...(ownerUid ? { owner_uid: String(ownerUid) } : {}),
        code_challenge: challengeForVerifier(verifier),
      }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || result.success !== true || typeof result.redirect_url !== "string") {
      return res.status(response.status === 401 ? 503 : 403).json({
        success: false,
        message: "This Node account is not linked to an active CRM user.",
      });
    }

    const redirect = new URL(result.redirect_url);
    if (redirect.protocol !== "https:" || redirect.hostname !== "crm.gccbot.com" || redirect.pathname !== "/sso/from-node") {
      return res.status(502).json({ success: false, message: "CRM returned an invalid sign-in destination." });
    }
    redirect.hash = new URLSearchParams({ code_verifier: verifier }).toString();

    setNoStore(res);
    return res.json({ success: true, redirect_url: redirect.toString() });
  } catch (error) {
    return res.status(503).json({ success: false, message: "CRM sign-in is temporarily unavailable." });
  }
}

router.post("/node/start", validateUser, (req, res) => {
  if (req.decode?.role !== "user" || !req.decode?.userData?.uid) {
    return res.status(403).json({ success: false, message: "This account cannot start CRM sign-in." });
  }
  return startCrmSignIn({ uid: req.decode.userData.uid, role: "user" }, res);
});

router.post("/node/agent-start", validateAgent, (req, res) => {
  if (req.decode?.role !== "agent" || !req.decode?.userData?.uid || !req.owner?.uid) {
    return res.status(403).json({ success: false, message: "This agent account cannot start CRM sign-in." });
  }
  return startCrmSignIn({ uid: req.decode.userData.uid, role: "agent", ownerUid: req.owner.uid }, res);
});

router.get("/callback", (req, res) => {
  const code = String(req.query?.code || "");
  if (!/^[a-f0-9]{64}$/.test(code)) {
    return res.status(400).send("Invalid sign-in link.");
  }

  const nonce = require("crypto").randomBytes(18).toString("base64url");
  const isArabic = /^ar(?:-|,|$)/i.test(String(req.get("accept-language") || ""));
  const lang = isArabic ? "ar" : "en";
  const direction = isArabic ? "rtl" : "ltr";
  const title = isArabic ? "تسجيل الدخول إلى واتساب" : "Sign in to WhatsApp";
  const waiting = isArabic ? "يرجى الانتظار حتى نتحقق من حسابك." : "Please wait while we verify your account.";
  const contentSecurityPolicy = `default-src 'none'; script-src 'self' 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'`;

  setNoStore(res);
  res.set("Content-Security-Policy", contentSecurityPolicy);
  return res.type("html").send(`<!doctype html><html lang="${lang}" dir="${direction}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style nonce="${nonce}">*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:20px;background:#f4f7f8;color:#18313a;font-family:Roboto,Arial,sans-serif}main{width:min(100%,480px);padding:30px;border:1px solid #e2e9e9;border-radius:22px;background:#fff;box-shadow:0 20px 60px rgba(22,48,56,.10)}h1{margin:0 0 12px;font-size:25px;line-height:1.25}p{color:#5d6b70;line-height:1.6}button,a{display:inline-flex;align-items:center;justify-content:center;min-height:46px;padding:0 18px;border-radius:12px;font:600 15px Roboto,Arial,sans-serif}button{border:0;background:#087f6b;color:#fff;cursor:pointer}a{margin-inline-start:8px;color:#42575b;text-decoration:none;border:1px solid #dbe3e3}@media(max-width:480px){main{padding:24px 20px}button,a{width:100%;margin:6px 0}}</style></head><body><main><h1>${title}</h1><p id="message" role="status" aria-live="polite">${waiting}</p><section id="confirmation" hidden><p id="identity"></p><button id="continue" type="button">${isArabic ? "متابعة إلى واتساب" : "Continue to WhatsApp"}</button> <a href="/">${isArabic ? "إلغاء" : "Cancel"}</a></section></main><script src="/sso-callback.js" defer></script></body></html>`);
});

router.post("/callback/consume", async (req, res) => {
  const code = String(req.body?.code || "");
  const verifier = String(req.body?.code_verifier || "");
  if (!/^[a-f0-9]{64}$/.test(code) || !validVerifier(verifier)) {
    return res.status(422).json({ success: false, message: "Sign-in could not be verified." });
  }

  try {
    const response = await fetch(CRM_EXCHANGE_URL, {
      method: "POST",
      timeout: 10000,
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "x-internal-secret": String(process.env.CRM_INTERNAL_SECRET || ""),
      },
      body: JSON.stringify({ code, code_verifier: verifier }),
    });
    const result = await response.json().catch(() => ({}));
    const identity = result?.identity;
    if (!response.ok || result.success !== true || !["user", "agent"].includes(identity?.role) || !identity.uid || !identity.email) {
      setNoStore(res);
      return res.status(401).json({ success: false, message: "This sign-in link expired or was already used." });
    }

    let user;
    let tokenClaims;
    if (identity.role === "user") {
      [user] = await query(
        `SELECT uid, email, name, password, role FROM user WHERE uid = ? LIMIT 1`,
        [String(identity.uid)],
      );
      if (user?.role === "user") {
        tokenClaims = { uid: user.uid, role: "user", password: user.password, email: user.email };
      }
    } else {
      [user] = await query(
        `SELECT uid, owner_uid, email, name, password, is_active FROM agents WHERE uid = ? LIMIT 1`,
        [String(identity.uid)],
      );
      if (user && Number(user.is_active) > 0 && String(user.owner_uid) === String(identity.owner_uid)) {
        tokenClaims = { uid: user.uid, role: "agent", password: user.password, email: user.email, owner_uid: user.owner_uid };
      }
    }

    if (!user || !tokenClaims || String(user.email || "").toLowerCase() !== String(identity.email).toLowerCase()) {
      setNoStore(res);
      return res.status(403).json({ success: false, message: "The linked WhatsApp account is unavailable." });
    }

    const token = sign(tokenClaims, process.env.JWTKEY);

    setNoStore(res);
    return res.json({
      success: true,
      token,
      identity: { uid: user.uid, name: user.name, email: user.email, role: identity.role, owner_uid: identity.owner_uid || null },
    });
  } catch (error) {
    setNoStore(res);
    return res.status(503).json({ success: false, message: "WhatsApp sign-in is temporarily unavailable." });
  }
});

module.exports = router;
