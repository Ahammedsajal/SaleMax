'use strict';

function clean(value) {
  return value == null ? '' : String(value).trim();
}

function normalizeHeader(header) {
  return String(header || '').replace(/^\uFEFF/, '');
}

function normalizeImportRows(rows) {
  if (!Array.isArray(rows) || !rows.length) {
    throw Object.assign(new Error('INVALID_CONTACT_IMPORT'), { code: 'INVALID_CONTACT_IMPORT' });
  }
  return rows.map((row, index) => {
    const name = clean(row.name);
    const mobile = clean(row.mobile);
    const variables = [row.var1, row.var2, row.var3, row.var4, row.var5].map(clean);
    // Category and country alone do not make an email/social-only row useful.
    if (!name || (!mobile && !variables.slice(2).some(Boolean))) {
      throw Object.assign(new Error('INVALID_CONTACT_IMPORT_ROW'), {
        code: 'INVALID_CONTACT_IMPORT_ROW', row: index + 2,
      });
    }
    if ([name, mobile, ...variables].some(value => value.length > 999)) {
      throw Object.assign(new Error('CONTACT_FIELD_TOO_LONG'), {
        code: 'CONTACT_FIELD_TOO_LONG', row: index + 2,
      });
    }
    return [name, mobile || null, ...variables];
  });
}

function sendableContacts(contacts) {
  return (Array.isArray(contacts) ? contacts : [])
    .filter(contact => clean(contact?.mobile).length > 0);
}

module.exports = { normalizeHeader, normalizeImportRows, sendableContacts };
