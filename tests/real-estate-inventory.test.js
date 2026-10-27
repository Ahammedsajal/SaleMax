'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const inventory = require('../modules/platform/real-estate-inventory');
const category = require('../modules/platform/categories');
const tenantId = '11111111-1111-4111-8111-111111111111';
const unitId = '44444444-4444-4444-8444-444444444444';
const base = { audience: 'tenant', tenant: { id: tenantId, status: 'active', categoryKey: 'real_estate', categoryVersion: 1 }, membership: { id: '33333333-3333-4333-8333-333333333333', tenantId, role: 'owner', status: 'active' }, category: category.realEstate, subscription: { status: 'active', categoryKey: 'real_estate', categoryVersion: 1, capabilities: ['realestate.listings'] }, identity: { id: '22222222-2222-4222-8222-222222222222' } };

test('minimal unit and rental offer validate without requiring unnecessary details', () => {
  assert.deepEqual(inventory.validateUnit({ name: 'Unit 101', propertyType: 'apartment' }), { name: 'Unit 101', propertyType: 'apartment', area: '', bedrooms: null, buildingId: null });
  assert.deepEqual(inventory.validateListing({ unitId, priceMinor: 600000, minimumTermMonths: 12 }), { unitId, priceMinor: 600000, minimumTermMonths: 12 });
  assert.throws(() => inventory.validateListing({ unitId, priceMinor: 600000, minimumTermMonths: 0 }), { code: 'INVALID_LISTING_TERM' });
  assert.throws(() => inventory.validateUnit({ name: 'x', propertyType: 'apartment', tenantId }), { code: 'INVALID_UNIT' });
});

test('optional unit details validate bounded values and real dates', () => {
  const result=inventory.validateDetails({expectedRevision:1,name:' Villa ',furnishing:'furnished',areaSqm:125.5,amenities:['Pool','Balcony'],availableFrom:'2026-11-30'});
  assert.equal(result.name,'Villa');assert.equal(result.amenities,JSON.stringify(['Pool','Balcony']));
  assert.throws(()=>inventory.validateDetails({expectedRevision:1,availableFrom:'2026-02-30'}),{code:'INVALID_UNIT'});
  assert.throws(()=>inventory.validateDetails({expectedRevision:1,latitude:91}),{code:'INVALID_UNIT'});
  assert.throws(()=>inventory.validateDetails({expectedRevision:1,tenantId}),{code:'INVALID_UNIT_UPDATE'});
});

test('agent unit detail query omits owner and private address fields', async () => {
  const agent={...base,membership:{...base.membership,role:'agent'}};let sqlSeen,argsSeen;
  const db={query:async(sql,args)=>{sqlSeen=sql;argsSeen=args;return [[{id:unitId,amenities:'[]'}]];}};
  await inventory.getUnit(db,agent,unitId);
  assert.doesNotMatch(sqlSeen,/private_address|owner_name|managing_company/);
  assert.match(sqlSeen,/p\.assigned_membership_id=\?/);assert.equal(argsSeen[0],tenantId);
});

test('stale unit edits cannot overwrite a newer revision', async () => {
  let rolledBack=false,updates=0;
  const db={beginTransaction:async()=>{},commit:async()=>{},rollback:async()=>{rolledBack=true;},query:async(sql)=>{if(sql.startsWith('SELECT revision'))return [[{revision:3}]];updates++;return [{affectedRows:1}];}};
  await assert.rejects(inventory.updateUnit(db,base,unitId,{expectedRevision:2,name:'Changed'}),{code:'STALE_REVISION'});
  assert.equal(rolledBack,true);assert.equal(updates,0);
});

test('creating an offer locks its tenant-scoped unit and uses the unit details', async () => {
  const calls = [], events = [];
  const db = { beginTransaction: async () => events.push('begin'), commit: async () => events.push('commit'), rollback: async () => events.push('rollback'), query: async (sql, args) => {
    calls.push({ sql, args });
    assert.equal((sql.match(/\?/g) || []).length, args.length);
    if (sql.startsWith('SELECT id,name')) return [[{ id: unitId, name: 'Unit 101', propertyType: 'apartment', area: 'Doha', bedrooms: 2, bathrooms: 1, areaSqm: 100, availability: 'available' }]];
    return [{ affectedRows: 1 }];
  } };
  const result = await inventory.createListing(db, base, { unitId, priceMinor: 600000, minimumTermMonths: 12 });
  assert.equal(result.status, 'draft');
  assert.match(calls[0].sql, /tenant_id=\? AND id=\? FOR UPDATE/);
  assert.deepEqual(calls[0].args, [tenantId, unitId]);
  assert.ok(calls[1].args.includes(12));
  assert.ok(calls[1].args.includes('Unit 101'));
  assert.deepEqual(events, ['begin', 'commit']);
});

test('unavailable units cannot acquire a new offer and rollback', async () => {
  const events = [];
  const db = { beginTransaction: async () => events.push('begin'), commit: async () => events.push('commit'), rollback: async () => events.push('rollback'), query: async () => [[{ availability: 'rented' }]] };
  await assert.rejects(inventory.createListing(db, base, { unitId, priceMinor: 1 }), { code: 'UNIT_NOT_AVAILABLE' });
  assert.deepEqual(events, ['begin', 'rollback']);
});

test('unit rental transitions linked active and reserved listings within its transaction', async () => {
  const calls = [];
  const db = { beginTransaction: async () => {}, commit: async () => {}, rollback: async () => {}, query: async (sql, args) => {
    calls.push({ sql, args });
    assert.equal((sql.match(/\?/g) || []).length, args.length);
    if (sql.startsWith('SELECT availability')) return [[{ availability: 'available', revision: 2 }]];
    if (sql.startsWith('SELECT id,status')) return [[{ id: 'active-listing', status: 'active', transactionType:'rent' }, { id: 'reserved-listing', status: 'reserved', transactionType:'rent' }, { id:'sale-listing', status:'active', transactionType:'sale' }, { id: 'paused-listing', status: 'paused', transactionType:'rent' }]];
    return [{ affectedRows: 1 }];
  } };
  await inventory.setAvailability(db, base, unitId, { availability: 'rented', expectedRevision: 2 });
  const listingUpdates = calls.filter(call => call.sql.startsWith('UPDATE sx_real_estate_properties'));
  assert.equal(listingUpdates.length, 3);
  assert.equal(listingUpdates.filter(call=>call.args[0]==='rented').length,2);
  assert.equal(listingUpdates.find(call=>call.args.at(-1)==='sale-listing').args[0],'paused');
  assert.ok(listingUpdates.every(call => call.args[2] === tenantId));
  assert.match(calls[0].sql, /FOR UPDATE/);
  assert.match(calls[1].sql, /FOR UPDATE/);
});

test('agents cannot use management endpoints even with a forged custom grant', async () => {
  const agent = { ...base, membership: { ...base.membership, role: 'agent', customPermissions: ['properties.manage'] } };
  await assert.rejects(inventory.createUnit({}, agent, { name: 'Unit', propertyType: 'apartment' }), { code: 'PERMISSION_DENIED' });
});
