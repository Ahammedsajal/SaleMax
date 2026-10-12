'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

test('staff registration capture uses translated Qatar city labels and stable English values', () => {
  const api = {
    definitions: [],
    valuesFromForm: () => ({}),
    formPayload: () => ({ schema: { fields: [] } }),
  };
  const context = { window: { SXTrainingRegistration: api }, Intl, URL };
  const controlsSource = fs.readFileSync(path.join(__dirname, '../client/public/training-registration-controls.js'), 'utf8');
  const publicTemplate = fs.readFileSync(path.join(__dirname, '../client/public/training-form.html'), 'utf8');
  vm.runInNewContext(controlsSource, context);

  const arabic = api.capture({ consentTextAr: 'أوافق' }, 'ar', true, {}, { courses: [], staff: [] });
  const english = api.capture({ consentTextEn: 'I agree' }, 'en', true, {}, { courses: [], staff: [] });

  assert.match(arabic, /<option value="Doha">الدوحة<\/option>/);
  assert.match(arabic, /<option value="Al Rayyan">الريان<\/option>/);
  assert.match(arabic, /<option value="Other">أخرى<\/option>/);
  assert.match(english, /<option value="Doha">Doha<\/option>/);
  assert.match(english, /<option value="Al Rayyan">Al Rayyan<\/option>/);
  assert.match(controlsSource, /control\.disabled=!enabled/);
  assert.match(controlsSource, /No active batches are available/);
  assert.match(controlsSource, /Choose a course first/);
  assert.match(publicTemplate, /training-registration-controls\.js\?v=20261012-nationality-search1/);
});
