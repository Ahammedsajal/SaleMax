(() => {
  'use strict';
  const $=selector=>document.querySelector(selector);
  const dialog=$('#leadImportDialog'),button=$('#importLeads'),file=$('#leadImportFile'),preview=$('#leadImportPreview'),status=$('#leadImportStatus'),submit=$('#submitLeadImport');
  const lang=(localStorage.getItem('language')||'').toLowerCase(),ar=lang==='ar'||lang.includes('arab');
  const t=(en,arabic)=>ar?arabic:en;
  const labels={name:t('Name','الاسم'),phone:t('Phone','الهاتف'),title:t('Lead title','عنوان العميل'),email:t('Email','البريد الإلكتروني'),expected_value:t('Expected value','القيمة المتوقعة'),currency:t('Currency','العملة'),agent_email:t('Agent email','بريد الوكيل')};
  const escape=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const setText=(selector,value)=>{const node=$(selector);if(node)node.textContent=value;};
  const copy={import:t('Import leads','استيراد العملاء'),eyebrow:t('SALESMAX SALES','مبيعات SaleMaX'),title:t('Import sales leads','استيراد عملاء المبيعات'),help:t('Upload a CSV with name, phone and title. You can include email, expected_value, currency and agent_email. Maximum 100 rows.','ارفع ملف CSV يحتوي على الاسم والهاتف والعنوان. يمكن إضافة البريد والقيمة المتوقعة والعملة وبريد الوكيل. الحد الأقصى 100 صف.'),template:t('Download CSV template','تنزيل نموذج CSV'),choose:t('Choose CSV file','اختر ملف CSV'),cancel:t('Cancel','إلغاء'),upload:t('Import leads','استيراد العملاء'),close:t('Close','إغلاق')};
  $('#importLeads').querySelector('[data-i="import"]').textContent=copy.import;
  $('#leadImportDialog [data-i="importEyebrow"]').textContent=copy.eyebrow;$('#leadImportDialog [data-i="importTitle"]').textContent=copy.title;$('#leadImportDialog [data-i="importHelp"]').textContent=copy.help;$('#downloadLeadTemplate').textContent=copy.template;$('.import-file span').textContent=copy.choose;$('#cancelLeadImport').textContent=copy.cancel;submit.textContent=copy.upload;$('#closeLeadImport').setAttribute('aria-label',copy.close);
  const template='name,phone,title,email,expected_value,currency,agent_email\nPriya Sharma,+919876543210,Product enquiry,priya@example.com,12500,INR,agent@example.com\n';
  $('#downloadLeadTemplate').href='data:text/csv;charset=utf-8,'+encodeURIComponent(template);
  function parseCsv(source){
    source=source.replace(/^\uFEFF/,'');const rows=[];let row=[],cell='',quoted=false;
    for(let i=0;i<source.length;i++){const char=source[i];if(quoted){if(char==='"'&&source[i+1]==='"'){cell+='"';i++;}else if(char==='"')quoted=false;else cell+=char;}else if(char==='"'){if(cell)return null;quoted=true;}else if(char===','){row.push(cell);cell='';}else if(char==='\n'||char==='\r'){if(char==='\r'&&source[i+1]==='\n')i++;row.push(cell);cell='';if(row.some(value=>value.trim()))rows.push(row);row=[];}else cell+=char;}
    if(quoted)return null;row.push(cell);if(row.some(value=>value.trim()))rows.push(row);return rows;
  }
  function headerKey(value){return value.trim().toLowerCase().replace(/[ -]+/g,'_');}
  function normalizeRows(parsed){
    if(!parsed||parsed.length<2)return {error:t('The CSV needs a header row and at least one lead.','يجب أن يحتوي CSV على صف عناوين وصف عميل واحد على الأقل.')};
    const headers=parsed[0].map(headerKey),aliases={contact_name:'name',mobile:'phone',lead_title:'title',agent:'agent_email'};
    const keys=headers.map(key=>aliases[key]||key);if(new Set(keys).size!==keys.length)return {error:t('The CSV contains duplicate column names.','يحتوي CSV على عناوين أعمدة مكررة.')};
    if(!['name','phone','title'].every(key=>keys.includes(key)))return {error:t('Required columns are name, phone and title.','الأعمدة المطلوبة هي name وphone وtitle.')};
    if(parsed.length>101)return {error:t('Import up to 100 leads at a time.','يمكن استيراد 100 عميل كحد أقصى في كل مرة.')};
    const rows=parsed.slice(1).map(values=>Object.fromEntries(keys.map((key,index)=>[key,String(values[index]||'').trim()])));
    for(let index=0;index<rows.length;index++){const row=rows[index];if(!row.name||!row.phone||!row.title)return {error:t(`Row ${index+2} is missing a required value.`,`الصف ${index+2} يفتقد قيمة مطلوبة.`)};if(row.expected_value&&!/^\d{1,10}(?:\.\d{1,2})?$/.test(row.expected_value))return {error:t(`Row ${index+2} has an invalid expected value.`,`قيمة المبيعات المتوقعة غير صالحة في الصف ${index+2}.`)};}
    return {rows};
  }
  function render(rows){
    const cols=['name','phone','title','email','expected_value','currency','agent_email'].filter(key=>rows.some(row=>row[key]));
    preview.innerHTML=`<p>${escape(t(`${rows.length} leads ready to review`,`جاهز لمراجعة ${rows.length} من العملاء`))}</p><div class="lead-import-table-wrap"><table><thead><tr>${cols.map(key=>`<th>${escape(labels[key])}</th>`).join('')}</tr></thead><tbody>${rows.slice(0,8).map(row=>`<tr>${cols.map(key=>`<td>${escape(row[key]||'—')}</td>`).join('')}</tr>`).join('')}</tbody></table></div>${rows.length>8?`<p>${escape(t(`Showing first 8 of ${rows.length} leads.`,`عرض أول 8 من أصل ${rows.length} عميل.`))}</p>`:''}`;
  }
  let acceptedRows=[];
  async function loadCsv(selected){
    acceptedRows=[];submit.disabled=true;preview.replaceChildren();status.textContent='';status.dataset.error='false';
    if(!selected)return;
    if(selected.size>128*1024){status.textContent=t('CSV must be 128 KB or smaller.','يجب ألا يتجاوز حجم CSV ‏128 كيلوبايت.');status.dataset.error='true';return;}
    const result=normalizeRows(parseCsv(await selected.text()));if(result.error){status.textContent=result.error;status.dataset.error='true';return;}
    acceptedRows=result.rows;render(acceptedRows);submit.disabled=false;
  }
  file.addEventListener('change',()=>loadCsv(file.files?.[0]));
  async function checkAccess(){try{const token=localStorage.getItem('wacrm_user'),response=await fetch('/api/pipeline/settings',{headers:{Authorization:token?'Bearer '+token:'','Accept':'application/json'},credentials:'same-origin',cache:'no-store'}),body=await response.json();button.hidden=!(response.ok&&body.success&&body.data?.categoryKey==='salemax_sales'&&body.data?.role==='owner');}catch{button.hidden=true;}}
  button.addEventListener('click',()=>{file.value='';acceptedRows=[];preview.replaceChildren();status.textContent='';submit.disabled=true;dialog.showModal();});
  $('#closeLeadImport').addEventListener('click',()=>dialog.close());$('#cancelLeadImport').addEventListener('click',()=>dialog.close());
  $('#leadImportForm').addEventListener('submit',async event=>{
    event.preventDefault();if(!acceptedRows.length)return;submit.disabled=true;status.dataset.error='false';status.textContent=t('Importing leads…','جارٍ استيراد العملاء…');
    try{const token=localStorage.getItem('wacrm_user'),response=await fetch('/api/pipeline/leads/import',{method:'POST',credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json','Accept':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:JSON.stringify({rows:acceptedRows})}),body=await response.json();if(!response.ok||!body.success){const row=body.row?` (${t('row','الصف')} ${body.row})`:'';const messages={PERMISSION_DENIED:t('Only the Business Admin can import leads.','يمكن لمسؤول النشاط فقط استيراد العملاء.'),DUPLICATE_IMPORT_ROW:t('A duplicate phone and lead title were found in this file.','يوجد رقم هاتف وعنوان عميل مكرران في الملف.'),DUPLICATE_EXISTING_LEAD:t('A matching lead already exists in this workspace.','يوجد عميل مطابق مسبقًا في مساحة العمل.'),IMPORT_AGENT_NOT_FOUND:t('An assigned agent email is not active in this workspace.','بريد الوكيل المحدد غير نشط في مساحة العمل.'),INVALID_IMPORT_ROW:t('A row has invalid or missing data. Check names, phone numbers and amounts.','يحتوي صف على بيانات مفقودة أو غير صالحة. تحقق من الأسماء والأرقام والمبالغ.'),INVALID_IMPORT_ROWS:t('Choose a CSV with between 1 and 100 leads.','اختر CSV يحتوي على 1 إلى 100 عميل.'),IMPORT_TOO_LARGE:t('The import is too large.','حجم الاستيراد كبير.')};throw new Error((messages[body.code]||t('The import failed. Review the file and try again.','فشل الاستيراد. راجع الملف وحاول مرة أخرى.'))+row);}
      status.textContent=t(`${body.data.created} leads imported successfully.`,`${body.data.created} عميل تم استيراده بنجاح.`);setTimeout(()=>{dialog.close();$('#refresh')?.click();},900);
    }catch(error){status.textContent=error.message||t('The import failed.','فشل الاستيراد.');status.dataset.error='true';submit.disabled=false;}
  });
  checkAccess();
})();
