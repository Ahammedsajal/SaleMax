'use strict';
const fields=require('./custom-field-contract');
const scope='lead';
module.exports={
 types:fields.types,
 definitions:input=>fields.definitions(input,scope),
 valueFor:(field,value)=>fields.valueFor(field,value,scope),
 save:(contract,input,prior)=>fields.save(contract,input,prior,scope),
 publicContract:configuration=>fields.publicContract(configuration,scope),
};
