const test=require('node:test');
const assert=require('node:assert/strict');
const {selections,price}=require('../modules/platform/invoice-generator-lines');
const a='a419050e-16b8-4f60-b77d-a956ce855e1c',b='c5551111-2222-4333-8444-555555555555';
const catalog=[{id:a,nameEn:'Course A',nameAr:'دورة أ',offerVersion:2,currency:'QAR',amountMinor:145000},{id:b,nameEn:'Course B',nameAr:'دورة ب',offerVersion:1,currency:'QAR',amountMinor:320000}];
test('different course lines retain independent percentage and QAR discounts',()=>{
  const result=price(catalog,selections({courseLines:[{courseId:a,discountType:'percent',discountValue:'10'},{courseId:b,discountType:'fixed',discountValue:'250.50'}]}));
  assert.equal(result.subtotalMinor,465000);assert.equal(result.discountMinor,39550);assert.equal(result.totalMinor,425450);
  assert.deepEqual(result.lines.map(line=>[line.courseId,line.discountMinor,line.totalMinor]),[[a,14500,130500],[b,25050,294950]]);
});
test('percentage discounts round half-up to a QAR cent',()=>{
  assert.equal(price([{...catalog[0],amountMinor:101}],selections({courseLines:[{courseId:a,discountType:'percent',discountValue:'50'}]})).totalMinor,50);
});
test('discount and duplicate-course validation prevents negative or free invoice totals',()=>{
  for(const value of ['-1','1.001','101','Infinity'])assert.throws(()=>selections({courseLines:[{courseId:a,discountType:'percent',discountValue:value}]}),{code:'INVALID_INVOICE_DISCOUNT'});
  assert.throws(()=>selections({courseLines:[{courseId:a},{courseId:a}]}),{code:'INVALID_INVOICE_COURSES'});
  assert.throws(()=>price(catalog,selections({courseLines:[{courseId:a,discountType:'fixed',discountValue:'1450.01'}]})),{code:'DISCOUNT_EXCEEDS_COURSE_PRICE'});
  assert.throws(()=>price(catalog,selections({courseLines:[{courseId:a,discountType:'percent',discountValue:'100'}]})),{code:'INVALID_INVOICE_TOTAL'});
});
test('the server rejects stale offer versions and preserves old single-course clients',()=>{
  assert.throws(()=>price(catalog,selections({courseLines:[{courseId:a,expectedOfferVersion:1}]})),{code:'STALE_COURSE_PRICE'});
  assert.equal(price(catalog,selections({courseId:a})).totalMinor,145000);
});
