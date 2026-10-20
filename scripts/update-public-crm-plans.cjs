"use strict";
const crypto = require("node:crypto");
const hash = (value) =>
  crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
const definitions = [
  {
    id: 26,
    title: "Monthly CRM",
    short_description:
      "Customizable CRM for your industry. Shared core: contacts, sales pipeline, unified inbox, campaigns, templates, automation, team tasks, role-based access and reports. Industry-specific workflows are scoped during setup.",
    price: 350,
    plan_duration_in_days: "30",
  },
  {
    id: 25,
    title: "Yearly CRM",
    short_description:
      "The same customizable CRM core, paid yearly. Contacts, sales pipeline, unified inbox, campaigns, templates, automation, team tasks, role-based access and reports. Industry-specific workflows are scoped during setup.",
    price: 3700,
    plan_duration_in_days: "365",
  },
];
async function update(db, { apply = false, expectedHash, saveBackup } = {}) {
  await db.beginTransaction();
  try {
    const [rows] = await db.query(
      "SELECT * FROM plan WHERE id IN (25,26) ORDER BY id FOR UPDATE",
    );
    if (rows.length !== 2 || rows.some((r) => Number(r.is_trial) !== 0))
      throw Error("EXISTING_PAID_PLANS_REQUIRED");
    const stateHash = hash(rows);
    const [customers] = await db.query(
      "SELECT id,plan,plan_expire FROM user ORDER BY id FOR UPDATE",
    );
    const assignmentsHash = hash(customers);
    if (!apply) {
      await db.rollback();
      return {
        preview: true,
        stateHash,
        plans: definitions,
        customerAssignmentsUnchanged: true,
      };
    }
    if (expectedHash !== stateHash) throw Error("STALE_CATALOGUE");
    if (typeof saveBackup !== "function") throw Error("BACKUP_REQUIRED");
    await saveBackup({ plans: rows, assignmentsHash });
    for (const plan of definitions)
      await db.query(
        "UPDATE plan SET title=?,short_description=?,price=?,price_strike=NULL,plan_duration_in_days=? WHERE id=? AND is_trial=0",
        [
          plan.title,
          plan.short_description,
          plan.price,
          plan.plan_duration_in_days,
          plan.id,
        ],
      );
    const [after] = await db.query(
      "SELECT id,plan,plan_expire FROM user ORDER BY id",
    );
    if (hash(after) !== assignmentsHash)
      throw Error("CUSTOMER_ASSIGNMENTS_CHANGED");
    await db.commit();
    return {
      applied: true,
      planIds: [26, 25],
      customerAssignmentsUnchanged: true,
      limitsAndFlagsUnchanged: true,
    };
  } catch (error) {
    await db.rollback();
    throw error;
  }
}
module.exports = { update, definitions, hash };
if (require.main === module) {
  const pool = require("../database/config").promise();
  (async () => {
    const db = await pool.getConnection();
    try {
      const backup = process.argv
        .find((a) => a.startsWith("--backup="))
        ?.slice(9);
      console.log(
        JSON.stringify(
          await update(db, {
            apply: process.argv.includes("--apply"),
            expectedHash: process.argv
              .find((a) => a.startsWith("--expected="))
              ?.slice(11),
            saveBackup: backup
              ? (data) =>
                  require("node:fs").writeFileSync(
                    backup,
                    JSON.stringify(data, null, 2),
                    { mode: 0o600, flag: "wx" },
                  )
              : undefined,
          }),
        ),
      );
    } finally {
      db.release();
      await pool.end();
    }
  })().catch((error) => {
    console.error(error.code || error.message);
    process.exitCode = 1;
  });
}
