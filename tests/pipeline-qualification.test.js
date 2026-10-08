'use strict';

const assert=require('node:assert/strict');
const test=require('node:test');
const leadPipeline=require('../helper/pipeline/leadPipeline');

function fixturePool(){
  const state={queries:[],leadInsert:null,committed:false,rolledBack:false};
  const connection={
    async beginTransaction(){},
    async commit(){state.committed=true;},
    async rollback(){state.rolledBack=true;},
    release(){},
    async query(sql,params=[]){
      state.queries.push({sql,params});
      if(sql.includes('SELECT * FROM pipeline_settings'))return [[{}],[]];
      if(sql.includes('SELECT stage_key, position, stage_type FROM pipeline_stages'))return [[{stage_key:'new',position:10,stage_type:'open'}],[]];
      if(sql.includes('SELECT id FROM agents WHERE id = ?'))return [[{id:7}],[]];
      if(sql.includes('SELECT name FROM agents WHERE id = ?'))return [[{name:'Synthetic agent'}],[]];
      if(sql.includes('INSERT INTO pipeline_leads'))state.leadInsert={sql,params};
      return [{affectedRows:1},[]];
    },
  };
  return {state,pool:{async getConnection(){return connection;}}};
}

const qualification={
  courseInterest:'Excel and bookkeeping',enquiryPurpose:'course',preferredContactMethod:'whatsapp',
  preferredContactTime:'evening',preferredStartWindow:'within_month',preferredSchedule:'Weekday evenings',
  learningGoal:'Prepare monthly accounts',experienceLevel:'beginner',payerRelationship:'employer',
  payerName:'Synthetic Training Ltd',referralSource:'Partner referral',followUpUrgency:'this_week',
  campaign:{utmSource:'partner',utmCampaign:'synthetic-pipeline',landingPage:'https://crm.example.invalid/courses'},
};

test('manual lead creation persists validated qualification and campaign details',async()=>{
  const {pool,state}=fixturePool();
  const result=await leadPipeline.createManualLead({uid:'synthetic-owner',actorType:'user',actorId:'owner-1',role:'owner',pool,input:{title:'Synthetic qualification',contactName:'Synthetic contact',learnerName:'Synthetic learner',stageKey:'new',ownerAgentId:7,qualificationData:qualification}});
  assert.ok(result.id);
  assert.ok(state.leadInsert,'lead insert was reached');
  const stored=JSON.parse(state.leadInsert.params[16]);
  assert.deepEqual(stored,qualification);
  assert.equal(state.committed,true);
  assert.equal(state.rolledBack,false);
});

test('invalid qualification rejects and rolls back its lead and contact writes',async()=>{
  const {pool,state}=fixturePool();
  await assert.rejects(leadPipeline.createManualLead({uid:'synthetic-owner',actorType:'user',actorId:'owner-1',role:'owner',pool,input:{title:'Invalid qualification',contactName:'Synthetic contact',stageKey:'new',qualificationData:{enquiryPurpose:'unapproved'}}}),{status:400});
  assert.ok(state.queries.some(query=>query.sql.includes('INSERT INTO pipeline_contacts')),'synthetic contact insert is attempted before qualification validation');
  assert.equal(state.leadInsert,null,'invalid qualification never reaches the lead insert');
  assert.equal(state.committed,false);
  assert.equal(state.rolledBack,true);
});
