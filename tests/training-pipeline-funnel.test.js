'use strict';

const assert=require('node:assert/strict');
const test=require('node:test');
const fs=require('node:fs');
const path=require('node:path');
const pipeline=require('../helper/pipeline/leadPipeline');

test('training reply signals require four total replies and keep the separate hot lead threshold',()=>{
  const now=Date.parse('2026-11-04T10:00:00Z');
  assert.deepEqual(pipeline.engagementSignals({totalReplies:1,repliesIn7Days:1,lastReplyAt:'2026-11-04 09:00:00',now}),{interested:false,hot:false});
  assert.deepEqual(pipeline.engagementSignals({totalReplies:2,repliesIn7Days:2,lastReplyAt:'2026-11-04 09:00:00',now}),{interested:false,hot:false});
  assert.deepEqual(pipeline.engagementSignals({totalReplies:3,repliesIn7Days:3,lastReplyAt:'2026-11-04 09:00:00',now}),{interested:false,hot:true});
  assert.deepEqual(pipeline.engagementSignals({totalReplies:4,repliesIn7Days:3,lastReplyAt:'2026-11-04 09:00:00',now}),{interested:true,hot:true});
  assert.equal(pipeline.engagementSignals({totalReplies:5,repliesIn7Days:3,lastReplyAt:'2026-11-01 09:00:00',now}).hot,false);
  assert.equal(pipeline.engagementSignals({totalReplies:5,repliesIn7Days:3,lastReplyAt:'2026-11-04 11:00:00',now}).hot,false);
});

test('training stage decisions preserve later outcomes and prioritize an active follow-up task',()=>{
  assert.equal(pipeline.trainingEngagementStage({stageKey:'new',totalReplies:3}),'new');
  assert.equal(pipeline.trainingEngagementStage({stageKey:'new',totalReplies:4}),'interested');
  assert.equal(pipeline.trainingEngagementStage({stageKey:'contacted',totalReplies:4,hasActiveFollowUp:true}),'contacted');
  assert.equal(pipeline.trainingEngagementStage({stageKey:'qualified',totalReplies:8}),'qualified');
  assert.equal(pipeline.trainingEngagementStage({stageKey:'training_registration_pending',totalReplies:8,hasActiveFollowUp:true}),'training_registration_pending');
  assert.equal(pipeline.trainingEngagementStage({stageKey:'new',status:'won',totalReplies:8}),'new');
  assert.equal(pipeline.trainingEngagementStage({stageKey:'new',automationPaused:true,totalReplies:8}),'new');
});

test('Training Inbox history becomes an idempotent reply event without storing message text',()=>{
  const crypto=require('node:crypto');
  const uidHash='workspace-hash',now='2026-11-04 10:00:00.000';
  const event=pipeline.trainingHistoryEvent({uidHash,uid:'synthetic-owner',leadId:'synthetic-lead',origin:'qr',chatId:'qr_chat',inboxMessageId:42,providerMessageId:'provider-42',senderMobile:'+97450123456',timestamp:'1793782800'},now);
  const digest=value=>crypto.createHash('sha256').update(value).digest('hex');
  assert.equal(event[2],digest('qr:provider-42'));
  assert.equal(event[5],digest('qr:qr_chat'));
  assert.equal(event[8],'2026-11-04 09:00:00.000');
  assert.equal(event[10],now);
  assert.equal(event[11],event[8]);
  assert.equal(event.length,12);
  assert.equal(event.includes('customer message text'),false);
});

