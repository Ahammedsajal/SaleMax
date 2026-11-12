'use strict';

const DIAL_PLANS=Object.freeze({
  QA:Object.freeze({callingCode:'974',nationalNumberLength:8}),
});

function dialString(value){
  const number=String(value||'').trim();
  if(number.length>17)return null;
  return /^\+[1-9][0-9]{7,14}$/.test(number)||/^00[1-9][0-9]{7,14}$/.test(number)
    ||/^[0-9]{7,15}$/.test(number)?number:null;
}

function normalizeOutboundNumber(value,countryCode){
  const number=dialString(value);
  if(!number)return null;
  if(/^\+[1-9][0-9]{7,14}$/.test(number))return number;
  if(/^00[1-9][0-9]{7,14}$/.test(number))return `+${number.slice(2)}`;
  const plan=DIAL_PLANS[String(countryCode||'').toUpperCase()];
  if(plan&&new RegExp(`^[0-9]{${plan.nationalNumberLength}}$`).test(number))return `+${plan.callingCode}${number}`;
  return null;
}

function phoneDigitsForMatch(value){
  const raw=String(value||'').trim();
  if(!raw||raw.length>64)return null;
  let digits=raw.replace(/\D/g,'');
  if(digits.startsWith('00'))digits=digits.slice(2);
  return /^[0-9]{7,15}$/.test(digits)&&!/^0+$/.test(digits)?digits:null;
}

function phoneDigitsCandidatesForMatch(value,countryCode){
  const digits=phoneDigitsForMatch(value);
  if(!digits)return [];
  const candidates=new Set([digits]);
  const plan=DIAL_PLANS[String(countryCode||'').toUpperCase()];
  if(plan){
    const national=new RegExp(`^[0-9]{${plan.nationalNumberLength}}$`);
    const international=new RegExp(`^${plan.callingCode}[0-9]{${plan.nationalNumberLength}}$`);
    if(international.test(digits))candidates.add(digits.slice(plan.callingCode.length));
    else if(national.test(digits))candidates.add(`${plan.callingCode}${digits}`);
  }
  return [...candidates];
}

module.exports={dialString,normalizeOutboundNumber,phoneDigitsForMatch,phoneDigitsCandidatesForMatch};
