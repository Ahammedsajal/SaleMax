'use strict';
const {money}=require('./business-finance-context');

const palette={navy:'#10213D',blue:'#1768D4',cyan:'#12A9C7',teal:'#159879',pink:'#DF4A83',violet:'#8655D6',gold:'#F09A24',muted:'#63738A',line:'#DFE7F1',pale:'#F3F6FB',red:'#A92C36',green:'#23623A'};
const count=value=>Number(value||0).toLocaleString('en-QA');
const safe=value=>String(value??'—').replace(/[\r\n\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim();
const rate=(value,base)=>Number(base)>0?`${Math.round(Number(value||0)*100/Number(base))}%`:'—';
const formatMoney=(value,currency='QAR')=>{try{return money(value||0,currency);}catch{return `— ${currency}`;}};
const pctMinor=(value,base)=>{try{const den=BigInt(base||0);return den>0n?`${BigInt(value||0)*100n/den}%`:'—';}catch{return '—';}};

function header(doc,s,title){
  doc.rect(0,0,595,104).fill(palette.navy);
  doc.rect(0,101,595,3).fill(palette.cyan);
  doc.fillColor(palette.cyan).font('Helvetica-Bold').fontSize(10).text('7NETWORK  /  OWNER REPORT',40,21,{lineBreak:false});
  doc.fillColor('#FFFFFF').fontSize(21).text(title,40,39,{width:515,ellipsis:true,lineBreak:false});
  const reportDate=(value,{end=false}={})=>{if(!value)return '—';const raw=String(value),instant=new Date(/(?:Z|[+-]\d{2}:?\d{2})$/i.test(raw)?raw:`${raw.replace(' ','T')}Z`);if(end)instant.setMilliseconds(instant.getMilliseconds()-1);return new Intl.DateTimeFormat('en-QA',{dateStyle:'medium',timeZone:s.timezone||'Asia/Qatar'}).format(instant);};
  const from=reportDate(s.from),to=reportDate(s.to,{end:true}),range=from===to?from:`${from} – ${to}`;
  doc.fillColor('#D9E4F3').font('Helvetica').fontSize(9).text(`${range}  ·  ${s.timezone||'Asia/Qatar'}`,40,69,{width:515,lineBreak:false});
  const generated=s.generatedAt?new Intl.DateTimeFormat('en-QA',{dateStyle:'medium',timeStyle:'short',timeZone:s.timezone||'Asia/Qatar'}).format(new Date(s.generatedAt)):safe(s.asOf||'');
  doc.fillColor('#AFC3DB').fontSize(8).text(`Prepared ${generated}`,40,84,{width:515,lineBreak:false});
}
function footer(doc,s){
  const range=doc.bufferedPageRange();
  for(let page=0;page<range.count;page++){
    doc.switchToPage(page);doc.moveTo(40,798).lineTo(555,798).strokeColor(palette.line).stroke();
    doc.fillColor(palette.muted).font('Helvetica').fontSize(7).text(`Private owner report · ${safe(s.business||'7Network')} · Page ${page+1} of ${range.count}`,40,808,{width:515,align:'center',lineBreak:false});
  }
}
function heading(doc,label,y){
  doc.fillColor(palette.navy).font('Helvetica-Bold').fontSize(12).text(label,40,y,{width:515,lineBreak:false});
  doc.roundedRect(40,y+18,26,3,1.5).fill(palette.cyan);
}
function card(doc,x,y,w,label,value,color=palette.blue,note=''){
  doc.roundedRect(x,y,w,60,8).fillAndStroke('#FFFFFF',palette.line);
  doc.roundedRect(x,y,w,4,2).fill(color);
  doc.fillColor(palette.muted).font('Helvetica-Bold').fontSize(7.3).text(safe(label),x+10,y+12,{width:w-20,height:10,lineBreak:false,ellipsis:true});
  const valueText=safe(value),available=w-20,valueWidth=doc.font('Helvetica-Bold').fontSize(17).widthOfString(valueText),valueFont=valueWidth>available?Math.max(8.5,17*available/valueWidth):17;
  doc.fillColor(palette.navy).font('Helvetica-Bold').fontSize(valueFont).text(valueText,x+10,y+25,{width:available,height:21,lineBreak:false});
  if(note)doc.fillColor(palette.muted).font('Helvetica').fontSize(6.6).text(safe(note),x+10,y+47,{width:w-20,height:8,lineBreak:false,ellipsis:true});
}
function table(doc,{x=40,y,widths,headers,rows,rowHeight=22,fontSize=7.1}){
  const total=widths.reduce((sum,width)=>sum+width,0),headHeight=24;
  doc.roundedRect(x,y,total,headHeight,5).fill(palette.navy);
  let cursor=x;
  headers.forEach((label,index)=>{doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(7).text(safe(label),cursor+6,y+8,{width:widths[index]-10,height:10,lineBreak:false,ellipsis:true});cursor+=widths[index];});
  let rowY=y+headHeight;
  rows.forEach((row,rowIndex)=>{
    doc.rect(x,rowY,total,rowHeight).fill(rowIndex%2?'#FFFFFF':'#F7F9FC');
    doc.moveTo(x,rowY+rowHeight).lineTo(x+total,rowY+rowHeight).strokeColor(palette.line).lineWidth(.45).stroke();
    cursor=x;
    row.forEach((value,index)=>{doc.fillColor(index===0?palette.navy:palette.muted).font(index===0?'Helvetica-Bold':'Helvetica').fontSize(fontSize).text(safe(value),cursor+6,rowY+7,{width:widths[index]-10,height:rowHeight-8,lineBreak:false,ellipsis:true});cursor+=widths[index];});
    rowY+=rowHeight;
  });
  return rowY;
}
function drawDonutSegment(doc,cx,cy,outer,inner,start,end,color){
  const point=(r,a)=>[cx+r*Math.cos(a),cy+r*Math.sin(a)];
  const arc=(r,a,b,move)=>{
    const pieces=Math.max(1,Math.ceil(Math.abs(b-a)/(Math.PI/2))),step=(b-a)/pieces;
    let current=a;
    for(let i=0;i<pieces;i++){
      const next=current+step,k=4/3*Math.tan((next-current)/4),p0=point(r,current),p3=point(r,next);
      const d0=[-Math.sin(current),Math.cos(current)],d1=[-Math.sin(next),Math.cos(next)];
      const p1=[p0[0]+k*r*d0[0],p0[1]+k*r*d0[1]],p2=[p3[0]-k*r*d1[0],p3[1]-k*r*d1[1]];
      if(move)doc.moveTo(p0[0],p0[1]);doc.bezierCurveTo(p1[0],p1[1],p2[0],p2[1],p3[0],p3[1]);move=false;current=next;
    }
  };
  const outerStart=point(outer,start),innerEnd=point(inner,end);
  doc.moveTo(outerStart[0],outerStart[1]);arc(outer,start,end,false);doc.lineTo(innerEnd[0],innerEnd[1]);arc(inner,end,start,false);doc.closePath().fill(color);
}
function donut(doc,{cx,cy,outer=34,inner=22,done=0,remaining=0}){
  const total=Number(done)+Number(remaining);doc.circle(cx,cy,outer).fill('#EDF1F6');
  if(total>0&&done>0)drawDonutSegment(doc,cx,cy,outer,inner,-Math.PI/2,-Math.PI/2+2*Math.PI*Math.min(1,done/total),palette.blue);
  if(total>0&&remaining>0)drawDonutSegment(doc,cx,cy,outer,inner,-Math.PI/2+2*Math.PI*Math.min(1,done/total),3*Math.PI/2,palette.pink);
  doc.circle(cx,cy,inner-1).fill('#FFFFFF');doc.fillColor(palette.navy).font('Helvetica-Bold').fontSize(12).text(count(total),cx-24,cy-7,{width:48,align:'center',lineBreak:false});
}
function drawLeadTrend(doc,s,y){
  const items=Array.isArray(s.leadIntakeDaily)?s.leadIntakeDaily.filter(row=>row?.date):[];
  const days=items.length?items:[{date:s.from||s.day,total:s.summary?.leadsCreated||s.daily?.leads||0}];
  const chartX=48,chartW=340,base=y+82,plotH=62,max=Math.max(1,...days.map(row=>Number(row.total||0))),barW=Math.min(30,(chartW-20)/Math.max(1,days.length)-8),gap=(chartW-days.length*barW)/Math.max(1,days.length);
  doc.moveTo(chartX,base).lineTo(chartX+chartW,base).strokeColor(palette.line).lineWidth(.8).stroke();
  days.forEach((row,index)=>{
    const x=chartX+index*(barW+gap)+gap/2,h=Math.max(2,Number(row.total||0)/max*plotH),color=[palette.blue,palette.cyan,palette.violet,palette.pink,palette.teal,palette.gold][index%6];
    doc.roundedRect(x,base-h,barW,h,4).fill(color);doc.fillColor(palette.navy).font('Helvetica-Bold').fontSize(7).text(count(row.total),x-8,base-h-13,{width:barW+16,align:'center',lineBreak:false});
    doc.fillColor(palette.muted).font('Helvetica').fontSize(6.5).text(String(row.date||'').slice(5),x-10,base+7,{width:barW+20,align:'center',lineBreak:false});
  });
}
function drawFunnel(doc,s,y){
  const funnel=s.journey?.cohortFunnel||{},steps=[['New leads',funnel.newLeads],['Contacted',funnel.attended],['Qualified / interested',funnel.interested],['Follow-up',funnel.followUp],['Applications',funnel.applications],['Sales / enrollments',funnel.salesConverted],['Invoices issued',funnel.invoicesIssued],['Payments received',funnel.paymentReceived]],total=Math.max(1,Number(funnel.newLeads||0));
  doc.fillColor(palette.muted).font('Helvetica-Bold').fontSize(7).text('STAGE',46,y,{width:105,lineBreak:false});doc.text('VOLUME',164,y,{width:245,lineBreak:false});doc.text('COUNT',420,y,{width:52,align:'right',lineBreak:false});doc.text('FROM PRIOR',477,y,{width:72,align:'right',lineBreak:false});
  y+=15;const max=Math.max(1,Number(funnel.newLeads||0));
  steps.forEach(([label,raw],index)=>{
    const value=Number(raw||0),previous=index?Number(steps[index-1][1]||0):0,barW=250*value/max,color=[palette.blue,palette.cyan,palette.violet,palette.gold,palette.pink,palette.teal][index%6];
    doc.fillColor(palette.navy).font(index===0?'Helvetica-Bold':'Helvetica').fontSize(7.3).text(label,46,y+4,{width:112,height:10,lineBreak:false,ellipsis:true});
    doc.roundedRect(164,y+3,250,10,5).fill('#EDF1F6');if(value>0)doc.roundedRect(164,y+3,Math.max(3,barW),10,5).fill(color);
    doc.fillColor(palette.navy).font('Helvetica-Bold').fontSize(7).text(count(value),420,y+4,{width:52,align:'right',lineBreak:false});
    doc.fillColor(palette.muted).font('Helvetica').fontSize(7).text(index?rate(value,previous):rate(value,total),477,y+4,{width:72,align:'right',lineBreak:false});y+=25;
  });
}
function reportFunnelRate(snapshot){const funnel=snapshot.journey?.cohortFunnel||{};return rate(funnel.attended,funnel.newLeads);}
function renderTrainingReport(s,{test=false,receivableActions=[]}={}){
  const periodName=s.period==='weekly'?'weekly':s.period==='monthly'?'monthly':'daily';
  const {PDFDocument}=require('pdfkit'),doc=new PDFDocument({size:'A4',margin:0,bufferPages:true,info:{Title:`${test?'Sample ':''}7Network ${periodName} owner report · ${s.from||s.day}`,Author:'7Network'}});
  const chunks=[],done=new Promise((resolve,reject)=>{doc.on('data',chunk=>chunks.push(chunk));doc.once('end',()=>resolve(Buffer.concat(chunks)));doc.once('error',reject);});
  const summary=s.summary||{},current=s.current||{},journey=s.journey||{},funnel=journey.cohortFunnel||{},finance=s.finance||{},currency=finance.currency||'QAR';

  header(doc,s,`${test?'Sample ':''}${periodName[0].toUpperCase()+periodName.slice(1)} owner report`);
  if(test){doc.fillColor(palette.red).font('Helvetica-Bold').fontSize(8).text('SAMPLE DATA — NOT A CUSTOMER REPORT',40,112,{lineBreak:false});}
  const cardTop=test?130:120,cardW=164,gap=11;
  const kpis=[
    [s.period==='daily'?'New leads today':'New leads in period',count(summary.leadsCreated),s.period==='daily'?'daily intake':'selected period',palette.blue],
    ['Contacted',count(summary.newLeadsContacted),`${reportFunnelRate(s)} of new leads`,palette.cyan],
    ['Open unmessaged',count(current.unattended),'needs assignment or contact',palette.pink],
    ['Hot · 72h+',count(current.hotLeadsNoFollowUp),'no later follow-up',palette.violet],
    ['Overdue follow-ups',count(summary.followUpsOverdue),'due tasks to clear',palette.gold],
    ['Sales closed',count(funnel.salesConverted),'sales / enrollments',palette.teal]
  ];
  kpis.forEach((item,index)=>card(doc,40+(index%3)*(cardW+gap),cardTop+Math.floor(index/3)*70,cardW,item[0],item[1],item[3],item[2]));

  heading(doc,periodName==='weekly'?'Leads received · week by day':'Leads received · last 7 days',cardTop+151);drawLeadTrend(doc,s,cardTop+174);
  const contacted=Number(summary.newLeadsContacted||0),untouched=Number(summary.newLeadsUntouched||0),donutY=cardTop+219;
  donut(doc,{cx:470,cy:donutY,done:contacted,remaining:untouched});
  doc.fillColor(palette.blue).circle(427,donutY+49,4).fill();doc.fillColor(palette.muted).font('Helvetica').fontSize(6.6).text(`Contacted ${count(contacted)}`,437,donutY+45,{width:110,lineBreak:false});
  doc.fillColor(palette.pink).circle(427,donutY+61,4).fill();doc.fillColor(palette.muted).fontSize(6.6).text(`No message ${count(untouched)}`,437,donutY+57,{width:110,lineBreak:false});
  doc.fillColor(palette.muted).fontSize(6.2).text('Counts outbound messages from any linked QR or Meta device.',408,donutY+70,{width:145,lineBreak:false,ellipsis:true});

  heading(doc,'Lead journey · count and conversion from previous step',cardTop+310);drawFunnel(doc,s,cardTop+334);
  doc.fillColor(palette.muted).font('Helvetica').fontSize(7).text('Payments show receipt count. Hot lead = interested lead with no later contact or outcome for at least 72 hours.',40,cardTop+555,{width:515,lineBreak:false,ellipsis:true});

  doc.addPage({size:'A4',margin:0});header(doc,s,'Lead follow-through & course activity');
  heading(doc,'Open-work snapshot',120);
  const age=current.leadAge||{},firstContact=current.firstContact||{};
  const health=[
    ['Unassigned',count(current.unassigned),'live leads',palette.gold],
    ['Open · no message',count(current.unattended),'linked QR / Meta',palette.pink],
    ['Hot · 72h+',count(current.hotLeadsNoFollowUp),'no later follow-up',palette.violet],
    ['Avg. first contact',firstContact.averageMinutes==null?'—':`${count(firstContact.averageMinutes)} min`,`${count(firstContact.count)} reached`,palette.cyan],
    ['Follow-ups due',count(summary.followUpsDue),'this period',palette.blue],
    ['Follow-ups overdue',count(summary.followUpsOverdue),'this period',palette.red]
  ];
  health.forEach((item,index)=>card(doc,40+(index%3)*(cardW+gap),145+Math.floor(index/3)*68,cardW,item[0],item[1],item[3],item[2]));
  doc.fillColor(palette.muted).font('Helvetica').fontSize(7).text(`Open-lead age · <1 day ${count(age.underOneDay)}   ·   1–3 days ${count(age.oneToThreeDays)}   ·   4–7 days ${count(age.fourToSevenDays)}   ·   >7 days ${count(age.overSevenDays)}`,40,290,{width:515,lineBreak:false,ellipsis:true});
  doc.fillColor(palette.navy).font('Helvetica-Bold').fontSize(7).text(`Month to date · ${count(current.month)} new leads   ·   ${count(current.salesConvertedMonth)} sales converted`,40,303,{width:515,lineBreak:false,ellipsis:true});

  heading(doc,'Team activity',323);
  const businessUsers=journey.businessUsers||[],userRows=users=>users.map(user=>[user.attribution==='account_role'?'Manager':user.userName||'Business account','—',count(user.attendedLeads),count(user.messagesSent),'—',count(user.salesClosed)]);
  const managerRows=userRows(businessUsers.filter(user=>user.attribution==='account_role'));
  const namedRows=userRows(businessUsers.filter(user=>user.attribution!=='account_role'));
  const agentRows=(journey.agents||[]).map(agent=>[agent.agentName||'Agent',count(agent.assignedLeads),count(agent.attendedLeads),count(agent.agentReplies),count(agent.followUpsOverdue),count(agent.salesClosedByAgent)]);
  const teamRows=[...managerRows,...agentRows,...namedRows].slice(0,8);
  const teamEnd=table(doc,{y:348,widths:[137,58,77,77,83,72],headers:['Agent / manager','Assigned','Leads messaged','Messages sent','Overdue tasks','Sales closed'],rows:teamRows,rowHeight:21,fontSize:6.8});
  if((journey.businessUsers||[]).some(user=>user.attribution==='account_role'))doc.fillColor(palette.muted).font('Helvetica').fontSize(6.6).text('Manager totals are account-level; older messages do not retain an individual sender ID.',40,teamEnd+4,{width:515,lineBreak:false,ellipsis:true});
  let cohortY=Math.max(teamEnd+25,teamEnd+8+(journey.businessUsers?.some(user=>user.attribution==='account_role')?12:0));
  heading(doc,'Course cohorts',cohortY);cohortY+=24;
  const cohorts=(s.courseCohorts||[]).slice(0,6),cohortRows=cohorts.map(row=>[row.courseName||'Course',row.cohortCode||'—',row.startsOn||'—',count(row.enrollmentsInPeriod),`${count(row.seatsFilled)}/${count(row.capacity)}`,count(row.cancelledTotal)]);
  const courseEnd=table(doc,{y:cohortY,widths:[129,63,68,72,75,97],headers:['Course','Cohort','Start','Enrollments','Filled / cap.','Cancelled'],rows:cohortRows,rowHeight:20,fontSize:6.8});
  if(!cohorts.length)doc.fillColor(palette.muted).font('Helvetica').fontSize(8).text('No cohort capacity data was available for this period.',46,cohortY+31,{width:500,lineBreak:false});
  const courseNoteY=Math.max(courseEnd+12,cohortY+(cohorts.length?0:49));
  doc.fillColor(palette.muted).font('Helvetica').fontSize(7).text('Course enquiries are not yet linked to a normalized course field.',40,courseNoteY,{width:515,lineBreak:false});

  doc.addPage({size:'A4',margin:0});header(doc,s,'Collections & owner actions');
  heading(doc,'Revenue and receivables',120);
  const financeCards=[
    ['Invoices issued',count(finance.issuedInvoiceCount),formatMoney(finance.billedMinor,currency),palette.blue],
    ['Payments received',formatMoney(finance.cashReceivedMinor,currency),`${count(finance.paymentsReceivedCount)} receipts`,palette.cyan],
    ['Sales credited',formatMoney(finance.creditsIssuedMinor,currency),'credit notes',palette.violet],
    ['Refunds paid',formatMoney(finance.refundsPaidMinor,currency),'cash returned',palette.pink],
    ['Total receivables',formatMoney(finance.allOutstandingMinor,currency),'current open balance',palette.teal],
    ['Overdue',formatMoney(finance.overdueReceivablesMinor,currency),'included in receivables',palette.red]
  ];
  financeCards.forEach((item,index)=>card(doc,40+(index%3)*(cardW+gap),145+Math.floor(index/3)*68,cardW,item[0],item[1],item[3],item[2]));
  const collectionRate=pctMinor(finance.collectedOnPeriodIssuedInvoicesMinor,finance.billedMinor);
  doc.fillColor(palette.navy).font('Helvetica-Bold').fontSize(8).text(`Collection rate ${collectionRate}`,40,291,{width:220,lineBreak:false});
  doc.fillColor(palette.muted).font('Helvetica').fontSize(7).text(`Overdue is included in receivables. Monthly target: not configured.`,245,292,{width:310,lineBreak:false,ellipsis:true});
  const monthly=(s.monthlyFinance||[]).find(row=>row.currency===currency);
  if(monthly)doc.fillColor(palette.navy).font('Helvetica-Bold').fontSize(7).text(`Month to date · billed ${formatMoney(monthly.month?.invoiced,currency)}   ·   received ${formatMoney(monthly.month?.received,currency)}`,40,306,{width:515,lineBreak:false,ellipsis:true});

  heading(doc,'Receivables by age',monthly?329:321);
  const aging=finance.receivablesAging||{},agingRows=[['Not overdue',aging.current?.outstandingMinor],['1–30 days',aging['1-30']?.outstandingMinor],['31–60 days',aging['31-60']?.outstandingMinor],['61–90 days',aging['61-90']?.outstandingMinor],['90+ days',aging['90+']?.outstandingMinor]];
  const agingMax=Math.max(1,...agingRows.map(([,value])=>Number(value||0)));
  const agingY=monthly?356:348;
  agingRows.forEach(([label,value],index)=>{const y=agingY+index*20,w=Number(value||0)/agingMax*250,color=index===0?palette.teal:index<3?palette.gold:palette.red;doc.fillColor(palette.muted).font('Helvetica').fontSize(7.2).text(label,46,y+4,{width:80,lineBreak:false});doc.roundedRect(132,y+3,250,9,4).fill('#EDF1F6');if(Number(value||0)>0)doc.roundedRect(132,y+3,Math.max(3,w),9,4).fill(color);doc.fillColor(palette.navy).font('Helvetica-Bold').fontSize(7).text(formatMoney(value,currency),392,y+4,{width:155,align:'right',lineBreak:false});});
  const actionHeadingY=monthly?471:463;
  heading(doc,'Top overdue invoices · owner follow-up',actionHeadingY);
  const actionRows=(receivableActions||[]).slice(0,3).map(row=>[row.payerName,row.invoiceNumber,formatMoney(row.amountMinor,currency),`${count(row.daysOverdue)} days`,row.salesperson,row.nextAction]);
  table(doc,{y:actionHeadingY+25,widths:[94,71,79,55,92,113],headers:['Customer','Invoice','Balance','Late','Owner','Next step'],rows:actionRows,rowHeight:23,fontSize:6.5});
  if(!actionRows.length)doc.fillColor(palette.muted).font('Helvetica').fontSize(7.5).text('No overdue invoice follow-up details were available.',46,actionHeadingY+58,{width:500,lineBreak:false});
  const prior=s.period==='weekly'?s.comparisons?.previousWeek:s.period==='monthly'?s.comparisons?.previousMonth:(s.comparisons?.yesterday||s.comparisons?.sameWeekdayLastWeek);
  if(prior){
    const priorStart=String(prior.from||''),priorInstant=new Date(/(?:Z|[+-]\d{2}:?\d{2})$/i.test(priorStart)?priorStart:`${priorStart.replace(' ','T')}Z`),priorDate=Number.isNaN(priorInstant.getTime())?'previous report':new Intl.DateTimeFormat('en-QA',{dateStyle:'medium',timeZone:s.timezone||'Asia/Qatar'}).format(priorInstant);
    heading(doc,`Compared with ${priorDate}`,602);
    const pSummary=prior.summary||{},pFunnel=prior.journey?.cohortFunnel||{},pFinance=prior.finance||{};
    const comparisons=[
      ['New leads',count(summary.leadsCreated),count(pSummary.leadsCreated)],
      ['Applications',count(funnel.applications),count(pFunnel.applications)],
      ['Sales closed',count(funnel.salesConverted),count(pFunnel.salesConverted)],
      ['Cash received',formatMoney(finance.cashReceivedMinor,currency),formatMoney(pFinance.cashReceivedMinor,currency)],
      ['Overdue balance',formatMoney(finance.overdueReceivablesMinor,currency),formatMoney(pFinance.overdueReceivablesMinor,currency)]
    ];
    table(doc,{y:627,widths:[205,155,144],headers:['Metric','This report',`Prior · ${priorDate}`],rows:comparisons,rowHeight:19,fontSize:6.8});
  }
  const range=doc.bufferedPageRange();for(let page=0;page<range.count;page++){doc.switchToPage(page);doc.moveTo(40,798).lineTo(555,798).strokeColor(palette.line).stroke();doc.fillColor(palette.muted).font('Helvetica').fontSize(7).text(`Private owner report · ${safe(s.business||'7Network')} · Page ${page+1} of ${range.count}`,40,808,{width:515,align:'center',lineBreak:false});}
  doc.end();return done;
}

module.exports={render:renderTrainingReport};
