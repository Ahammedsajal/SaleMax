'use strict';

const assert=require('node:assert/strict');
const test=require('node:test');
const fs=require('node:fs');
const path=require('node:path');
const pipeline=require('../helper/pipeline/leadPipeline');

test('training reply signals use an explainable two reply and hot lead threshold',()=>{
  const now=Date.parse('2026-11-04T10:00:00Z');
  assert.deepEqual(pipeline.engagementSignals({totalReplies:1,repliesIn7Days:1,lastReplyAt:'2026-11-04 09:00:00',now}),{interested:false,hot:false});
  assert.deepEqual(pipeline.engagementSignals({totalReplies:2,repliesIn7Days:2,lastReplyAt:'2026-11-04 09:00:00',now}),{interested:true,hot:false});
  assert.deepEqual(pipeline.engagementSignals({totalReplies:3,repliesIn7Days:3,lastReplyAt:'2026-11-04 09:00:00',now}),{interested:true,hot:true});
  assert.equal(pipeline.engagementSignals({totalReplies:5,repliesIn7Days:3,lastReplyAt:'2026-11-01 09:00:00',now}).hot,false);
  assert.equal(pipeline.engagementSignals({totalReplies:5,repliesIn7Days:3,lastReplyAt:'2026-11-04 11:00:00',now}).hot,false);
});

test('training funnel setup is category scoped, preserves lead IDs, maps Proposal, and runs once',async()=>{
  const uid='synthetic-training-owner-funnel-test';
  const uidHash=require('node:crypto').createHash('sha256').update(uid).digest('hex');
  const settings={uid_hash:uidHash,uid,enabled:1,auto_capture_qr:1,auto_capture_meta:1,qr_entry_stage:'proposal',meta_entry_stage:'new',interested_stage:'proposal',training_funnel_version:0};
  const stages=[];
  const leads=[{id:'synthetic-lead',uid_hash:uidHash,stage_key:'proposal',status:'open'},{id:'synthetic-won',uid_hash:uidHash,stage_key:'proposal',status:'won'},{id:'synthetic-lost',uid_hash:uidHash,stage_key:'proposal',status:'lost'}];
  const activities=[];
  let versionReads=0;
  const db={async beginTransaction(){},async commit(){},async rollback(){},release(){},async query(sql,params=[]){
    if(sql.includes('INSERT IGNORE INTO pipeline_settings'))return [{affectedRows:1}];
    if(sql.includes('INSERT IGNORE INTO pipeline_stages')){
      if(params.length===9){const [, ,stage_key,title,position,color,stage_type,probability,is_system]=params;if(!stages.some(stage=>stage.stage_key===stage_key))stages.push({stage_key,title,position:Number(position),color,stage_type,probability,is_system});}
      else if(params.length===6){const [, ,stage_key,title,position,color]=params;if(!stages.some(stage=>stage.stage_key===stage_key))stages.push({stage_key,title,position:Number(position),color,stage_type:'won',probability:100,is_system:1});}
      else if(params.length===3&&!stages.some(stage=>stage.stage_key==='training_registration_pending'))stages.push({stage_key:'training_registration_pending',title:'Admission',position:Math.max(0,...stages.map(stage=>stage.position))+1,color:'#a66c16',stage_type:'open',probability:70,is_system:1});
      return [{affectedRows:1}];
    }
    if(sql.includes('SELECT * FROM pipeline_settings'))return [[settings]];
    if(sql.includes('SELECT training_funnel_version')){versionReads++;return [[{training_funnel_version:settings.training_funnel_version}]];}
    if(sql.includes('stage_key IN (?)'))return [stages.filter(stage=>params[2].includes(stage.stage_key)).map(stage=>({stage_key:stage.stage_key}))];
    if(sql.includes("stage_key='won'"))return [[{position:stages.find(stage=>stage.stage_key==='won')?.position}].filter(row=>row.position!==undefined)];
    if(sql.startsWith('UPDATE pipeline_stages SET title = ?')){const stage=stages.find(item=>item.stage_key===params[2]);if(stage&&stage.title===params[3])stage.title=params[0];return [{affectedRows:1}];}
    if(sql.includes("stage_key = 'proposal' FOR UPDATE"))return [stages.filter(stage=>stage.stage_key==='proposal').map(stage=>({stage_key:stage.stage_key}))];
    if(sql.startsWith('INSERT INTO pipeline_activity')){activities.push({type:'proposal_mapping'});return [{affectedRows:1}];}
    if(sql.startsWith('UPDATE pipeline_leads SET stage_key = CASE status')){for(const lead of leads)if(lead.uid_hash===params[0]&&lead.stage_key==='proposal')lead.stage_key=lead.status==='won'?'won':lead.status==='lost'?'lost':'qualified';return [{affectedRows:1}];}
    if(sql.startsWith('UPDATE pipeline_settings SET qr_entry_stage = IF')){settings.qr_entry_stage='new';settings.interested_stage='interested';return [{affectedRows:1}];}
    if(sql.startsWith('DELETE FROM pipeline_stages')){const i=stages.findIndex(stage=>stage.stage_key==='proposal');if(i>=0)stages.splice(i,1);return [{affectedRows:1}];}
    if(sql.includes('training_funnel_version = ?')){settings.training_funnel_version=params[0];settings.qr_entry_stage='new';settings.meta_entry_stage='new';settings.interested_stage='interested';return [{affectedRows:1}];}
    if(sql.includes('SELECT stage_key FROM pipeline_stages')&&sql.includes('ORDER BY position'))return [stages.slice().sort((a,b)=>a.position-b.position).map(stage=>({stage_key:stage.stage_key}))];
    if(sql.startsWith('UPDATE pipeline_stages SET position = ?')){const stage=stages.find(item=>item.stage_key===params[2]);if(stage)stage.position=params[0];return [{affectedRows:1}];}
    if(sql.startsWith('UPDATE pipeline_stages SET position=position+'))return [{affectedRows:0}];
    throw new Error(`Unexpected funnel test query: ${sql}`);
  }};
  const pool={async getConnection(){return db;}};
  assert.equal(await pipeline.ensureTrainingPipeline({uid,categoryKey:'7network_sales',pool}),false);
  assert.equal(await pipeline.ensureTrainingPipeline({uid,categoryKey:'training_center',pool}),true);
  assert.deepEqual(stages.slice().sort((a,b)=>a.position-b.position).slice(0,6).map(stage=>stage.stage_key),[
    'new','interested','contacted','qualified','training_registration_pending','training_invoice_issued',
  ]);
  assert.equal(stages.find(stage=>stage.stage_key==='new').title,'New Lead');
  assert.equal(stages.find(stage=>stage.stage_key==='interested').title,'Interested Lead');
  assert.equal(stages.find(stage=>stage.stage_key==='contacted').title,'Follow-up');
  assert.equal(stages.find(stage=>stage.stage_key==='training_invoice_issued').title,'Invoiced');
  assert.equal(stages.some(stage=>stage.stage_key==='proposal'),false);
  assert.equal(leads[0].id,'synthetic-lead');
  assert.equal(leads[0].stage_key,'qualified');
  assert.equal(leads[1].stage_key,'won');
  assert.equal(leads[2].stage_key,'lost');
  assert.equal(activities.length,1);
  assert.equal(settings.qr_entry_stage,'new');
  assert.equal(settings.interested_stage,'interested');
  assert.equal(settings.training_funnel_version,1);
  assert.equal(await pipeline.ensureTrainingPipeline({uid,categoryKey:'training_center',pool}),true);
  assert.equal(versionReads,1);
});

