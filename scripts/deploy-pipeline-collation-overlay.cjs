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
console.log(
  "Pipeline mixed-collation joins updated without replacing newer live modules.",
);
