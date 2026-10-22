(() => {
  'use strict';
  function fromTenantLocal(value,timeZone='Asia/Qatar'){
    const match=/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value||'');if(!match)throw Error('INVALID_VIEWING_TIME');
    const [year,month,day,hour,minute]=match.slice(1).map(Number),wall=Date.UTC(year,month-1,day,hour,minute);
    const format=new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
    const parts=date=>Object.fromEntries(format.formatToParts(date).filter(part=>part.type!=='literal').map(part=>[part.type,Number(part.value)]));
    const observed=parts(new Date(wall)),represented=Date.UTC(observed.year,observed.month-1,observed.day,observed.hour,observed.minute),candidate=wall-(represented-wall),verify=parts(new Date(candidate));
    if(verify.year!==year||verify.month!==month||verify.day!==day||verify.hour!==hour||verify.minute!==minute)throw Error('INVALID_VIEWING_TIME');
    for(const offset of [-60,60]){const alternate=parts(new Date(candidate+offset*60000));if(alternate.year===year&&alternate.month===month&&alternate.day===day&&alternate.hour===hour&&alternate.minute===minute)throw Error('INVALID_VIEWING_TIME_AMBIGUOUS');}
    return new Date(candidate).toISOString();
  }
  window.SaleMaxWorkspaceTime=Object.freeze({fromTenantLocal});
})();
