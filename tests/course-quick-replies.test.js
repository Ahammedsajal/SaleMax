'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const s=require('../modules/platform/course-quick-replies');
test('course messages preserve the selected language, media-independent text order and WhatsApp text bounds',()=>{
 const course={name_en:'Excel',name_ar:'إكسل',description_en:'Learn spreadsheets',description_ar:'تعلم الجداول',duration_value:8,duration_unit:'weeks',delivery_mode:'in_person',outcomes_en:'Build reports',outcomes_ar:'إنشاء التقارير',prerequisites_en:'None',prerequisites_ar:'لا توجد'};
 const offer={currency:'QAR',price_minor:85000,registration_fee_minor:5000,inclusions:'["Certificate"]'};
 const en=s.textParts(course,offer,'en'),ar=s.textParts(course,offer,'ar');
 assert.match(en[0].text,/Excel\n\nLearn spreadsheets/);assert.match(en[1].text,/QAR 850.00/);assert.match(en[1].text,/Registration fee: QAR 50.00/);assert.match(en[1].text,/Certificate/);assert.match(en[1].text,/Learning outcomes/);
 assert.match(ar[0].text,/إكسل/);assert.match(ar[1].text,/٨|8/);assert.match(ar[1].text,/حضوري/);
 assert.ok(s.textParts({...course,description_en:'x'.repeat(5000)},null,'en').every(p=>p.text.length<=3500));
 assert.doesNotMatch(s.textParts(course,null,'en').map(p=>p.text).join(''),/QAR/);
 const product=s.textParts({...course,name_en:'Course fee calculator',description_en:'Learning outcomes are preserved as supplied.'},offer,'en',true);
 assert.equal(product[0].text,'Course fee calculator\n\nLearning outcomes are preserved as supplied.');assert.match(product[1].text,/Price: QAR 850.00/);assert.match(product[1].text,/Details:\nBuild reports/);
});
test('conversation access derives account and recipient from persisted rows and denies unassigned/foreign chats',async()=>{
 const row={chat_id:'chat',sender_mobile:'97450000001',origin:'qr',assigned_agent:JSON.stringify([{kind:'identity',identityId:'agent-i'}])};
 const c={scope:{uid:'owner',canonical:true,assignedOnly:true,identityId:'agent-i'},query:async(sql,args)=>{assert.deepEqual(args,['owner','chat']);return [row];}};
 assert.equal(await s.conversation(c,'chat'),row);
 await assert.rejects(s.conversation({...c,scope:{...c.scope,identityId:'foreign'}},'chat'),{code:'PERMISSION_DENIED'});
 await assert.rejects(s.conversation({...c,query:async()=>[]},'chat'),{code:'CONVERSATION_NOT_AVAILABLE'});
 await assert.rejects(s.conversation({...c,query:async()=>[{...row,origin:'telegram'}]},'chat'),{code:'CHANNEL_NOT_SUPPORTED'});
 const legacy={...c,agent:true,actor:{uid:'legacy-agent'},scope:{uid:'owner',canonical:false},query:async()=>[{...row,assigned_agent:'[{"uid":"legacy-agent"}]'}]};
 await assert.doesNotReject(s.conversation(legacy,'chat'));
 await assert.rejects(s.conversation({...legacy,actor:{uid:'other'}},'chat'),{code:'PERMISSION_DENIED'});
});
test('custom roles map course quick reply APIs to existing conversation permissions',()=>{
 const guard=require('../modules/platform/team-role-request-guard');
 for(const baseUrl of ['/api/workspace/inbox/course-replies','/api/inbox/course-replies','/api/agent/course-replies']){
 assert.equal(guard.routePermission({baseUrl,path:'/send',method:'POST'}),'conversations.reply');
 assert.equal(guard.routePermission({baseUrl,path:'/',method:'GET'}),'conversations.read');
 assert.equal(guard.routePermission({baseUrl,path:'/send',method:'GET'}),'conversations.read');
 assert.equal(guard.routePermission({baseUrl,path:'/send',method:'DELETE'}),null);
 assert.equal(guard.authorizeLegacyMembership({baseUrl,path:'/send',method:'POST',sourceTable:'agents'},{role:'agent',roleProfileId:'role',seatRole:'agent',rolePermissions:['conversations.read','conversations.reply']}).allowed,true);
 assert.equal(guard.authorizeLegacyMembership({baseUrl,path:'/send',method:'POST',sourceTable:'agents'},{role:'agent',roleProfileId:'role',seatRole:'agent',rolePermissions:['conversations.read']}).allowed,false);
 }
});
test('private QR and Meta transports send bytes or upload IDs, persist provider IDs and fail closed on missing channel',async()=>{
 const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');const dir=await fs.mkdtemp(path.join(os.tmpdir(),'course-transport-'));
 const file={path:path.join(dir,'brochure'),kind:'document',mimeType:'application/pdf',originalName:'synthetic.pdf'};const bytes=Buffer.from('%PDF synthetic');await fs.writeFile(file.path,bytes);
 const sent=[],saved=[],events=[],uploads=[];
 const helpers={returnMsgObjAfterAddingKey:v=>v,getCurrentTimestampInTimeZone:()=>123,sendMetaMsg:async v=>{sent.push(v);return {success:true,id:'meta-provider'};}};
 const c={scope:{uid:'owner'},actor:{uid:'owner'},query:async(sql,args)=>{if(sql.includes('FROM instance')){assert.deepEqual(args,['owner','session']);return [{uniqueId:'session'}];}if(sql.includes('FROM meta_api'))return [{access_token:'synthetic',business_phone_number_id:'synthetic'}];if(sql.includes('timezone'))return [{timezone:'Asia/Qatar'}];return [];}};
 const deps={helpers,qr:{formatPhone:v=>'jid:'+v,getSession:async id=>{assert.equal(id,'session');return {sendMessage:async(to,content)=>{sent.push({to,content});return {key:{id:'qr-provider'}};}};}},saveMessage:async v=>saved.push(v),notify:(...v)=>events.push(v),fetch:async(url,options)=>{uploads.push({url,options});return {ok:true,json:async()=>({id:'uploaded-private-media'})};}};
 const input={c,chat:{origin:'qr',origin_instance_unique_id:'session',sender_mobile:'97450000001',chat_id:'chat',sender_name:'Synthetic'},part:{kind:'document',name:'synthetic.pdf'},file,jobId:'job',index:0};
 try{
 const transport=require('../modules/platform/course-reply-transport');await transport.send(input,deps);assert.equal(sent[0].to,'jid:97450000001');assert.deepEqual(sent[0].content.document,bytes);assert.equal(saved[0].messageData.metaChatId,'qr-provider');assert.match(saved[0].messageData.msgContext.document.link,/\/files\/job\/0$/);assert.equal(events.length,2);
 await transport.send({...input,chat:{...input.chat,origin:'meta'}},deps);assert.equal(uploads.length,1);assert.deepEqual(sent[1].msgObj.document,{id:'uploaded-private-media',caption:'synthetic.pdf',filename:'synthetic.pdf'});assert.equal(saved[1].messageData.metaChatId,'meta-provider');
 await assert.rejects(transport.send({...input,c:{...c,query:async()=>[]}},deps),{code:'SEND_STOPPED_CHECK_CHAT'});
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
