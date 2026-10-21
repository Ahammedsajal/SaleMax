"use strict";
// Disposable database only: create an empty schema named sx_website_test and pass WEBSITE_TEST_HOST.
const assert = require("node:assert/strict"),
  crypto = require("node:crypto"),
  fs = require("node:fs"),
  path = require("node:path");
const mysql = require("mysql2/promise");
const { splitSql } = require("../database/migration-runner");
const enquiries = require("../modules/web/website-enquiries");
const hash = (value) => crypto.createHash("sha256").update(value).digest("hex");
async function main() {
  if (
    process.env.WEBSITE_TEST_DATABASE !== "sx_website_test" ||
    !process.env.WEBSITE_TEST_HOST
  )
    throw Error("DISPOSABLE_WEBSITE_DATABASE_REQUIRED");
  const pool = mysql.createPool({
    host: process.env.WEBSITE_TEST_HOST,
    port: Number(process.env.WEBSITE_TEST_PORT || 3306),
    user: "root",
    password: process.env.WEBSITE_TEST_PASSWORD || "",
    database: "sx_website_test",
    connectionLimit: 12,
    charset: "utf8mb4",
  });
  const count = async (table) =>
    Number((await pool.query(`SELECT COUNT(*) n FROM ${table}`))[0][0].n);
  try {
    assert.equal(
      (await pool.query("SHOW TABLES"))[0].length,
      0,
      "Must start with a disposable empty database",
    );
    for (const name of [
      "20260928_lead_pipeline.sql",
      "20261007_pipeline_contacts.sql",
      "20261118_pipeline_lead_qualification.sql",
      "20261220_website_enquiries.sql",
    ]) {
      for (const sql of splitSql(
        fs.readFileSync(
          path.join(__dirname, "../database/migrations", name),
          "utf8",
        ),
      ))
        await pool.query(sql);
    }
    // Minimal identity fixtures exercise the real production owner-resolution join; no customer data.
    for (const sql of [
      "CREATE TABLE user(id INT PRIMARY KEY,uid VARCHAR(100)) ENGINE=InnoDB",
      "CREATE TABLE sx_tenants(id CHAR(36) PRIMARY KEY,slug VARCHAR(100),category_key VARCHAR(60),status VARCHAR(20)) ENGINE=InnoDB",
      "CREATE TABLE sx_memberships(id CHAR(36) PRIMARY KEY,tenant_id CHAR(36),identity_id CHAR(36),role VARCHAR(20),status VARCHAR(20)) ENGINE=InnoDB",
      "CREATE TABLE sx_identities(id CHAR(36) PRIMARY KEY,status VARCHAR(20)) ENGINE=InnoDB",
      "CREATE TABLE sx_legacy_ownership(source_table VARCHAR(30),source_id VARCHAR(50),tenant_id CHAR(36),membership_id CHAR(36),legacy_uid_hash CHAR(64)) ENGINE=InnoDB",
      "CREATE TABLE contact_form(id INT AUTO_INCREMENT PRIMARY KEY,email VARCHAR(999),name VARCHAR(999),mobile VARCHAR(999),content LONGTEXT) ENGINE=InnoDB",
    ])
      await pool.query(sql);
    const tenant = crypto.randomUUID(),
      identity = crypto.randomUUID(),
      member = crypto.randomUUID(),
      uid = "synthetic-website-owner";
    await pool.query("INSERT INTO user VALUES(1,?)", [uid]);
    await pool.query(
      "INSERT INTO sx_tenants VALUES(?,?,'7network_sales','active')",
      [
        tenant,
        process.env.SALEMAX_WEBSITE_SALES_TENANT_SLUG ||
          "salemax-sales-86c35173",
      ],
    );
    await pool.query("INSERT INTO sx_identities VALUES(?,'active')", [
      identity,
    ]);
    await pool.query(
      "INSERT INTO sx_memberships VALUES(?,?,?,'owner','active')",
      [member, tenant, identity],
    );
    await pool.query(
      "INSERT INTO sx_legacy_ownership VALUES('user','1',?,?,?)",
      [tenant, member, hash(uid)],
    );
    const base = {
      name: "Synthetic Website Visitor",
      company: "Synthetic Test Business",
      mobile: "+97455550101",
      email: "synthetic@example.invalid",
      content: "Disposable test only. No external message.",
      solution: "crm",
      consent: true,
      submissionToken: crypto.randomUUID(),
    };
    const settled = await Promise.allSettled(
      Array.from({ length: 6 }, () =>
        enquiries.submit(pool, base, hash("one visitor")),
      ),
    );
    const rejected = settled.find((result) => result.status === "rejected");
    if (rejected) throw rejected.reason;
    const results = settled.map((result) => result.value);
    assert.equal(results.filter((r) => !r.repeated).length, 1);
    for (const table of [
      "contact_form",
      "pipeline_leads",
      "pipeline_contacts",
      "sx_website_enquiries",
    ])
      assert.equal(await count(table), 1, table + " exactly once");
    await pool.query(
      "CREATE TABLE agents(id INT PRIMARY KEY,owner_uid VARCHAR(999),name VARCHAR(100),email VARCHAR(100),is_active TINYINT) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",
    );
    await pool.query(
      "CREATE TABLE beta_chats(uid VARCHAR(999),chat_id VARCHAR(191),origin VARCHAR(20),origin_instance_unique_id VARCHAR(191)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE utf8mb4_unicode_ci",
    );
    await pool.query(
      "CREATE TABLE instance(id INT PRIMARY KEY,uid VARCHAR(999),uniqueId VARCHAR(191),number VARCHAR(40),title VARCHAR(100)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE utf8mb4_unicode_ci",
    );
    const pipeline = require("../helper/pipeline/leadPipeline");
    const board = await pipeline.getBoard({
      uid,
      role: "owner",
      categoryKey: "7network_sales",
      pool,
    });
    assert.equal(
      board.total,
      1,
      "website enquiry is readable through the real Pipeline board with mixed legacy collations",
    );
    const filtered = await pipeline.getBoard({
      uid,
      role: "owner",
      categoryKey: "7network_sales",
      filters: { qrInstanceId: 1 },
      pool,
    });
    assert.equal(
      filtered.total,
      0,
      "a website enquiry is not incorrectly attributed to QR",
    );
    const [[lead]] = await pool.query(
      "SELECT uid,source_type,title FROM pipeline_leads",
    );
    assert.equal(lead.uid, uid);
    assert.equal(lead.source_type, "public_form");
    assert.match(lead.title, /Synthetic Test Business/);
    await assert.rejects(
      enquiries.submit(
        pool,
        { ...base, content: "Changed request" },
        hash("one visitor"),
      ),
      { code: "SUBMISSION_CHANGED" },
    );
    // Exercise detail/activities with mixed collations; omit the unrelated Training application fixture.
    await pool.query(
      "DELETE FROM sx_legacy_ownership WHERE source_table='user' AND source_id='1'",
    );
    const detail = await pipeline.getLead(uid, board.leads[0].id, {
      role: "owner",
      pool,
    });
    assert.equal(
      detail.activities.find(
        (item) => item.details?.source === "salemax_website",
      ).details.content,
      base.content,
    );
    await pool.query(
      "INSERT INTO sx_legacy_ownership VALUES('user','1',?,?,?)",
      [tenant, member, hash(uid)],
    );
    const before = await count("contact_form");
    await assert.rejects(
      enquiries.submit(
        pool,
        { ...base, submissionToken: crypto.randomUUID() },
        hash("rollback"),
        {
          createLead: async () => {
            throw Error("forced downstream failure");
          },
        },
      ),
      /forced downstream/,
    );
    assert.equal(
      await count("contact_form"),
      before,
      "contact insert rolled back when pipeline fails",
    );
    assert.equal(
      await count("sx_website_enquiries"),
      1,
      "request row rolled back as well",
    );
    await pool.query("UPDATE sx_identities SET status='disabled'");
    await assert.rejects(
      enquiries.submit(
        pool,
        { ...base, submissionToken: crypto.randomUUID() },
        hash("inactive"),
      ),
      { code: "SALES_ROUTING_UNAVAILABLE" },
    );
    assert.equal(await count("contact_form"), before);
    await pool.query("UPDATE sx_identities SET status='active'");
    for (let i = 0; i < 8; i++)
      await enquiries.submit(
        pool,
        { ...base, submissionToken: crypto.randomUUID() },
        hash("rate limited visitor"),
      );
    await assert.rejects(
      enquiries.submit(
        pool,
        { ...base, submissionToken: crypto.randomUUID() },
        hash("rate limited visitor"),
      ),
      { code: "ENQUIRY_RATE_LIMITED" },
    );
    assert.equal(await count("contact_form"), 9);
    assert.equal(await count("pipeline_leads"), 9);
    // Arabic and HTML-like customer text remain stored data; nothing is interpreted as markup.
    const arabic = {
      ...base,
      name: "عميل تجريبي",
      content: "<script>synthetic</script> استفسار تجريبي",
      language: "ar",
      submissionToken: crypto.randomUUID(),
    };
    await enquiries.submit(pool, arabic, hash("arabic"));
    const [[saved]] = await pool.query(
      "SELECT content FROM contact_form ORDER BY id DESC LIMIT 1",
    );
    assert.match(saved.content, /استفسار تجريبي/);
    console.log(
      "PASS: real MariaDB pipeline integration, concurrent retry deduplication, payload conflict, atomic rollback, inactive-owner rejection, rate limiting and Arabic data preservation and mixed-collation Pipeline board reads.",
    );
  } finally {
    await pool.end();
  }
}
main().catch((error) => {
  console.error(error.code || error.message);
  process.exitCode = 1;
});
