"use strict";

// Apply only reviewed public website assets and the OpenAI CSP change to a
// release cloned from the exact active release. Preserve its live storefront
// routes in the production runtime overlay.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const [targetArg, sourceArg] = process.argv.slice(2);
if (!targetArg || !sourceArg) throw Error("TARGET_AND_SOURCE_REQUIRED");
const target = path.resolve(targetArg);
const source = path.resolve(sourceArg);
if (target === source) throw Error("DISTINCT_TARGET_AND_SOURCE_REQUIRED");
if (!fs.statSync(target).isDirectory() || !fs.statSync(source).isDirectory())
  throw Error("RELEASE_AND_SOURCE_DIRECTORIES_REQUIRED");

const copiedFiles = [
  "client/public/website/index.html",
  "client/public/website/website.css",
  "client/public/website/website.js",
  "client/public/website/meta-privacy.html",
  "modules/web/public-website.js",
];
const index = fs.readFileSync(path.join(source, copiedFiles[0]), "utf8");
for (const asset of ["website.css", "website.js"])
  if (!index.includes("/website/" + asset + "?v=20261103-openai-ads1"))
    throw Error("OPENAI_PIXEL_CACHE_VERSION_MISMATCH");

for (const file of copiedFiles) {
  const from = path.join(source, file);
  const to = path.join(target, file);
  if (!fs.statSync(from).isFile()) throw Error("SOURCE_FILE_REQUIRED:" + file);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
  fs.chmodSync(to, 0o644);
}

const runtimeFile = path.join(
  target,
  "runtime/public-pricing-preserved/public-website.js",
);
let runtime = fs.readFileSync(runtimeFile, "utf8");
for (const marker of [
  "sendTenantStorefront",
  "publicBrandBySlug",
  "/tenant-storefront.css",
]) {
  if (!runtime.includes(marker))
    throw Error("PRODUCTION_STOREFRONT_ROUTE_MISSING:" + marker);
}
const oldCsp =
  "default-src 'self'; script-src 'self' https://connect.facebook.net; style-src 'self'; img-src 'self' data: https://www.facebook.com; connect-src 'self' https://connect.facebook.net https://www.facebook.com; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'";
const newCsp =
  "default-src 'self'; script-src 'self' https://connect.facebook.net https://bzrcdn.openai.com; style-src 'self'; img-src 'self' data: https://www.facebook.com https://bzr.openai.com; connect-src 'self' https://connect.facebook.net https://www.facebook.com https://bzr.openai.com https://bzrcdn.openai.com; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'";
if (runtime.includes(oldCsp)) {
  runtime = runtime.replace(oldCsp, newCsp);
} else if (!runtime.includes(newCsp)) {
  throw Error("PUBLIC_WEBSITE_CSP_CHANGED_REVIEW_REQUIRED");
}
fs.writeFileSync(runtimeFile, runtime);
fs.chmodSync(runtimeFile, 0o644);

const changedFiles = [
  ...copiedFiles,
  "runtime/public-pricing-preserved/public-website.js",
];
const hashes = Object.fromEntries(
  changedFiles.map((file) => [
    file,
    crypto
      .createHash("sha256")
      .update(fs.readFileSync(path.join(target, file)))
      .digest("hex"),
  ]),
);
console.log(
  JSON.stringify({
    copied: copiedFiles,
    patched: changedFiles[5],
    sha256: hashes,
  }),
);
