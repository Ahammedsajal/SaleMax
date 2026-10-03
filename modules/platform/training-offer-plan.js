'use strict';
function addMonths(value,months){const [year,month,day]=value.split('-').map(Number),absolute=year*12+month-1+months,targetYear=Math.floor(absolute/12),targetMonth=absolute%12+1,lastDay=new Date(Date.UTC(targetYear,targetMonth,0)).getUTCDate();return `${targetYear}-${String(targetMonth).padStart(2,'0')}-${String(Math.min(day,lastDay)).padStart(2,'0')}`;}
function expectedSchedule(totalMinor,count,interval,firstDueDate){
  if(!Number.isSafeInteger(totalMinor)||totalMinor<1||!Number.isSafeInteger(Number(count))||count<1||count>12||typeof firstDueDate!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(firstDueDate))return null;
  count=Number(count);if((count===1&&interval!=='once')||(count>1&&!['weekly','monthly'].includes(interval)))return null;
  return Array.from({length:count},(_,index)=>({dueDate:interval==='monthly'?addMonths(firstDueDate,index):(()=>{const date=new Date(firstDueDate+'T00:00:00Z');date.setUTCDate(date.getUTCDate()+index*7);return date.toISOString().slice(0,10);})(),amountMinor:Math.floor(totalMinor/count)+(index===count-1?totalMinor%count:0)}));
}
function matchesSchedule(schedule,totalMinor,count,interval){if(!Array.isArray(schedule)||!schedule.length)return false;const expected=expectedSchedule(totalMinor,count,interval,schedule[0].dueDate);return !!expected&&schedule.length===expected.length&&schedule.every((item,index)=>item.dueDate===expected[index].dueDate&&item.amountMinor===expected[index].amountMinor);}
module.exports={expectedSchedule,matchesSchedule};
