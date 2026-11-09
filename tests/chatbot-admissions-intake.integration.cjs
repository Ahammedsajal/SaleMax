'use strict';

const assert = require('node:assert/strict');
const { createHash, randomUUID } = require('node:crypto');
const { captureLead, markAsked } = require('../modules/platform/chatbot-lead-capture');

module.exports = async function admissionsIntakeIntegration(db, pool, { t1, t2 }) {
  const pipeline = require('../helper/pipeline/leadPipeline');
  const originalCapture = pipeline.captureBotInbound;
  const env = 'SALEMAX_CHATBOT_ADMISSIONS_INTAKE_TENANT_ID';
  const previous = process.env[env];
  process.env[env] = t1;
  const phone = '97455550002';
  const normalizedPhone = pipeline.normalizePhone(phone);
  const uid = 'synthetic-admissions-owner';
  const uidHash = createHash('sha256').update(uid).digest('hex');
  const leadId = randomUUID(), contactId = randomUUID();
  const otherUid = 'synthetic-other-owner';
  const otherHash = createHash('sha256').update(otherUid).digest('hex');
  const facts = [];
  const profile = { id: randomUUID(), config: { allowedRecipientPhones: [phone] }, channelKind: 'whatsapp_qr', channelRef: 'synthetic-intake-qr' };
  const turn = (text, metaChatId = randomUUID(), tenantId = t1, senderMobile = phone) => captureLead(pool, {
    ctx: { tenant: { id: tenantId, categoryKey: 'training_center' } }, profile, uid, chatId: 'synthetic-intake-chat', origin: 'qr', facts,
    message: { senderMobile, metaChatId, msgContext: { text: { body: text } } },
  });
  try {
    pipeline.captureBotInbound = async () => ({ leadId });
    await db.query(`INSERT INTO pipeline_contacts(id,uid_hash,uid,display_name,normalized_phone)
      VALUES (?,?,?,?,?),(?,?,?,?,?),(?,?,?,?,?)`,
    [contactId, uidHash, uid, 'WhatsApp Display', normalizedPhone, randomUUID(), uidHash, uid, 'Nora Example', normalizedPhone,
      randomUUID(), otherHash, otherUid, 'Unrelated Tenant', normalizedPhone]);
    await db.query(`INSERT INTO pipeline_leads(id,uid_hash,uid,contact_id,identity_key,title,learner_name,qualification_data)
      VALUES (?,?,?,?,?,'Synthetic enquiry','WhatsApp Display',JSON_OBJECT('preferredStartWindow','within_month'))`,
    [leadId, uidHash, uid, contactId, 'f'.repeat(64)]);

    assert.equal(await turn('hello', randomUUID(), t1, '97455550003'), null);
    assert.equal((await turn('hello', randomUUID(), t2)).intake, null);
    const first = await turn('I want to know about marine course');
    assert.equal(first.courseInterest, 'marine course');
    assert.equal(first.intake.prompt, 'Is your name Nora?');
    await markAsked(pool, first, uid);
    const accepted = await turn('Yes');
    assert.equal(accepted.intake.name, 'Nora Example');
    assert.equal(accepted.intake.prompt, 'Is your preferred start still within a month?');
    await markAsked(pool, accepted, uid);
    const newDate = randomUUID();
    const completed = await turn('Next week', newDate);
    assert.equal(completed.intake.key, undefined);
    assert.equal(completed.intake.preferredStart, 'Next week');
    await turn('Flexible', newDate);
    const [[row]] = await db.query('SELECT learner_name,qualification_data FROM pipeline_leads WHERE id=?', [leadId]);
    const qualification = typeof row.qualification_data === 'string' ? JSON.parse(row.qualification_data) : row.qualification_data;
    assert.equal(row.learner_name, 'Nora Example');
    assert.equal(qualification.preferredStartWindow, 'within_month');
    assert.equal(qualification.preferredStartDetail, 'Next week');
    assert.equal(qualification.botCapture.admissions.confirmNameAsked, 1);
    assert.equal(qualification.botCapture.admissions.confirmStartAsked, 1);
    return { admissionsNumberLookup: true, admissionsConfirmAndSave: true, admissionsDuplicateProtection: true };
  } finally {
    pipeline.captureBotInbound = originalCapture;
    if (previous === undefined) delete process.env[env];
    else process.env[env] = previous;
  }
};
