'use strict';
const {money}=require('./business-finance-context');
async function render(s,{test=false}={}){
 const {PDFDocument}=require('pdfkit');const title=`${s.business}_sale summary report`;
 const doc=new PDFDocument({size:'A4',margin:40,bufferPages:true,info:{Title:`${test?'Sample ':''}${title} · ${s.day}`,Author:'7Network'}});
 const chunks=[];const done=new Promise((resolve,reject)=>{doc.on('data',b=>chunks.push(b));doc.once('end',()=>resolve(Buffer.concat(chunks)));doc.once('error',reject);});
 const navy='#10213D',blue='#1768D4',muted='#63738A',line='#DFE7F1',pale='#F3F6FB',red='#A92C36',width=515;
 const pageTop=52;
 doc.rect(0,0,595,158).fill(navy);doc.fillColor('#52D5EB').font('Helvetica-Bold').fontSize(13).text('7NETWORK  /  SALES SUMMARY',40,31);
 doc.fillColor('white').fontSize(25).text(test?'Sample sales summary':`${s.business} · Sales summary`,40,62,{width,ellipsis:true});
 doc.font('Helvetica').fontSize(11).fillColor('#D9E4F3').text(`Daily report · ${s.day}  |  Month to date · ${s.month}`,40,102);
 doc.fontSize(9).text(`${s.timezone}  ·  Prepared ${s.asOf}`,40,126);
 if(test){doc.fillColor('#A92C36').font('Helvetica-Bold').fontSize(9).text('SAMPLE DATA — NOT A REAL CUSTOMER REPORT',40,170);doc.y=192;}else doc.y=181;
 const metricCard=(x,y,w,label,value,color=navy)=>{doc.roundedRect(x,y,w,65,8).fill(pale);doc.fillColor(muted).font('Helvetica-Bold').fontSize(8).text(label,x+12,y+12,{width:w-24});doc.fillColor(color).fontSize(21).text(String(value??0),x+12,y+31,{width:w-24});};
 const heading=(label,y)=>{doc.fillColor(navy).font('Helvetica-Bold').fontSize(16).text(label,40,y);};
 const cards=(items,y)=>items.forEach((v,i)=>metricCard(40+(i%2)*263,y+Math.floor(i/2)*76,250,v[0],v[1]));
 const d=s.daily||{},m=s.monthToDate||{};
 heading('Daily activity',181);cards([['NEW LEADS',d.leads],['LEADS INVOICED',d.convertedLeads],['APPLICATIONS',d.applications],['INVOICES ISSUED',d.invoices]],207);
 heading('Month to date',371);cards([['NEW LEADS',m.leads],['LEADS INVOICED',m.convertedLeads],['APPLICATIONS',m.applications],['INVOICES ISSUED',m.invoices]],397);
 heading('Invoice and payment activity',568);let activityY=597;
 for(const c of s.finance||[]){doc.fillColor(blue).font('Helvetica-Bold').fontSize(10).text(c.currency,48,activityY);activityY+=21;for(const [label,value] of [['Invoiced today',c.daily?.invoiced],['Payments received today',c.daily?.received],['Invoiced month to date',c.month?.invoiced],['Payments received month to date',c.month?.received]]){doc.fillColor(navy).font('Helvetica').fontSize(9).text(label,58,activityY);doc.font('Helvetica-Bold').text(money(value||0,c.currency),330,activityY,{width:205,align:'right'});activityY+=17;}}
 doc.addPage();heading('Receivables and aging',pageTop);
 doc.fillColor(muted).font('Helvetica').fontSize(9).text('Open balances are based on issued invoices, allocated receipts and posted credits. Overdue is part of the total receivable and is shown separately.',40,pageTop+24,{width});let receivableY=pageTop+51;
 for(const c of s.finance||[]){
  if(receivableY+440>755){doc.addPage();receivableY=pageTop;}
  doc.roundedRect(40,receivableY,width,29,5).fill(blue);doc.fillColor('white').font('Helvetica-Bold').fontSize(10).text(c.currency,53,receivableY+9);receivableY+=39;
  const total=c.receivable||0,overdue=c.overdue||0;
  doc.roundedRect(48,receivableY,240,66,8).fill('#EDF4FF');doc.roundedRect(307,receivableY,240,66,8).fill(overdue>0?'#FFF0F0':'#EDF7F1');
  doc.fillColor(muted).font('Helvetica-Bold').fontSize(8).text('TOTAL RECEIVABLE',61,receivableY+12);doc.fillColor(navy).fontSize(16).text(money(total,c.currency),61,receivableY+35,{width:210});
  doc.fillColor(muted).fontSize(8).text('OVERDUE · NEEDS ATTENTION',320,receivableY+12);doc.fillColor(overdue>0?red:'#23623A').fontSize(16).text(money(overdue,c.currency),320,receivableY+35,{width:210});receivableY+=80;
  for(const [label,value] of [['Invoiced today',c.daily?.invoiced],['Payments received today',c.daily?.received],['Invoiced month to date',c.month?.invoiced],['Payments received month to date',c.month?.received],['Receivable after receipts and credits',total],['Overdue total',overdue]]){
   doc.fillColor(label==='Overdue total'&&value>0?red:navy).font('Helvetica').fontSize(10).text(label,53,receivableY);doc.font('Helvetica-Bold').text(money(value||0,c.currency),330,receivableY,{width:205,align:'right'});doc.moveTo(53,receivableY+17).lineTo(542,receivableY+17).strokeColor(line).stroke();receivableY+=25;
  }
  for(const [label,key] of [['1–30 days','days1to30'],['31–60 days','days31to60'],['61–90 days','days61to90'],['Over 90 days','daysOver90']]){doc.fillColor(muted).font('Helvetica').fontSize(9).text(`Overdue ${label}`,70,receivableY);doc.fillColor(c.aging?.[key]>0?red:muted).font('Helvetica-Bold').text(money(c.aging?.[key]||0,c.currency),330,receivableY,{width:205,align:'right'});receivableY+=21;}
  receivableY+=13;
 }
 if(!(s.finance||[]).length){doc.fillColor(muted).font('Helvetica').fontSize(11).text('No invoice balances are available for this reporting period.');}
 const range=doc.bufferedPageRange();for(let p=0;p<range.count;p++){doc.switchToPage(p);doc.font('Helvetica').fontSize(8).fillColor(muted).text(`Private owner report · ${s.business} · Page ${p+1} of ${range.count}`,40,790,{width,align:'center',lineBreak:false});}
 doc.end();return done;
}
module.exports={render};
