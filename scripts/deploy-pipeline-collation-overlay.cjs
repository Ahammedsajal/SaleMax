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
console.log(
  "Pipeline mixed-collation joins updated without replacing newer live modules.",
);
