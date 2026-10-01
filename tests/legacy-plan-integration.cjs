const assert = require('node:assert/strict');
const inventory = require('../docs/LEGACY_SCHEMA_INVENTORY.json');
const {createHandlers} = require('../modules/platform/legacy-plan-editor');
module.exports = async connection => {
  // Build the preserved plan table from the row-free source inventory in the
  // disposable test database, not from imported customer records.
  const entries = Array.isArray(inventory) ? inventory : inventory.columns;
  const columns = entries.filter(column=>column.tableName==='plan');
  assert.ok(columns.length >= 15);
  await connection.query(`CREATE TABLE plan (${columns.map(column=>`\`${column.columnName}\` ${column.columnType} ${column.nullable==='NO'?'NOT NULL':''} ${column.columnKey==='PRI'?'PRIMARY KEY':''} ${column.extra==='auto_increment'?'AUTO_INCREMENT':''} ${column.columnName==='createdAt'?'DEFAULT CURRENT_TIMESTAMP':''}`).join(',')})`);
  const query=async(sql,args)=>{const [rows]=await connection.query(sql,args);return rows;};
  const handlers=createHandlers(query);
  let response;const res={json:value=>{response=value;}};
  const body={title:'Synthetic catalogue',short_description:'Synthetic only',price:'250',price_strike:'300.50',plan_duration_in_days:'30',contact_limit:'100',qr_account:'2',allow_tag:'0',allow_note:true};
  await handlers.add({body},res);assert.equal(response.success,true);
  const [[plan]]=await connection.query('SELECT * FROM plan');
  assert.equal(plan.allow_tag,0);assert.equal(plan.allow_note,1);assert.equal(Number(plan.price),250);
  await handlers.edit({body:{...body,id:plan.id,title:'Updated catalogue',price:'251',qr_account:'3'}},res);
  assert.equal(response.success,true);
  const [[updated]]=await connection.query('SELECT * FROM plan WHERE id=?',[plan.id]);
  assert.equal(updated.title,'Updated catalogue');assert.equal(updated.qr_account,3);
  await handlers.edit({body:{...body,id:plan.id,price:'250.50'}},res);
  assert.equal(response.code,'INVALID_PLAN');
  const [[unchanged]]=await connection.query('SELECT price FROM plan WHERE id=?',[plan.id]);assert.equal(Number(unchanged.price),251);
  await handlers.edit({body:{...body,id:plan.id,is_trial:'1'}},res);assert.equal(response.success,true);
  const [[trial]]=await connection.query('SELECT id,price,is_trial FROM plan WHERE id=?',[plan.id]);
  assert.equal(trial.id,plan.id);assert.equal(Number(trial.price),0);assert.equal(trial.is_trial,1);
  return {existingCatalogueMariaDbCreateEdit:true,legacyFractionalPriceRejectedBeforeWrite:true};
};
