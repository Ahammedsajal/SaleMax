'use strict';

const MAX_BLOCKS=30;
const MAX_DESIGN_BYTES=30000;
const BLOCK_TEXT_LIMIT=5000;
const IMAGE_TYPES=new Set(['image/png','image/jpeg','image/gif']);
const ALIGNMENTS=new Set(['left','center','right']);
const HEX_COLOR=/^#[0-9a-f]{6}$/i;
const fail=code=>{throw Object.assign(Error(code),{code,status:400});};
const text=(value,max,code,{required=false}={})=>{
  if(typeof value!=='string')fail(code);
  const result=value.trim();
  if(result.length>max||(required&&!result))fail(code);
  return result;
};
const color=(value,fallback)=>{
  if(value==null||value==='')return fallback;
  const result=String(value).trim();
  if(!HEX_COLOR.test(result))fail('INVALID_EMAIL_DESIGN_COLOR');
  return result;
};
const alignment=value=>{
  const result=String(value||'left');
  if(!ALIGNMENTS.has(result))fail('INVALID_EMAIL_DESIGN_ALIGNMENT');
  return result;
};
function httpsUrl(value,{required=false}={}){
  const source=text(value||'',2048,'INVALID_EMAIL_DESIGN_URL',{required});
  if(!source)return '';
  let parsed;
  try{parsed=new URL(source);}catch{fail('INVALID_EMAIL_DESIGN_URL');}
  if(parsed.protocol!=='https:'||!parsed.hostname||parsed.username||parsed.password)fail('INVALID_EMAIL_DESIGN_URL');
  return parsed.href;
}

function cleanDesign(value,attachments=[]){
  if(!value||typeof value!=='object'||Array.isArray(value)||value.version!==1||!Array.isArray(value.blocks))fail('INVALID_EMAIL_DESIGN');
  if(value.blocks.length>MAX_BLOCKS)fail('EMAIL_DESIGN_TOO_MANY_BLOCKS');
  if(!value.blocks.length)fail('EMAIL_DESIGN_EMPTY');
  const byId=new Map((Array.isArray(attachments)?attachments:[]).map(item=>[String(item.id),item]));
  let headers=0;
  const blocks=value.blocks.map(block=>{
    if(!block||typeof block!=='object'||Array.isArray(block))fail('INVALID_EMAIL_DESIGN_BLOCK');
    switch(block.type){
      case 'header':{
        headers++;
        if(headers>1)fail('EMAIL_DESIGN_HEADER_LIMIT');
        return {type:'header',title:text(block.title||'',180,'INVALID_EMAIL_DESIGN_TEXT',{required:true}),
          subtitle:text(block.subtitle||'',300,'INVALID_EMAIL_DESIGN_TEXT'),align:alignment(block.align),
          backgroundColor:color(block.backgroundColor,'#9d174d'),textColor:color(block.textColor,'#ffffff')};
      }
      case 'heading':
        return {type:'heading',text:text(block.text||'',180,'INVALID_EMAIL_DESIGN_TEXT',{required:true}),
          align:alignment(block.align),size:['small','medium','large'].includes(block.size)?block.size:'medium',
          color:color(block.color,'#172033')};
      case 'text':
        return {type:'text',text:text(block.text||'',BLOCK_TEXT_LIMIT,'INVALID_EMAIL_DESIGN_TEXT',{required:true}),
          align:alignment(block.align),color:color(block.color,'#344054')};
      case 'image':{
        const attachmentId=String(block.attachmentId||'');
        const attachment=byId.get(attachmentId);
        if(!/^[-0-9a-f]{36}$/i.test(attachmentId)||!attachment||!IMAGE_TYPES.has(String(attachment.contentType||'')))fail('EMAIL_DESIGN_IMAGE_REQUIRED');
        return {type:'image',attachmentId,alt:text(block.alt||'',200,'INVALID_EMAIL_DESIGN_ALT',{required:true}),
          href:httpsUrl(block.href||'')};
      }
      case 'button':
        return {type:'button',text:text(block.text||'',120,'INVALID_EMAIL_DESIGN_TEXT',{required:true}),
          href:httpsUrl(block.href||'',{required:true}),align:alignment(block.align),
          backgroundColor:color(block.backgroundColor,'#9d174d'),textColor:color(block.textColor,'#ffffff')};
      case 'divider':
        return {type:'divider'};
      case 'spacer':{
        const height=Number(block.height);
        if(!Number.isInteger(height)||height<8||height>80)fail('INVALID_EMAIL_DESIGN_SPACER');
        return {type:'spacer',height};
      }
      default: fail('INVALID_EMAIL_DESIGN_BLOCK');
    }
  });
  if(blocks.some(block=>block.type==='header')&&blocks[0]?.type!=='header')fail('EMAIL_DESIGN_HEADER_POSITION');
  const design={version:1,blocks};
  if(Buffer.byteLength(JSON.stringify(design),'utf8')>MAX_DESIGN_BYTES)fail('EMAIL_DESIGN_TOO_LARGE');
  return design;
}

