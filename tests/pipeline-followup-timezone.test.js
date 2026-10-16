'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const dateTime = require('../client/public/pipeline/timezone-datetime');

test('follow-up dates display in the business timezone', () => {
  const instant = '2026-10-14 03:30:00.000000';
  assert.equal(dateTime.toInput(instant, 'Asia/Kolkata'), '2026-10-14T09:00');
  assert.equal(dateTime.toInput(instant, 'Asia/Qatar'), '2026-10-14T06:30');
  assert.match(dateTime.format(instant, 'Asia/Kolkata', 'en-GB'), /9:00/);
});

test('rescheduling converts India and Qatar wall times to their correct UTC instants', () => {
  assert.equal(dateTime.fromInput('2026-10-14T09:00', 'Asia/Kolkata'), '2026-10-14T03:30:00.000Z');
  assert.equal(dateTime.fromInput('2026-10-14T09:00', 'Asia/Qatar'), '2026-10-14T06:00:00.000Z');
});

test('invalid local date values and unknown timezones fail closed', () => {
  assert.throws(() => dateTime.fromInput('2026-13-40T29:70', 'Asia/Kolkata'), RangeError);
  assert.throws(() => dateTime.fromInput('2026-10-14T09:00', 'Not/A-Timezone'), RangeError);
});

test('pipeline follow-up UI uses API timezone and loads the conversion helper first', () => {
  const index = fs.readFileSync(path.join(__dirname, '../client/public/pipeline/index.html'), 'utf8');
  const reports = fs.readFileSync(path.join(__dirname, '../client/public/pipeline/reports.js'), 'utf8');
  const helper = index.indexOf('/pipeline/timezone-datetime.js?v=20261014-followup-timezone1');
  const client = index.indexOf('/pipeline/reports.js?v=20261016-system-qatar-time1');
  assert.ok(helper >= 0 && client > helper);
  assert.match(reports, /state\.taskTimezone=body\.data\.timezone\|\|'Asia\/Qatar'/);
  assert.match(reports, /SaleMaXDateTime\.fromInput\(value,state\.taskTimezone\)/);
  assert.match(reports, /SaleMaXDateTime\.toInput\(value,state\.taskTimezone\)/);
});
