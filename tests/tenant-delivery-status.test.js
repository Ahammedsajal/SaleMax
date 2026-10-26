'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const status=require('../modules/platform/tenant-delivery-status');

test('delivery callbacks constrain API-log writes by trusted owner UID',async()=>{
  let call;
  const query=async(sql,params)=>(call={sql,params},{affectedRows:1});
  await status.updateApiLogStatus({query,uid:'tenant-a',messageId:'wamid-shared',status:'failed',errorData:'{}'});
  assert.match(call.sql,/WHERE uid = \? AND msg_id = \?/);
  assert.deepEqual(call.params,['failed','{}','tenant-a','wamid-shared']);
  await status.updateApiLogStatus({query,uid:'tenant-a',messageId:'wamid-shared',status:'read'});
  assert.match(call.sql,/WHERE uid = \? AND msg_id = \?/);
  assert.deepEqual(call.params,['read','tenant-a','wamid-shared']);
  await assert.rejects(status.updateApiLogStatus({query,uid:'',messageId:'wamid-shared',status:'read'}),{message:'DELIVERY_STATUS_OWNER_REQUIRED'});
});

test('campaign status lookup and writes constrain duplicate provider IDs to one owner',async()=>{
  const logs=[
    {uid:'tenant-a',metaMsgId:'wamid-shared',campaignId:'campaign-a',deliveryStatus:'sent'},
    {uid:'tenant-b',metaMsgId:'wamid-shared',campaignId:'campaign-b',deliveryStatus:'sent'},
  ];
  const calls=[];
  const query=async(sql,params)=>{
    calls.push({sql,params});
    if(sql.startsWith('SELECT')){
      const row=logs.find(item=>item.uid===params[0]&&item.metaMsgId===params[1]);
      return row?[{campaign_id:row.campaignId,delivery_status:row.deliveryStatus}]:[];
    }
    const row=logs.find(item=>item.uid===params.at(-2)&&item.metaMsgId===params.at(-1));
    if(row)row.deliveryStatus=params[0];
    return {affectedRows:row?1:0};
  };
  const found=await status.findCampaignLog({query,uid:'tenant-a',messageId:'wamid-shared'});
  assert.deepEqual(found,{campaign_id:'campaign-a',delivery_status:'sent'});
  await status.updateCampaignLogStatus({query,uid:'tenant-a',messageId:'wamid-shared',status:'delivered'});
  assert.match(calls[0].sql,/WHERE uid = \? AND meta_msg_id = \?/);
  assert.deepEqual(calls[0].params,['tenant-a','wamid-shared']);
  assert.match(calls[1].sql,/WHERE uid = \? AND meta_msg_id = \?/);
  assert.deepEqual(calls[1].params,['delivered','tenant-a','wamid-shared']);
  assert.equal(logs[0].deliveryStatus,'delivered');
  assert.equal(logs[1].deliveryStatus,'sent');
});

test('a callback updates only status rows belonging to its resolved account',async()=>{
  const calls=[];
  await status.updateWebhookStatuses({
    query:async(sql,params)=>{
      calls.push({sql,params});
      if(sql.startsWith('SELECT'))return [{campaign_id:'campaign-a',delivery_status:'sent'}];
      return {affectedRows:1};
    },
    uid:'tenant-a',statuses:[{id:'wamid-shared',status:'failed'}],body:{entry:[{id:'waba-a'}]},
    updateCampaignMessageStatus:async(...args)=>calls.push({campaignArgs:args}),
  });
  assert.match(calls[0].sql,/WHERE uid = \? AND meta_msg_id = \?/);
  assert.deepEqual(calls[0].params,['tenant-a','wamid-shared']);
  assert.deepEqual(calls[1].campaignArgs,['tenant-a','wamid-shared','failed',JSON.stringify({entry:[{id:'waba-a'}]})]);
  assert.match(calls[2].sql,/WHERE uid = \? AND meta_msg_id = \?/);
  assert.deepEqual(calls[2].params,['failed',JSON.stringify({entry:[{id:'waba-a'}]}),'tenant-a','wamid-shared']);
  assert.match(calls[3].sql,/WHERE uid = \? AND msg_id = \?/);
  assert.deepEqual(calls[3].params,['failed',JSON.stringify({entry:[{id:'waba-a'}]}),'tenant-a','wamid-shared']);
});
