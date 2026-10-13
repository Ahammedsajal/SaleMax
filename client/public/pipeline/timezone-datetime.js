(function attachSaleMaXDateTime(global) {
  'use strict';

  function asInstant(value) {
    if (value instanceof Date) return new Date(value.getTime());
    const text = String(value || '').trim();
    if (!text) return new Date(NaN);
    const normalized = text.includes('T') ? text : text.replace(' ', 'T');
    return new Date(/(?:[zZ]|[+-]\d{2}:?\d{2})$/.test(normalized) ? normalized : `${normalized}Z`);
  }

  function zonedParts(instant, timeZone) {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
    });
    return Object.fromEntries(formatter.formatToParts(instant).map(part => [part.type, part.value]));
  }

  function format(value, timeZone, locale = 'en') {
    const instant = asInstant(value);
    if (!Number.isFinite(instant.getTime())) return '—';
    return new Intl.DateTimeFormat(locale, { timeZone, dateStyle: 'medium', timeStyle: 'short' }).format(instant);
  }

  function toInput(value, timeZone) {
    const instant = asInstant(value);
    if (!Number.isFinite(instant.getTime())) return '';
    const parts = zonedParts(instant, timeZone);
    return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
  }

  function fromInput(value, timeZone) {
    const match = String(value || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
    if (!match) throw new RangeError('Choose a valid local date and time.');
    const target = match.slice(1).map(Number);
    const [year, month, day, hour, minute] = target;
    const expectedUtc = Date.UTC(year, month - 1, day, hour, minute, 0);
    const normalized = new Date(expectedUtc);
    if (normalized.getUTCFullYear() !== year || normalized.getUTCMonth() + 1 !== month
      || normalized.getUTCDate() !== day || normalized.getUTCHours() !== hour
      || normalized.getUTCMinutes() !== minute) {
      throw new RangeError('Choose a valid local date and time.');
    }
    let candidate = expectedUtc;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const parts = zonedParts(new Date(candidate), timeZone);
      const actualUtc = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
      const delta = expectedUtc - actualUtc;
      if (delta === 0) return new Date(candidate).toISOString();
      candidate += delta;
    }
    throw new RangeError('That local time does not exist in the selected timezone.');
  }

  const api = Object.freeze({ format, toInput, fromInput });
  global.SaleMaXDateTime = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
