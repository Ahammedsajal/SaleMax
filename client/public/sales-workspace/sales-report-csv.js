(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.SaleMaXSalesReportCsv=api;
})(typeof globalThis==='object'?globalThis:this,function(){
  'use strict';

  function integer(value,label,{optional=false}={}){
    if((value===null||value===undefined||value==='')&&optional)return '';
    const normalized=String(value);
    if(!/^\d{1,18}$/.test(normalized))throw new TypeError(`Invalid ${label}`);
    return normalized;
  }

  function csvCell(value,{text=false}={}){
    let normalized=String(value??'');
    if(text&&/^[\t\r\n ]*[=+\-@]/u.test(normalized))normalized=`'${normalized}`;
    return `"${normalized.replace(/"/g,'""')}"`;
  }

  function decimalAmount(minor,currency){
    const code=String(currency||'').toUpperCase();
    if(!/^[A-Z]{3}$/.test(code))throw new TypeError('Invalid report currency');
    const amount=BigInt(integer(minor,'sales amount',{optional:true})||'0');
    const places=new Intl.NumberFormat('en',{style:'currency',currency:code}).resolvedOptions().maximumFractionDigits;
    const base=10n**BigInt(places),whole=amount/base;
    if(!places)return String(whole);
    return `${whole}.${String(amount%base).padStart(places,'0')}`;
  }

  function rowsFor(period,members){
    if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(String(period||'')))throw new TypeError('Invalid report period');
    if(!Array.isArray(members))throw new TypeError('Invalid report members');
    const rows=[];
    for(const member of members){
      const calls=integer(member?.actual?.connectedCalls??0,'connected calls');
      const callTarget=integer(member?.targets?.connectedCalls,'call target',{optional:true});
      const sales=Array.isArray(member?.targets?.salesByCurrency)?member.targets.salesByCurrency:[];
      const commissions=Array.isArray(member?.commissionsByCurrency)?member.commissionsByCurrency:[];
      const byCurrency=new Map(sales.map(row=>[String(row.currency||'').toUpperCase(),row]));
      for(const row of commissions){const code=String(row.currency||'').toUpperCase();if(!byCurrency.has(code))byCurrency.set(code,{currency:code,actualMinor:'',targetMinor:''});}
      const currencyRows=byCurrency.size?[...byCurrency.values()].sort((left,right)=>String(left.currency).localeCompare(String(right.currency))):[{currency:'',actualMinor:'',targetMinor:''}];
      for(const sale of currencyRows){
        const code=String(sale.currency||'').toUpperCase();
        if(code&&!/^[A-Z]{3}$/.test(code))throw new TypeError('Invalid report currency');
        const actual=sale.actualMinor===''?'':decimalAmount(sale.actualMinor,code);
        const target=sale.targetMinor==null||sale.targetMinor===''?'':decimalAmount(sale.targetMinor,code);
        const commission=commissions.find(row=>String(row.currency||'').toUpperCase()===code);
        rows.push([
          period,
          String(member.displayName||''),
          String(member.role||''),
          calls,
          callTarget,
          code,
          actual,
          target,
          commission?decimalAmount(commission.draftMinor,code):'',
          commission?decimalAmount(commission.approvedMinor,code):'',
          commission?decimalAmount(commission.paidMinor,code):'',
        ]);
      }
    }
    return rows;
  }

  function toCsv(period,members){
    const header=['report_month','team_member','role','connected_calls','monthly_call_target','currency','approved_sales','monthly_sales_target','commission_draft','commission_approved','commission_paid'];
    const lines=[header.map(value=>csvCell(value)).join(',')];
    for(const row of rowsFor(period,members)){
      lines.push(row.map((value,index)=>csvCell(value,{text:index===1||index===2})).join(','));
    }
    return `\uFEFF${lines.join('\r\n')}\r\n`;
  }

  return Object.freeze({rowsFor,toCsv});
});
