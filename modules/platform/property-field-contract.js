'use strict';
const fields=require('./custom-field-contract');
const scope='property';
module.exports={
 types:fields.types,
 definitions:input=>fields.definitions(input,scope),
 valueFor:(field,value)=>fields.valueFor(field,value,scope),
 save:(contract,input,prior)=>fields.save(contract,input,prior,scope),
 publicContract:configuration=>fields.publicContract(configuration,scope),
 MAX_HISTORY_ENTRIES:fields.MAX_HISTORY_ENTRIES,
 MAX_HISTORY_BYTES:fields.MAX_HISTORY_BYTES,
};
