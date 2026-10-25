'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const reminder=require('../modules/platform/chatbot-sales-prospect-reminders');

test('reminder worker scans only due Meta prospect sessions and uses row leases for multi-worker safety',async()=>{
 const calls=[];const db={query:async(sql,params)=>{calls.push({sql,params});return [[],[]];},beginTransaction:async()=>calls.push({transaction:'begin'}),commit:async()=>calls.push({transaction:'commit'}),rollback:async()=>{},release:()=>calls.push({released:true})};
 const result=await reminder.tick({getConnection:async()=>db},{workerId:'test-worker',limit:4});
 assert.deepEqual(result,{claimed:0,accepted:0,suppressed:0,retried:0});
 const scan=calls.find(call=>call.sql);
 assert.match(scan.sql,/channel_kind='whatsapp_meta'/);assert.match(scan.sql,/demoReminderDueAt/);assert.match(scan.sql,/demoReminderSentAt/);assert.match(scan.sql,/SKIP LOCKED/);assert.deepEqual(scan.params,[4]);
 assert.ok(calls.some(call=>call.transaction==='commit'));assert.ok(calls.some(call=>call.released));
});

test('local-only runtime does not start the production reminder worker',()=>{
 const worker=reminder.start({env:{LOCAL_ONLY_MODE:'true'}});assert.equal(typeof worker.stop,'function');worker.stop();
});

test('reminder uses the approved short Yes and Not yet quick replies',()=>{
 const message=reminder.reminderMessage();const buttons=message.interactive.action.buttons;
 assert.deepEqual(buttons.map(item=>item.reply.title),['Yes','Not yet']);
 assert.equal(message.interactive.body.text,'Just checking in—did you get a chance to watch the 7Network Training Center demo?');
});
