'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const media=require('../modules/platform/real-estate-unit-media');
const categories=require('../modules/platform/categories');
const tenant='11111111-1111-4111-8111-111111111111',unit='44444444-4444-4444-8444-444444444444',id='55555555-5555-4555-8555-555555555555';
const context={audience:'tenant',tenant:{id:tenant,status:'active',categoryKey:'real_estate',categoryVersion:1},membership:{id:'33333333-3333-4333-8333-333333333333',tenantId:tenant,role:'agent',status:'active'},identity:{id:'22222222-2222-4222-8222-222222222222'},category:categories.realEstate,subscription:{status:'active',categoryKey:'real_estate',categoryVersion:1,capabilities:['realestate.listings']}};
test('upload validates actual file signature and declared size',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'re-media-test-'));
  try{const file=path.join(dir,'upload');await fs.writeFile(file,Buffer.from('not an image'));
    await assert.rejects(media.inspect({tempFilePath:file,size:12,mimetype:'image/png',name:'x.png'}),{code:'MEDIA_SIGNATURE_INVALID'});
    await assert.rejects(media.inspect({tempFilePath:file,size:20,mimetype:'image/png',name:'x.png'}),{code:'MEDIA_SIZE_INVALID'});
    await assert.rejects(media.inspect({tempFilePath:file,size:12,mimetype:'text/html',name:'x.html'}),{code:'MEDIA_TYPE_INVALID'});
  }finally{await fs.rm(dir,{recursive:true,force:true});}
});
test('assigned agents cannot read private documents even when they can see a unit',async()=>{
  const calls=[];const db={query:async(sql,args)=>{calls.push({sql,args});if(sql.includes('FROM sx_real_estate_units u WHERE'))return [[{id:unit,amenities:'[]'}]];if(sql.startsWith('SELECT media_kind'))return [[{kind:'document',mimeType:'application/pdf'}]];if(sql.startsWith('SELECT id,media_kind'))return [[]];throw Error('unexpected query');}};
  await assert.rejects(media.getFile(db,context,unit,id),{code:'MEDIA_NOT_FOUND'});
  await media.list(db,context,unit);assert.match(calls.at(-1).sql,/media_kind<>'document'/);
});
