'use strict';
const {money}=require('./business-finance-context');
async function render(s,{test=false}={}){
 const {PDFDocument}=require('pdfkit');const doc=new PDFDocument({size:'A4',margin:40,bufferPages:true,info:{Title:`${test?'SAMPLE ':''}Daily business report - ${s.day}`,Author:'7Network'}});
 const chunks=[];const done=new Promise((resolve,reject)=>{doc.on('data',b=>chunks.push(b));doc.once('end',()=>resolve(Buffer.concat(chunks)));doc.once('error',reject);});
 const navy='#081630',blue='#1768D4',muted='#66758A',light='#F0F5FC',width=515;
 doc.rect(0,0,595,156).fill(navy);doc.fillColor('#12C9F4').font('Helvetica-Bold').fontSize(14).text('7Network  /  BUSINESS REPORT',40,34);
 doc.fillColor('white').fontSize(26).text(test?'Sample daily report':'Your day in business',40,65);
 doc.font('Helvetica').fontSize(11).text(`${s.business}  |  ${s.day}`,40,106,{width,height:15,ellipsis:true});
 doc.fillColor('#BCD0EB').fontSize(9).text(`${s.timezone}  ·  As of ${s.asOf}`,40,127,{width});
 if(test)doc.fillColor('#A94516').font('Helvetica-Bold').fontSize(10).text('TEST DATA — NOT A REAL INVOICE OR PAYMENT',40,173);
 const cards=[['NEW CHATS',s.newChats],['NEW LEADS',s.newLeads],['INVOICES',s.invoices],['PAYMENTS',s.payments]];
 cards.forEach(([label,value],i)=>{const x=40+i*131,y=test?201:180;doc.roundedRect(x,y,121,88,10).fill(light);doc.fillColor(muted).font('Helvetica-Bold').fontSize(9).text(label,x+13,y+15);doc.fillColor(navy).fontSize(30).text(String(value||0),x+13,y+36);});
 let y=test?321:300;doc.fillColor(navy).font('Helvetica-Bold').fontSize(17).text('Money at a glance',40,y);y+=29;
 doc.fillColor(muted).font('Helvetica').fontSize(9).text('Today’s invoicing and confirmed receipts. Balances reflect the current position.',40,y,{width});y+=25;
 for(const c of (s.finance||[])){
  if(y>640){doc.addPage();y=55;}
  doc.roundedRect(40,y,width,27,5).fill(blue);doc.fillColor('white').font('Helvetica-Bold').fontSize(10).text(c.currency,53,y+9);y+=35;
  for(const [label,value] of [['Invoiced today',c.invoiced],['Payments received today',c.received],['Outstanding balance',c.outstanding],['Overdue balance',c.overdue]]){
   doc.fillColor(label==='Overdue balance'&&value>0?'#B43B36':navy).font('Helvetica').fontSize(11).text(label,53,y);doc.font('Helvetica-Bold').text(money(value,c.currency),300,y,{width:240,align:'right'});doc.moveTo(53,y+21).lineTo(542,y+21).strokeColor('#E2E9F2').stroke();y+=33;
  }y+=9;
 }
 if(!(s.finance||[]).length){doc.fillColor(muted).fontSize(11).text('No invoice or payment activity to report.',40,y);y+=40;}
 if(y>650){doc.addPage();y=55;}doc.fillColor(navy).font('Helvetica-Bold').fontSize(17).text('Lead pipeline',40,y);y+=29;
 const states=s.pipeline?.length?s.pipeline:[{status:'No leads yet',total:0}];for(const state of states.slice(0,8)){if(y>715){doc.addPage();y=55;}doc.font('Helvetica').fontSize(11).fillColor(muted).text(String(state.status).replace(/_/g,' ').replace(/^./,c=>c.toUpperCase()),53,y);doc.font('Helvetica-Bold').fillColor(navy).text(String(state.total),450,y,{width:90,align:'right'});y+=25;}
 const range=doc.bufferedPageRange();for(let p=0;p<range.count;p++){doc.switchToPage(p);doc.font('Helvetica').fontSize(8).fillColor(muted).text(`Private owner report · 7Network · Page ${p+1} of ${range.count}`,40,790,{width,align:'center',lineBreak:false});}
 doc.end();return done;
}
module.exports={render};
