'use strict';

const fail=code=>{throw Object.assign(new Error(code),{code});};
const roles=Object.freeze(['agent','teamLeader','manager']);

function rates(input){
  if(!input||typeof input!=='object'||Array.isArray(input))fail('INVALID_COMMISSION_POLICY');
  const output={};
  for(const role of roles){
    const value=input[`${role}RateBps`];
    if(!Number.isSafeInteger(value)||value<0||value>10000)fail('INVALID_COMMISSION_RATE');
    output[role]=value;
  }
  if(output.agent+output.teamLeader+output.manager>10000)fail('COMMISSION_SPLIT_EXCEEDS_SALE');
  return output;
}

function calculate(grossMinor,inputRates){
  let gross;
  if((typeof grossMinor!=='string'&&typeof grossMinor!=='number')||!/^\d+$/.test(String(grossMinor)))fail('INVALID_SALE_AMOUNT');
  try{gross=BigInt(grossMinor);}catch{fail('INVALID_SALE_AMOUNT');}
  if(gross<=0n||gross>9000000000000000n)fail('INVALID_SALE_AMOUNT');
  const policy=rates(inputRates),parts=[];let allocated=0n,combinedRate=0n;
  for(const role of roles){
    const rate=BigInt(policy[role]);
    const numerator=gross*rate;
    const amount=numerator/10000n;
    allocated+=amount;combinedRate+=rate;
    parts.push({role,rateBps:Number(rate),amount,remainder:numerator%10000n});
  }
  // Round the combined payable once, then distribute leftover minor units by
  // the largest fractional remainder (stable role order breaks ties). This
  // prevents per-recipient rounding from making the commission exceed sales.
  const target=(gross*combinedRate+5000n)/10000n;
  let remaining=target-allocated;
  const priority=[...parts].sort((a,b)=>a.remainder===b.remainder?roles.indexOf(a.role)-roles.indexOf(b.role):a.remainder>b.remainder?-1:1);
  for(const part of priority){if(remaining<=0n)break;if(part.rateBps>0){part.amount+=1n;remaining-=1n;}}
  if(remaining!==0n)fail('COMMISSION_SPLIT_EXCEEDS_SALE');
  return {grossMinor:gross.toString(),commissionMinor:target.toString(),rows:parts.map(({role,rateBps,amount})=>({role,rateBps,amountMinor:amount.toString()}))};
}

module.exports={rates,calculate};
