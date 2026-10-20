"use strict";
const fs = require("node:fs"),
  path = require("node:path");
const [target] = process.argv.slice(2);
if (!target) throw Error("TARGET_REQUIRED");
for (const name of [
  "helper/pipeline/leadPipeline.js",
  "routes/pipeline.js",
  "helper/pipeline/lead-filters.js",
]) {
  const file = path.join(target, name);
  let text = fs.readFileSync(file, "utf8");
  const from = name.includes("lead-filters")
    ? "bcf.uid = ${alias}.uid AND bcf.chat_id = pcf.chat_id"
    : "bc.uid=l.uid AND bc.chat_id=pc.chat_id";
  const to = name.includes("lead-filters")
    ? "bcf.uid = ${alias}.uid COLLATE utf8mb4_unicode_ci AND bcf.chat_id = pcf.chat_id COLLATE utf8mb4_unicode_ci"
    : "bc.uid=l.uid COLLATE utf8mb4_unicode_ci AND bc.chat_id=pc.chat_id COLLATE utf8mb4_unicode_ci";
  if (text.includes(to)) continue;
  if (text.split(from).length !== 2)
    throw Error("COLLATION_QUERY_ANCHOR_CHANGED:" + name);
  fs.writeFileSync(file, text.replace(from, to));
}
const leadFile = path.join(target, "helper/pipeline/leadPipeline.js");
let lead = fs.readFileSync(leadFile, "utf8");
for (const [from, to] of [
  [
    "bc.uid=? AND bc.chat_id=pc.chat_id AND",
    "bc.uid=? AND bc.chat_id=pc.chat_id COLLATE utf8mb4_unicode_ci AND",
  ],
  [
    "o.source_id=CAST(u.id AS CHAR)",
    "CONVERT(o.source_id USING utf8mb4) COLLATE utf8mb4_bin=CONVERT(CAST(u.id AS CHAR) USING utf8mb4) COLLATE utf8mb4_bin",
  ],
]) {
  if (lead.includes(to)) continue;
  if (lead.split(from).length !== 2)
    throw Error("LEAD_DETAIL_COLLATION_ANCHOR_CHANGED");
  lead = lead.replace(from, to);
}
fs.writeFileSync(leadFile, lead);
const uiFile = path.join(target, "client/public/pipeline/pipeline.js");
let ui = fs.readFileSync(uiFile, "utf8");
for (const [from, to] of [
  [
    'id="editLeadContactName" name="contactName" value=""',
    'id="editLeadContactName" name="contactName" value="${escape(lead.relationship_name||lead.contact_name||\'\')}"',
  ],
  [
    'id="editLeadContactEmail" name="contactEmail" type="email" value=""',
    'id="editLeadContactEmail" name="contactEmail" type="email" value="${escape(lead.contact_email||\'\')}"',
  ],
]) {
  if (ui.includes(to)) continue;
  if (ui.split(from).length !== 2) throw Error("CONTACT_FIELD_ANCHOR_CHANGED");
  ui = ui.replace(from, to);
}
fs.writeFileSync(uiFile, ui);
const htmlFile = path.join(target, "client/public/pipeline/index.html");
fs.writeFileSync(
  htmlFile,
  fs
    .readFileSync(htmlFile, "utf8")
    .replace(
      /pipeline\.js(?:\?[^"']*)?(?=["'])/g,
      "pipeline.js?v=20261020-website2",
    ),
);
console.log(
  "Pipeline mixed-collation joins updated without replacing newer live modules.",
);
