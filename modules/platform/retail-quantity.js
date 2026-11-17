'use strict';

// Inventory quantities use six fixed decimal places in storage and integer
// micro-units in JavaScript. The supported stock range (0..1,000,000,000)
// keeps scaled values within Number's safe integer range where needed, while
// BigInt arithmetic avoids floating-point rounding in stock operations.
const PRECISION = 6;
const SCALE = 1_000_000n;
const MAX = 1_000_000_000n * SCALE;
const UNIT = 10n ** BigInt(PRECISION);

function scaled(value) {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value < 0) return null;
    return BigInt(value) * UNIT;
  }
  if (typeof value !== 'string') return null;
  const input = value.trim();
  const match = /^(0|[1-9]\d{0,9})(?:\.(\d{1,6}))?$/.exec(input);
  if (!match) return null;
  const fraction = (match[2] || '').padEnd(PRECISION, '0');
  const result = BigInt(match[1]) * UNIT + BigInt(fraction || '0');
  return result <= MAX ? result : null;
}

function isMultiple(value, increment) {
  const amount = typeof value === 'bigint' ? value : scaled(value);
  const step = typeof increment === 'bigint' ? increment : scaled(increment);
  return amount !== null && step !== null && step > 0n && amount % step === 0n;
}

function atPrecision(value, precision) {
  const amount = typeof value === 'bigint' ? value : scaled(value);
  if (amount === null || !Number.isInteger(precision) || precision < 0 || precision > PRECISION) return false;
  return amount % (10n ** BigInt(PRECISION - precision)) === 0n;
}

function fixed(value) {
  const amount = typeof value === 'bigint' ? value : scaled(value);
  if (amount === null || amount < 0n || amount > MAX) return null;
  const whole = amount / UNIT;
  const fraction = (amount % UNIT).toString().padStart(PRECISION, '0');
  return `${whole}.${fraction}`;
}

function format(value, precision = PRECISION) {
  const amount = typeof value === 'bigint' ? value : scaled(value);
  if (amount === null || !Number.isInteger(precision) || precision < 0 || precision > PRECISION || !atPrecision(amount,precision)) return null;
  const whole = amount / UNIT;
  const fraction = (amount % UNIT).toString().padStart(PRECISION, '0').slice(0, precision).replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

function json(value, precision = PRECISION) {
  const result = format(value, precision);
  if (result === null) return null;
  if (!result.includes('.')) return Number(result);
  return result;
}

function add(left, right) {
  const a = typeof left === 'bigint' ? left : scaled(left);
  const b = typeof right === 'bigint' ? right : scaled(right);
  if (a === null || b === null || a + b > MAX) return null;
  return a + b;
}

function subtract(left, right) {
  const a = typeof left === 'bigint' ? left : scaled(left);
  const b = typeof right === 'bigint' ? right : scaled(right);
  if (a === null || b === null || a < b) return null;
  return a - b;
}

function signed(value) {
  if (typeof value === 'number') return Number.isSafeInteger(value) ? BigInt(value) * UNIT : null;
  if (typeof value !== 'string') return null;
  const input = value.trim();
  const negative = input.startsWith('-');
  const amount = scaled(negative ? input.slice(1) : input);
  return amount === null ? null : negative ? -amount : amount;
}

function minorTotal(priceMinor, quantity) {
  if (!Number.isSafeInteger(Number(priceMinor)) || Number(priceMinor) < 0) return null;
  const amount = typeof quantity === 'bigint' ? quantity : scaled(quantity);
  if (amount === null || amount < 0n) return null;
  const numerator = BigInt(priceMinor) * amount;
  const rounded = (numerator + UNIT / 2n) / UNIT;
  return rounded <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(rounded) : null;
}

function precisionOf(value, precision) {
  const amount = typeof value === 'bigint' ? value : scaled(value);
  return amount !== null && atPrecision(amount, precision);
}

module.exports = {PRECISION, SCALE, UNIT, MAX, scaled, signed, fixed, format, json, add, subtract,
  isMultiple, atPrecision, precisionOf, minorTotal};
