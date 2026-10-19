'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {parseLeadFilters,leadFilterSql}=require('../helper/pipeline/lead-filters');

test('lead filters validate assignment and QR instance identifiers',()=>{
  assert.deepEqual(parseLeadFilters({assignment:'assigned',qrInstanceId:'17'}),{assignment:'assigned',qrInstanceId:17});
  assert.throws(()=>parseLeadFilters({assignment:'anything'}),{status:400});
  assert.throws(()=>parseLeadFilters({qrInstanceId:'17 OR 1=1'}),{status:400});
  assert.throws(()=>leadFilterSql({alias:'l; DROP TABLE pipeline_leads'}),TypeError);
});

test('QR lead filters match only conversations linked to the selected tenant instance',()=>{
  const filter=leadFilterSql({assignment:'assigned',qrInstanceId:17,alias:'lead'});
  assert.deepEqual(filter.args,[17]);
  assert.match(filter.sql,/lead\.owner_agent_id IS NOT NULL/);
  assert.match(filter.sql,/pcf\.uid_hash = lead\.uid_hash AND pcf\.lead_id = lead\.id/);
  assert.match(filter.sql,/bcf\.uid = lead\.uid AND bcf\.chat_id = pcf\.chat_id AND bcf\.origin = 'qr'/);
  assert.match(filter.sql,/qif\.id = \?/);
});
