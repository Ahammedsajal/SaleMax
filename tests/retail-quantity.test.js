'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const quantity=require('../modules/platform/retail-quantity');
const retailCommerce=require('../modules/platform/retail-commerce');

test('parses and formats exact fixed-point quantities without floating point',()=>{
  assert.equal(quantity.scaled('0.25'),250000n);
  assert.equal(quantity.fixed(quantity.scaled('123.450001')),'123.450001');
  assert.equal(quantity.format(quantity.scaled('12.500000'),2),'12.5');
  assert.equal(quantity.json(quantity.scaled('3.000000'),0),3);
  assert.equal(quantity.scaled(0.25),null);
  assert.equal(quantity.scaled('0.0000001'),null);
  assert.equal(quantity.scaled('-1'),null);
  assert.equal(quantity.scaled('1000000001'),null);
});

test('checks configured decimal precision and per-SKU selling increment',()=>{
  const quarter=quantity.scaled('0.25');
  assert.equal(quantity.atPrecision(quarter,2),true);
  assert.equal(quantity.atPrecision(quarter,1),false);
  assert.equal(quantity.isMultiple(quantity.scaled('0.75'),quarter),true);
  assert.equal(quantity.isMultiple(quantity.scaled('0.30'),quarter),false);
  assert.equal(quantity.isMultiple(quantity.scaled('0.5'),0n),false);
});

test('stock arithmetic and currency rounding are deterministic',()=>{
  assert.equal(quantity.add(quantity.scaled('1.25'),quantity.scaled('0.25')),quantity.scaled('1.5'));
  assert.equal(quantity.subtract(quantity.scaled('1.25'),quantity.scaled('0.25')),quantity.scaled('1'));
  assert.equal(quantity.subtract(quantity.scaled('0.25'),quantity.scaled('0.5')),null);
  assert.equal(quantity.signed('-0.25'),-250000n);
  assert.equal(quantity.minorTotal(101,'0.25'),25);
  assert.equal(quantity.minorTotal(101,'0.5'),51);
});

test('native retail checkout and returns accept fractional increments without changing integer payloads',()=>{
  const productId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',requestId='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const order=retailCommerce.checkoutInput({requestId,lines:[{id:productId,quantity:'0.25'}],fulfillment:'pickup',
    expectedTotal:250,name:'Test buyer',phone:'+974 5555 5555'});
  assert.deepEqual(order.lines,[{id:productId,quantity:'0.25'}]);
  const returnRequest=retailCommerce.returnInput({requestId,restock:true,reason:'Synthetic return',lines:[{id:productId,quantity:'0.25'}]});
  assert.deepEqual(returnRequest.lines,[{id:productId,quantity:'0.25'}]);
  const legacy=retailCommerce.checkoutInput({requestId,lines:[{id:productId,quantity:1}],fulfillment:'pickup',
    expectedTotal:100,name:'Test buyer',phone:'+974 5555 5555'});
  assert.deepEqual(legacy.lines,[{id:productId,quantity:1}]);
});
