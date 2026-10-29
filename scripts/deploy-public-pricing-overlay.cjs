"use strict";

// Copy only reviewed public pricing assets and the protected catalogue updater
// into a release copied from the exact live release.
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

const files = [
  "client/public/website/index.html",
  "client/public/website/plan-presentation.js",
  "client/public/website/website.css",
  "client/public/website/website.js",
  "scripts/update-public-crm-plans.cjs",
  "deploy/compose.public-pricing-runtime.override.yml",
];
const html = fs.readFileSync(path.join(source, files[0]), "utf8");
for (const asset of ["website.css", "plan-presentation.js", "website.js"])
  if (!html.includes(`/website/${asset}?v=20261029-pricing-redesign6`))
    throw Error("PUBLIC_PRICING_CACHE_VERSION_MISMATCH");

for (const file of files) {
  const from = path.join(source, file);
  const to = path.join(target, file);
  if (!fs.statSync(from).isFile()) throw Error(`SOURCE_FILE_REQUIRED:${file}`);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
  fs.chmodSync(to, 0o644);
}
const result = Object.fromEntries(
  files.map((file) => [
    file,
    crypto.createHash("sha256").update(fs.readFileSync(path.join(target, file))).digest("hex"),
  ]),
);
console.log(JSON.stringify({ copied: files, sha256: result }));