test('training funnel setup is category scoped, preserves lead IDs, maps Proposal, and runs once',async()=>{
  const uid='synthetic-training-owner-funnel-test';
  const uidHash=require('node:crypto').createHash('sha256').update(uid).digest('hex');
  const settings={uid_hash:uidHash,uid,enabled:1,auto_capture_qr:1,auto_capture_meta:1,qr_entry_stage:'proposal',meta_entry_stage:'new',interested_stage:'proposal',training_funnel_version:2};
  const stages=[{stage_key:'proposal',title:'Proposal',position:50,color:'#e46a36',stage_type:'open',probability:75,is_system:0}];
  const leads=[
    {id:'synthetic-lead',uid_hash:uidHash,stage_key:'proposal',status:'open'},
    {id:'synthetic-won',uid_hash:uidHash,stage_key:'proposal',status:'won'},
    {id:'synthetic-lost',uid_hash:uidHash,stage_key:'proposal',status:'lost'},
    {id:'engaged-new',uid_hash:uidHash,stage_key:'new',status:'open',automation_paused:0},
    {id:'engaged-follow-up',uid_hash:uidHash,stage_key:'contacted',status:'open',automation_paused:0},
    {id:'already-qualified',uid_hash:uidHash,stage_key:'qualified',status:'open',automation_paused:0},
    {id:'paused-new',uid_hash:uidHash,stage_key:'new',status:'open',automation_paused:1},
    {id:'below-threshold-interested',uid_hash:uidHash,stage_key:'interested',status:'open',automation_paused:0},
    {id:'task-interested',uid_hash:uidHash,stage_key:'interested',status:'open',automation_paused:0},
    {id:'application-interested',uid_hash:uidHash,stage_key:'interested',status:'open',automation_paused:0},
    {id:'exactly-three-new',uid_hash:uidHash,stage_key:'new',status:'open',automation_paused:0},
    {id:'already-admission',uid_hash:uidHash,stage_key:'training_registration_pending',status:'open',automation_paused:0},
    {id:'already-invoiced',uid_hash:uidHash,stage_key:'training_invoice_issued',status:'won',automation_paused:0},
  ];
  const replyCounts={'engaged-new':4,'engaged-follow-up':3,'already-qualified':8,'paused-new':4,'below-threshold-interested':3,'task-interested':1,'application-interested':5,'exactly-three-new':3,'already-admission':8,'already-invoiced':9};
  const activeTasks=new Set(['engaged-follow-up','task-interested']);
  const applications=new Set(['application-interested']);
  const activities=[];
  const queryOrder=[];
  let versionReads=0;
  let transactionCount=0;
  const db={async beginTransaction(){transactionCount++;},async commit(){},async rollback(){},release(){},async query(sql,params=[]){
    queryOrder.push(sql);
    if(sql.includes('INSERT IGNORE INTO pipeline_settings'))return [{affectedRows:1}];
    if(sql.includes('INSERT IGNORE INTO pipeline_stages')){
      if(params.length===9){const [, ,stage_key,title,position,color,stage_type,probability,is_system]=params;if(!stages.some(stage=>stage.stage_key===stage_key))stages.push({stage_key,title,position:Number(position),color,stage_type,probability,is_system});}
      else if(params.length===6){const [, ,stage_key,title,position,color]=params;if(!stages.some(stage=>stage.stage_key===stage_key))stages.push({stage_key,title,position:Number(position),color,stage_type:'won',probability:100,is_system:1});}
      else if(params.length===3&&!stages.some(stage=>stage.stage_key==='training_registration_pending'))stages.push({stage_key:'training_registration_pending',title:'Admission',position:Math.max(0,...stages.map(stage=>stage.position))+1,color:'#a66c16',stage_type:'open',probability:70,is_system:1});
      return [{affectedRows:1}];
    }
    if(sql.includes('SELECT * FROM pipeline_settings'))return [[settings]];
    if(sql.includes('SELECT training_funnel_version')){versionReads++;return [[{training_funnel_version:settings.training_funnel_version}]];}
    if(sql.includes('SELECT pc.lead_id, pc.origin, pc.chat_id'))return [[]];
    if(sql.includes('UPDATE pipeline_events pe'))return [{affectedRows:0}];
    if(sql.includes('stage_key IN (?)'))return [stages.filter(stage=>params[2].includes(stage.stage_key)).map(stage=>({stage_key:stage.stage_key}))];
    if(sql.includes("stage_key='won'"))return [[{position:stages.find(stage=>stage.stage_key==='won')?.position}].filter(row=>row.position!==undefined)];
    if(sql.startsWith('UPDATE pipeline_stages SET title = ?')){const stage=stages.find(item=>item.stage_key===params[2]);if(stage&&stage.title===params[3])stage.title=params[0];return [{affectedRows:1}];}
    if(sql.includes("stage_key = 'proposal' FOR UPDATE"))return [stages.filter(stage=>stage.stage_key==='proposal').map(stage=>({stage_key:stage.stage_key}))];
    if(sql.startsWith('INSERT INTO pipeline_activity')){
      if(sql.includes('Legacy Proposal stage mapped'))activities.push({type:'proposal_mapping'});
      else if(sql.includes('Existing student application'))applications.forEach(id=>activities.push({type:'application',id}));
      else if(sql.includes('Active staff follow-up task'))activeTasks.forEach(id=>activities.push({type:'follow_up',id}));
      else if(sql.includes('Four or more historical customer replies')){for(const lead of leads)if(['new','contacted'].includes(lead.stage_key)&&lead.status==='open'&&!lead.automation_paused&&(replyCounts[lead.id]||0)>=4&&!activeTasks.has(lead.id)&&!applications.has(lead.id))activities.push({type:'interested',id:lead.id});}
      else if(sql.includes('Reply history below the Interested threshold')){for(const lead of leads)if(['interested','contacted'].includes(lead.stage_key)&&lead.status==='open'&&!lead.automation_paused&&(replyCounts[lead.id]||0)<4&&!activeTasks.has(lead.id)&&!applications.has(lead.id))activities.push({type:'reset',id:lead.id});}
      return [{affectedRows:1}];
    }
    if(sql.includes("SET l.stage_key = 'training_registration_pending'")){for(const lead of leads)if(applications.has(lead.id)&&lead.status==='open'&&!lead.automation_paused&&['new','interested','contacted','qualified'].includes(lead.stage_key))lead.stage_key='training_registration_pending';return [{affectedRows:1}];}
    if(sql.includes("SET l.stage_key = 'contacted'")){for(const lead of leads)if(activeTasks.has(lead.id)&&lead.status==='open'&&!lead.automation_paused&&!applications.has(lead.id)&&['new','interested','qualified'].includes(lead.stage_key))lead.stage_key='contacted';return [{affectedRows:1}];}
    if(sql.includes("SET l.stage_key = 'interested'")){for(const lead of leads)if(['new','contacted'].includes(lead.stage_key)&&lead.status==='open'&&!lead.automation_paused&&(replyCounts[lead.id]||0)>=4&&!activeTasks.has(lead.id)&&!applications.has(lead.id))lead.stage_key='interested';return [{affectedRows:1}];}
    if(sql.includes("SET l.stage_key = 'new'")){for(const lead of leads)if(['interested','contacted'].includes(lead.stage_key)&&lead.status==='open'&&!lead.automation_paused&&(replyCounts[lead.id]||0)<4&&!activeTasks.has(lead.id)&&!applications.has(lead.id))lead.stage_key='new';return [{affectedRows:1}];}
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
  assert.deepEqual(await Promise.all([
    pipeline.ensureTrainingPipeline({uid,categoryKey:'training_center',pool}),
    pipeline.ensureTrainingPipeline({uid,categoryKey:'training_center',pool}),
  ]),[true,true]);
  assert.equal(transactionCount,1);
  assert.ok(queryOrder.findIndex(sql=>sql.includes('SELECT training_funnel_version')&&sql.includes('FOR UPDATE'))<queryOrder.findIndex(sql=>sql.includes('INSERT IGNORE INTO pipeline_stages')));
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
  assert.deepEqual([...new Set(activities.map(item=>item.type))].sort(),['application','follow_up','interested','proposal_mapping','reset']);
  assert.equal(settings.qr_entry_stage,'new');
  assert.equal(settings.interested_stage,'interested');
  assert.equal(settings.training_funnel_version,3);
  assert.equal(leads.find(lead=>lead.id==='engaged-new').stage_key,'interested');
  assert.equal(leads.find(lead=>lead.id==='engaged-follow-up').stage_key,'contacted');
  assert.equal(leads.find(lead=>lead.id==='already-qualified').stage_key,'qualified');
  assert.equal(leads.find(lead=>lead.id==='paused-new').stage_key,'new');
  assert.equal(leads.find(lead=>lead.id==='below-threshold-interested').stage_key,'new');
  assert.equal(leads.find(lead=>lead.id==='task-interested').stage_key,'contacted');
  assert.equal(leads.find(lead=>lead.id==='application-interested').stage_key,'training_registration_pending');
  assert.equal(leads.find(lead=>lead.id==='exactly-three-new').stage_key,'new');
  assert.equal(leads.find(lead=>lead.id==='already-admission').stage_key,'training_registration_pending');
  assert.equal(leads.find(lead=>lead.id==='already-invoiced').stage_key,'training_invoice_issued');
  assert.deepEqual(activities.filter(item=>item.type==='interested').map(item=>item.id),['engaged-new']);
  assert.equal(await pipeline.ensureTrainingPipeline({uid,categoryKey:'training_center',pool}),true);
  assert.equal(versionReads,1);
});

test('configured Training workspaces do not recreate the retired Proposal stage',async()=>{
  const uid='synthetic-training-owner-funnel-v3-test';
  const settings={training_funnel_version:3};
  const stages=[];
  const pool={async getConnection(){return {
    async beginTransaction(){},async commit(){},async rollback(){},release(){},
    async query(sql,params=[]){
      if(sql.includes('INSERT IGNORE INTO pipeline_settings'))return [{affectedRows:1}];
      if(sql.includes('SELECT training_funnel_version'))return [[{training_funnel_version:settings.training_funnel_version}]];
      if(sql.includes('SELECT * FROM pipeline_settings'))return [[settings]];
      if(sql.includes('INSERT IGNORE INTO pipeline_stages')){const key=params[2];stages.push(key);return [{affectedRows:1}];}
      throw new Error(`Unexpected configured workspace query: ${sql}`);
    },
  };}};
  assert.equal(await pipeline.ensureTrainingPipeline({uid,categoryKey:'training_center',pool}),true);
  assert.ok(stages.includes('new'));
  assert.equal(stages.includes('proposal'),false);
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
  const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
  const backend=fs.readFileSync(path.join(__dirname,'../helper/pipeline/leadPipeline.js'),'utf8');
  assert.match(script,/metaAdsMessages:\$\$\('\.meta-ads-message',\$\('#metaAdsMessageRows'\)\)\.map/);
  assert.doesNotMatch(script,/metaAdsMessages:\$\('\.meta-ads-message'/);
  assert.match(script,/hotLeadBadge\(lead\)/);
  assert.match(script,/hotLead:'عميل ساخن'/);
  assert.match(script,/An open lead moves to Interested after 4 customer replies across its linked chats/);
  assert.match(script,/loadMore:'Load next batch/);
  assert.match(script,/hint\.classList\.toggle\('hidden',state\.data\.categoryKey!=='training_center'\|\|!/);
  assert.match(html,/id="engagementHint" class="engagement-hint hidden"/);
  assert.match(backend,/GROUP BY l\.stage_key WITH ROLLUP/);
  assert.match(backend,/Training Center interest is driven by the full linked-conversation reply/);
  assert.match(styles,/\.hot-lead/);
  assert.match(styles,/html\[data-sx-theme=dark\] \.hot-lead/);
});