function designToText(design){
  const blocks=Array.isArray(design?.blocks)?design.blocks:[];
  return blocks.map(block=>{
    if(block.type==='header')return [block.title,block.subtitle].filter(Boolean).join('\n');
    if(block.type==='heading'||block.type==='text')return String(block.text||'');
    if(block.type==='image')return String(block.alt||'');
    if(block.type==='button')return [block.text,block.href].filter(Boolean).join(': ');
    return '';
  }).filter(Boolean).join('\n\n').trim();
}

function imageContentId(id){return '7network-image-'+String(id||'').replace(/[^a-zA-Z0-9]/g,'');}
function escapeHtml(value){return String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));}
function personalized(value,personalize,contact){return typeof personalize==='function'?personalize(value,contact):String(value||'');}
function renderText(value,personalize,contact){
  const safe=escapeHtml(personalized(value,personalize,contact));
  return safe.replace(/\r\n|\r|\n/g,'<br>');
}
function imageIds(design){return [...new Set((design?.blocks||[]).filter(block=>block.type==='image').map(block=>block.attachmentId))];}

function renderDesignedHtml(design,attachments,{contact,personalize,unsubscribeUrl}={}){
  const safeDesign=cleanDesign(design,attachments);
  const byId=new Map((attachments||[]).map(file=>[String(file.id),file]));
  const body=safeDesign.blocks.map(block=>{
    if(block.type==='header'){
      return `<tr><td dir="auto" style="padding:28px 24px;background:${block.backgroundColor};color:${block.textColor};text-align:${block.align}"><h1 style="margin:0;font:700 28px/1.2 Arial,sans-serif;color:${block.textColor}">${renderText(block.title,personalize,contact)}</h1>${block.subtitle?`<p style="margin:10px 0 0;font:16px/1.5 Arial,sans-serif;color:${block.textColor}">${renderText(block.subtitle,personalize,contact)}</p>`:''}</td></tr>`;
    }
    if(block.type==='heading'){
      const size=block.size==='large'?28:block.size==='small'?18:22;
      return `<tr><td dir="auto" style="padding:16px 24px 4px;text-align:${block.align}"><h2 style="margin:0;color:${block.color};font:700 ${size}px/1.3 Arial,sans-serif">${renderText(block.text,personalize,contact)}</h2></td></tr>`;
    }
    if(block.type==='text')return `<tr><td dir="auto" style="padding:10px 24px;text-align:${block.align}"><p style="margin:0;color:${block.color};font:16px/1.65 Arial,sans-serif">${renderText(block.text,personalize,contact)}</p></td></tr>`;
    if(block.type==='image'){
      const file=byId.get(block.attachmentId);
      if(!file||!IMAGE_TYPES.has(String(file.contentType||'')))fail('EMAIL_DESIGN_IMAGE_REQUIRED');
      const image=`<img src="cid:${imageContentId(block.attachmentId)}" alt="${escapeHtml(personalized(block.alt,personalize,contact))}" width="552" style="display:block;width:100%;max-width:552px;height:auto;border:0;border-radius:8px">`;
      return `<tr><td style="padding:12px 24px;text-align:center">${block.href?`<a href="${escapeHtml(block.href)}" rel="noreferrer noopener">${image}</a>`:image}</td></tr>`;
    }
    if(block.type==='button')return `<tr><td style="padding:14px 24px;text-align:${block.align}"><a href="${escapeHtml(block.href)}" rel="noreferrer noopener" style="display:inline-block;border-radius:7px;padding:12px 20px;background:${block.backgroundColor};color:${block.textColor};font:700 15px/1.2 Arial,sans-serif;text-decoration:none">${renderText(block.text,personalize,contact)}</a></td></tr>`;
    if(block.type==='divider')return '<tr><td style="padding:12px 24px"><hr style="height:1px;border:0;background:#dfe5ee;margin:0"></td></tr>';
    if(block.type==='spacer')return `<tr><td aria-hidden="true" style="height:${block.height}px;line-height:${block.height}px;font-size:1px">&nbsp;</td></tr>`;
    return '';
  }).join('');
  const footer=unsubscribeUrl?`<tr><td style="padding:18px 24px 24px;border-top:1px solid #dfe5ee;color:#647087;font:12px/1.5 Arial,sans-serif"><a href="${escapeHtml(unsubscribeUrl)}" rel="noreferrer noopener" style="color:#647087;text-decoration:underline">Unsubscribe / إلغاء الاشتراك</a></td></tr>`:'';
  return `<!doctype html><html><body style="margin:0;padding:24px 10px;background:#f4f6f8"><table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:600px;margin:0 auto;background:#ffffff;border:1px solid #e4e7ec;border-radius:10px;border-collapse:separate;overflow:hidden"><tbody>${body}${footer}</tbody></table></body></html>`;
}

function parseDesign(value){
  if(value==null||value==='')return null;
  if(typeof value==='object'&&!Array.isArray(value))return value;
  try{const parsed=JSON.parse(String(value));return parsed&&typeof parsed==='object'&&!Array.isArray(parsed)?parsed:null;}catch{return null;}
}

module.exports={MAX_BLOCKS,MAX_DESIGN_BYTES,IMAGE_TYPES,cleanDesign,designToText,imageContentId,imageIds,renderDesignedHtml,parseDesign};
