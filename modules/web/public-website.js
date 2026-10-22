"use strict";
const express = require("express");
const crypto = require("node:crypto");
const path = require("node:path");
const net = require("node:net");
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
    if (req.crmTenantDomain || !require("../platform/request-origin").matchesPlatformHost(req, origin))
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
}
module.exports = { mountPublicWebsite };
