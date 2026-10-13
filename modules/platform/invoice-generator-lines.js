'use strict';
const fail=code=>{throw Object.assign(new Error(code),{code,status:400});};
const MAX_MINOR=99999999999;
function decimalUnits(value,code){
  if(typeof value!=='string'&&typeof value!=='number')fail(code);
  const text=String(value).trim();if(!/^\d{1,9}(?:\.\d{1,2})?$/.test(text))fail(code);
  const [whole,fraction='']=text.split('.'),units=Number(whole)*100+Number(fraction.padEnd(2,'0'));
  if(!Number.isSafeInteger(units))fail(code);return units;
}
function selections(input){
  const rows=input.courseLines===undefined?[{courseId:input.courseId,discountType:'none',discountValue:'0'}]:input.courseLines;
  if(!Array.isArray(rows)||rows.length<1||rows.length>10)fail('INVALID_INVOICE_COURSES');
  const ids=new Set();return rows.map(row=>{
    if(!row||typeof row!=='object'||Array.isArray(row)||!/^[0-9a-f-]{36}$/i.test(row.courseId||'')||ids.has(row.courseId))fail('INVALID_INVOICE_COURSES');
    ids.add(row.courseId);const discountType=row.discountType??'none';if(!['none','percent','fixed'].includes(discountType))fail('INVALID_INVOICE_DISCOUNT');
    const units=decimalUnits(row.discountValue??'0','INVALID_INVOICE_DISCOUNT');
    if(discountType==='none'&&units!==0||discountType==='percent'&&units>10000)fail('INVALID_INVOICE_DISCOUNT');
    const expectedOfferVersion=row.expectedOfferVersion===undefined?null:Number(row.expectedOfferVersion);
    if(expectedOfferVersion!==null&&(!Number.isSafeInteger(expectedOfferVersion)||expectedOfferVersion<1))fail('INVALID_INVOICE_COURSES');
    return {courseId:row.courseId,discountType,discountValue:(units/100).toFixed(2),discountUnits:units,expectedOfferVersion};
  });
}
function price(catalog,requested){
  const lines=requested.map((row,index)=>{
    const course=catalog.find(item=>item.id===row.courseId);if(!course)throw Object.assign(new Error('COURSE_UNAVAILABLE'),{code:'COURSE_UNAVAILABLE',status:409});
    if(row.expectedOfferVersion!==null&&row.expectedOfferVersion!==Number(course.offerVersion))throw Object.assign(new Error('STALE_COURSE_PRICE'),{code:'STALE_COURSE_PRICE',status:409});
    const gross=Number(course.amountMinor);if(course.currency!=='QAR'||!Number.isSafeInteger(gross)||gross<1||gross>MAX_MINOR)fail('INVALID_COURSE_PRICE');
    const discount=row.discountType==='percent'?Number((BigInt(gross)*BigInt(row.discountUnits)+5000n)/10000n):row.discountType==='fixed'?row.discountUnits:0;
    if(discount>gross)fail('DISCOUNT_EXCEEDS_COURSE_PRICE');
    return {lineNumber:index+1,courseId:course.id,offerVersion:Number(course.offerVersion),descriptionEn:course.nameEn,descriptionAr:course.nameAr,quantity:1,unitAmountMinor:gross,discountType:row.discountType,discountValue:row.discountValue,discountMinor:discount,taxMinor:0,totalMinor:gross-discount};
  });
  const subtotalMinor=lines.reduce((sum,line)=>sum+line.unitAmountMinor,0),discountMinor=lines.reduce((sum,line)=>sum+line.discountMinor,0),totalMinor=subtotalMinor-discountMinor;
  if(!Number.isSafeInteger(subtotalMinor)||subtotalMinor>MAX_MINOR||totalMinor<1)fail('INVALID_INVOICE_TOTAL');
  return {lines,subtotalMinor,discountMinor,totalMinor,currency:'QAR'};
}
module.exports={selections,price,decimalUnits};
