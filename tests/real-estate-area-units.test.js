'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const units=require('../client/public/property-listings/area-units');

test('property area conversions keep the API value canonical in square metres',()=>{
  assert.equal(units.toSquareMetres(100,'sqft'),9.29);
  assert.equal(units.toSquareMetres(100,'sqm'),100);
  assert.equal(units.fromSquareMetres(9.29,'sqft'),100);
  assert.equal(units.maxInputValue(100,'sqft'),1076.3910416709722);
  assert.equal(units.unit('unexpected'),'sqm');
  assert.equal(units.toSquareMetres('', 'sqft'),null);
  assert.equal(units.toSquareMetres(Infinity,'sqm'),null);
});

test('property area display follows the tenant-selected unit and language',()=>{
  assert.equal(units.format(100,'sqft','en'),'1,076.39');
  assert.equal(units.format(100,'sqm','en'),'100');
  assert.match(units.format(100,'sqft','ar'),/[٠-٩]/);
});
