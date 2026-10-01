'use strict';

// Compatibility boundary for the existing catalogue. Canonical version adoption
// remains a separate, reviewed migration; these handlers preserve legacy IDs.
const columns = ['title', 'short_description', 'allow_tag', 'allow_note', 'allow_chatbot',
  'contact_limit', 'allow_api', 'is_trial', 'price', 'price_strike',
  'plan_duration_in_days', 'qr_account', 'wa_warmer', 'rest_api_qr'];
const flags = ['allow_tag', 'allow_note', 'allow_chatbot', 'allow_api', 'is_trial', 'wa_warmer', 'rest_api_qr'];
function normalize(body, edit = false) {
  const errors = {};
  const result = {};
  const fail = (field, message) => { errors[field] = message; };
  if (!body || typeof body !== 'object' || Array.isArray(body)) body = {};
  for (const [field, maximum] of [['title', 999], ['short_description', 10000]]) {
    const value = typeof body[field] === 'string' ? body[field].trim() : '';
    if (!value || value.length > maximum) fail(field, `Enter between 1 and ${maximum} characters.`);
    result[field] = value;
  }
  const integer = (field, minimum, optional = false) => {
    const raw = body[field];
    const value = optional && (raw === undefined || raw === null || raw === '') ? 0 :
      (typeof raw === 'number' || (typeof raw === 'string' && /^\d+$/.test(raw.trim()))) ? Number(raw) : NaN;
    if (!Number.isSafeInteger(value) || value < minimum || value > 2147483647)
      fail(field, `Enter a whole number from ${minimum} to 2147483647.`);
    result[field] = value;
  };
  if (edit) integer('id', 1);
  integer('plan_duration_in_days', 1);
  integer('contact_limit', 0, true);
  integer('qr_account', 0, true);
  for (const field of flags) {
    const raw = body[field];
    if (raw === true || raw === 1 || raw === '1') result[field] = 1;
    else if (raw === false || raw === 0 || raw === '0' || raw == null) result[field] = 0;
    else fail(field, 'Choose an enabled or disabled setting.');
  }
  for (const field of ['price', 'price_strike']) {
    const raw = body[field];
    if (raw == null || raw === '') { result[field] = field === 'price' ? 0 : null; continue; }
    const text = String(raw);
    if (!['number', 'string'].includes(typeof raw) || !/^\d+(?:\.\d{1,2})?$/.test(text) || Number(raw) > 99999999.99)
      fail(field, 'Enter a nonnegative price with up to two decimal places.');
    result[field] = Number(raw);
    // The preserved catalogue stores price as BIGINT. Reject rather than let
    // MariaDB round fractional amounts before the reviewed money migration.
    if (field === 'price' && !Number.isInteger(result[field]) && !result.is_trial)
      fail(field, 'This catalogue currently supports whole-unit prices only.');
  }
  if (result.is_trial) result.price = 0;
  return { value: result, errors };
}
function createHandlers(query, reportError = () => {}) {
  const save = edit => async (req, res) => {
    const { value, errors } = normalize(req.body, edit);
    if (Object.keys(errors).length) return res.json({ success: false, code: 'INVALID_PLAN', msg: 'Please correct the highlighted plan details.', errors });
    try {
      const values = columns.map(column => value[column]);
      if (edit) {
        const existing = await query('SELECT id FROM plan WHERE id = ?', [value.id]);
        if (!existing.length) return res.json({ success: false, code: 'PLAN_NOT_FOUND', msg: 'Plan not found. Refresh the catalogue and try again.' });
        await query(`UPDATE plan SET ${columns.map(column => `${column} = ?`).join(', ')} WHERE id = ?`, [...values, value.id]);
      } else {
        await query(`INSERT INTO plan (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(',')})`, values);
      }
      return res.json({ success: true, msg: edit ? 'Plan updated successfully' : 'Plan created successfully' });
    } catch (error) {
      reportError(error);
      return res.json({ success: false, code: 'PLAN_SAVE_FAILED', msg: 'Could not save this plan. Please try again.' });
    }
  };
  return { add: save(false), edit: save(true) };
}
module.exports = { normalize, createHandlers, columns };
