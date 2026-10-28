'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const {scopeFor}=require('../modules/platform/policy');
const agents=require('../modules/platform/real-estate-agents');
test('custom roles cannot grant staff authority to alter agent profiles or commission rules',()=>{
  for(const role of ['manager','team_leader','agent'])for(const permission of ['realestate.agent_profiles.manage','realestate.commissions.manage']){
    assert.equal(scopeFor({role,customPermissions:[permission],delegatedPermissions:[]},permission),null);
  }
});
test('commission reads remain restricted to the role scope',()=>{
  for(const [role,scope] of [['owner','tenant'],['manager','team'],['team_leader','team'],['agent','own']]){
    assert.equal(scopeFor({role,customPermissions:null,delegatedPermissions:[]},'realestate.commissions.read'),scope);
  }
});
test('public profile returns only opted-in fields and a clearly defined activity count',async()=>{
  const plans=require('../modules/platform/plans'),original=plans.loadEntitlements;plans.loadEntitlements=async()=>({status:'active',capabilities:['realestate.listings']});
  let lookups=0;const pool={async getConnection(){return{async query(sql){if(sql.startsWith('DELETE FROM sx_real_estate_public_profile_rate_limits'))return[[],[]];if(sql.startsWith('INSERT INTO sx_real_estate_public_profile_rate_limits'))return[[],[]];if(sql.startsWith('SELECT attempts'))return[[{attempts:1}],[]];if(sql.startsWith('SELECT t.id AS tenantId')){lookups++;return[[{tenantId:'tenant',businessName:'Synthetic office',name:'Synthetic agent',workingAreas:'["Lusail"]',languages:'["English"]',seniority:'senior',bioEn:'Public bio',bioAr:''}],[]];}if(sql.startsWith('SELECT COUNT(*)'))return[[{total:3}],[]];throw Error('Unexpected SQL: '+sql);},release(){}};}};
  const express=require('express'),app=express();app.use('/api/public/agents',agents.publicProfileRouter({pool,key:crypto.randomBytes(32)}));const server=app.listen(0,'127.0.0.1');
  try{await new Promise(resolve=>server.once('listening',resolve));const response=await fetch(`http://127.0.0.1:${server.address().port}/api/public/agents/synthetic-office/123e4567-e89b-42d3-a456-426614174000`),payload=await response.json();assert.equal(response.status,200,JSON.stringify(payload));assert.deepEqual(Object.keys(payload.data).sort(),['activeListingCount','bioAr','bioEn','businessName','languages','name','seniority','workingAreas'].sort());assert.equal(payload.data.activeListingCount,3);assert.equal(response.headers.get('cache-control'),'no-store, max-age=0');assert.equal(response.headers.get('referrer-policy'),'no-referrer');assert.equal(lookups,1);}finally{await new Promise(resolve=>server.close(resolve));plans.loadEntitlements=original;}
});
