'use strict';

const MAX_ROWS = 300;
const MAX_BYTES = 2 * 1024 * 1024;

function cell(value) {
  let text = value == null ? '' : String(value);
  if (/^[\s\u0000-\u001f]*[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

function customFields(qualificationData) {
  let data = qualificationData;
  if (typeof data === 'string') {
    try { data = JSON.parse(data); } catch { data = {}; }
  }
  const values = data && typeof data === 'object' && !Array.isArray(data) && data.customFields && typeof data.customFields === 'object'
    ? data.customFields : {};
  return Object.fromEntries(Object.entries(values).map(([key, item]) => [key, {
    value: item && Object.hasOwn(item, 'value') ? item.value : null,
    definition: item?.definition || null,
    configurationRevision: Number.isSafeInteger(Number(item?.configurationRevision)) ? Number(item.configurationRevision) : null,
  }]));
}

function toCsv(leads) {
  if (!Array.isArray(leads) || leads.length > MAX_ROWS) throw Object.assign(new Error('EXPORT_ROW_LIMIT'), { code: 'EXPORT_ROW_LIMIT', status: 413 });
  const headers = ['lead_id', 'title', 'contact_name', 'phone', 'stage', 'status', 'priority', 'assigned_agent', 'expected_value', 'currency', 'next_follow_up_at', 'created_at', 'custom_fields'];
  const rows = [headers.map(cell).join(',')];
  for (const lead of leads) {
    rows.push([
      lead.id, lead.title, lead.contact_name, lead.mobile, lead.stage_key, lead.status, lead.priority,
      lead.owner_name, lead.expected_value, lead.currency, lead.next_follow_up_at, lead.created_at,
      JSON.stringify(customFields(lead.qualification_data)),
    ].map(cell).join(','));
  }
  const csv = `\uFEFF${rows.join('\r\n')}\r\n`;
  if (Buffer.byteLength(csv, 'utf8') > MAX_BYTES) throw Object.assign(new Error('EXPORT_TOO_LARGE'), { code: 'EXPORT_TOO_LARGE', status: 413 });
  return csv;
}

module.exports = { MAX_ROWS, MAX_BYTES, customFields, toCsv };