test('training follow-up stage automation is tenant/category safe and respects paused, closed, and admission leads',async()=>{
  const queryCalls=[];
  const db={async query(sql,params=[]){queryCalls.push(sql);if(sql.includes('SELECT stage_key, status, automation_paused'))return [[this.lead]];if(sql.includes('SELECT stage_key, position, stage_type'))return [[{stage_key:'contacted',position:30,stage_type:'open'}]];return [{affectedRows:1}];}};
  db.lead={stage_key:'qualified',status:'open',automation_paused:0};
  assert.equal(await pipeline.moveTrainingLeadToFollowUp(db,{uidHash:'h',leadId:'l',categoryKey:'7network_sales'}),false);
  assert.equal(queryCalls.length,0);
  assert.equal(await pipeline.moveTrainingLeadToFollowUp(db,{uidHash:'h',leadId:'l',categoryKey:'training_center',taskId:'t'}),true);
  assert.equal(queryCalls.some(sql=>sql.includes('INSERT INTO pipeline_activity')),true);
  for(const blocked of [
    {stage_key:'training_registration_pending',status:'open',automation_paused:0},
    {stage_key:'contacted',status:'won',automation_paused:0},
    {stage_key:'qualified',status:'open',automation_paused:1},
  ]){db.lead=blocked;assert.equal(await pipeline.moveTrainingLeadToFollowUp(db,{uidHash:'h',leadId:'l',categoryKey:'training_center'}),false);}
});

test('Pipeline exposes hot reply signals accessibly and fixes the settings list collection error',()=>{
  const root=path.join(__dirname,'../client/public/pipeline');
  const script=fs.readFileSync(path.join(root,'pipeline.js'),'utf8');
  const styles=fs.readFileSync(path.join(root,'pipeline-theme.css'),'utf8');
  assert.match(script,/metaAdsMessages:\$\$\('\.meta-ads-message',\$\('#metaAdsMessageRows'\)\)\.map/);
  assert.doesNotMatch(script,/metaAdsMessages:\$\('\.meta-ads-message'/);
  assert.match(script,/hotLeadBadge\(lead\)/);
  assert.match(script,/hotLead:'عميل ساخن'/);
  assert.match(styles,/\.hot-lead/);
  assert.match(styles,/html\[data-sx-theme=dark\] \.hot-lead/);
});
