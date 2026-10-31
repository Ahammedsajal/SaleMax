"use strict";

const fs = require("node:fs");
const path = require("node:path");

const file = path.resolve(
  process.argv[2] || "runtime/public-pricing-preserved/public-website.js",
);
const source = fs.readFileSync(file, "utf8");
const before =
  "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'";
const after =
  "default-src 'self'; script-src 'self' https://connect.facebook.net; style-src 'self'; img-src 'self' data: https://www.facebook.com; connect-src 'self' https://connect.facebook.net https://www.facebook.com; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'";

const occurrences = source.split(before).length - 1;
if (occurrences !== 1) {
  throw new Error(`Expected one public-site CSP policy, found ${occurrences}`);
}
fs.writeFileSync(file, source.replace(before, after), { mode: 0o644 });
