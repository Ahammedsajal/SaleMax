'use strict';

function parseLeadFilters(input = {}) {
  const assignment = String(input.assignment || '').trim();
  if (assignment && !['assigned', 'unassigned'].includes(assignment)) {
    const error = new Error('Choose assigned or unassigned leads.'); error.status = 400; throw error;
  }
  const rawInstance = input.qrInstanceId;
  const qrInstanceId = rawInstance === undefined || rawInstance === null || rawInstance === '' ? null : Number(rawInstance);
  if (qrInstanceId !== null && (!Number.isSafeInteger(qrInstanceId) || qrInstanceId < 1)) {
    const error = new Error('Choose a valid QR WhatsApp number.'); error.status = 400; throw error;
  }
  return { assignment, qrInstanceId };
}

function leadFilterSql({ assignment = '', qrInstanceId = null, alias = 'l' } = {}) {
  if (!/^[a-z][a-z0-9_]*$/i.test(alias)) throw new TypeError('Invalid SQL alias');
  const clauses = [];
  const args = [];
  if (assignment === 'assigned') clauses.push(`${alias}.owner_agent_id IS NOT NULL`);
  if (assignment === 'unassigned') clauses.push(`${alias}.owner_agent_id IS NULL`);
  if (qrInstanceId !== null && qrInstanceId !== undefined) {
    clauses.push(`EXISTS (
      SELECT 1 FROM pipeline_conversations pcf
      JOIN beta_chats bcf ON bcf.uid = ${alias}.uid AND bcf.chat_id = pcf.chat_id AND bcf.origin = 'qr'
      JOIN instance qif ON qif.uid = bcf.uid AND qif.uniqueId = bcf.origin_instance_unique_id
      WHERE pcf.uid_hash = ${alias}.uid_hash AND pcf.lead_id = ${alias}.id AND qif.id = ?
    )`);
    args.push(qrInstanceId);
  }
  return { sql: clauses.length ? ` AND ${clauses.join(' AND ')}` : '', args };
}

module.exports = { parseLeadFilters, leadFilterSql };
