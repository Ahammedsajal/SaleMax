'use strict';

const MAX_API_LOG_DELETE_IDS = 200;
const MAX_API_LOG_ID = 2147483647;

function normalizeApiLogIds(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_API_LOG_DELETE_IDS) return null;
  const normalized = [];
  for (const id of value) {
    if (typeof id !== 'number' && typeof id !== 'string') return null;
    if (typeof id === 'string' && !/^\d{1,10}$/.test(id.trim())) return null;
    const number = Number(id);
    if (!Number.isSafeInteger(number) || number < 1 || number > MAX_API_LOG_ID) return null;
    normalized.push(number);
  }
  return [...new Set(normalized)];
}

module.exports = { MAX_API_LOG_DELETE_IDS, normalizeApiLogIds };
