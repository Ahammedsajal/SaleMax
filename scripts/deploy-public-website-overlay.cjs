"use strict";
// Apply to a copy of the resolved active release. Preserve generated panels and newer production modules.
const fs = require("node:fs"),
  path = require("node:path");
const [target, source] = process.argv.slice(2);
if (!target || !source || path.resolve(target) === path.resolve(source))
  throw Error("DISTINCT_TARGET_AND_SOURCE_REQUIRED");
const modulePath = "modules/platform/mount-existing-upgrade.js";
const filename = path.join(target, modulePath);
let mount = fs.readFileSync(filename, "utf8");
const addition =
  "  require('../web/public-website').mountPublicWebsite(app,{pool,key,origin});\n";
if (!mount.includes(addition.trim())) {
  const anchor = "  app.use(tenantCrmDomains.middleware(pool));\n";
  if (mount.split(anchor).length !== 2)
    throw Error("PUBLIC_WEBSITE_MOUNT_ANCHOR_CHANGED");
  mount = mount.replace(anchor, anchor + addition);
}
fs.writeFileSync(filename, mount);
for (const file of [
  "modules/web/public-website.js",
  "modules/web/website-enquiries.js",
  "client/public/website/index.html",
  "client/public/website/website.css",
  "client/public/website/website.js",
  "database/migrations/20261220_website_enquiries.sql",
  "tests/website-enquiries.test.js",
  "tests/website-enquiries.integration.cjs",
]) {
  const destination = path.join(target, file);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(path.join(source, file), destination);
}
// Extend the maintained Pipeline formatter without reverting newer live Pipeline logic.
const pipelineFile = path.join(target, "client/public/pipeline/pipeline.js");
let pipeline = fs.readFileSync(pipelineFile, "utf8");
const anchor = "  const activitySummary = activity => {\n";
const sourcePipeline = fs.readFileSync(
  path.join(source, "client/public/pipeline/pipeline.js"),
  "utf8",
);
const websiteLine = sourcePipeline
  .split("\n")
  .find((line) =>
    line.includes("activity.details?.source === 'salemax_website'"),
  );
if (!websiteLine) throw Error("WEBSITE_ACTIVITY_SOURCE_MISSING");
if (!pipeline.includes(websiteLine)) {
  if (pipeline.split(anchor).length !== 2)
    throw Error("PIPELINE_ACTIVITY_ANCHOR_CHANGED");
  pipeline = pipeline.replace(anchor, anchor + websiteLine + "\n");
  fs.writeFileSync(pipelineFile, pipeline);
}
const pipelineHtml = path.join(target, "client/public/pipeline/index.html");
let html = fs.readFileSync(pipelineHtml, "utf8");
if (!/pipeline\.js(?:\?[^"']*)?["']/.test(html))
  throw Error("PIPELINE_CACHE_ANCHOR_CHANGED");
html = html.replace(
  /pipeline\.js(?:\?[^"']*)?(?=["'])/g,
  "pipeline.js?v=20261020-website1",
);
fs.writeFileSync(pipelineHtml, html);
console.log("Public website overlay applied. Existing panel shell retained.");
