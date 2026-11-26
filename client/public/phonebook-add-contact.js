/* Adds email entry to the existing legacy Phonebook manual-contact dialog. */
(()=>{'use strict';
if(window.__sxPhonebookEmailField)return;window.__sxPhonebookEmailField=true;
const active=()=>['/user','/agent'].includes(location.pathname.replace(/\/$/,''))&&new URLSearchParams(location.search).get('page')==='phonebook';
const ar=()=>{const v=String(localStorage.getItem('language')||'').toLowerCase();return v==='ar'||v.includes('arabic');};
const t=(en,arabic)=>ar()?arabic:en,esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const api=(path,method='GET',body)=>window.SaleMaxWorkspace.request('phonebook',path,{method,body});
const dialogs=()=>[...document.querySelectorAll('[role="dialog"],.MuiDialog-paper,dialog')];
const getTitle=d=>[...d.querySelectorAll('h1,h2,h3,[role="heading"]')].map(x=>x.textContent.trim()).find(x=>/add contacts|إضافة جهات اتصال/i.test(x))||'';
const getInput=(d,names,pattern)=>{for(const n of names){const v=d.querySelector(`[name="${n}"]`);if(v)return v;}for(const label of d.querySelectorAll('label,.MuiInputLabel-root'))if(pattern.test(label.textContent)){const linked=label.htmlFor&&d.querySelector(`#${CSS.escape(label.htmlFor)}`);if(linked)return linked;const direct=label.querySelector('input');if(direct)return direct;for(const parent of [label.parentElement,label.parentElement?.parentElement]){const input=parent?.querySelector('input');if(input)return input;}}return null;};
function status(d,msg,success=false){let box=d.querySelector('[data-sx-phonebook-email-status]');if(!box){box=document.createElement('div');box.dataset.sxPhonebookEmailStatus='1';const form=d.querySelector('form');(form||d).append(box);}box.className=success?'sx-phonebook-email-success':'sx-phonebook-email-error';box.setAttribute('role',success?'status':'alert');box.textContent=msg;box.hidden=false;}
function error(d,msg){status(d,msg,false);}
function addField(d){
 if(!active()||!getTitle(d)||d.querySelector('[name="sx_phonebook_email"]'))return;
 const mobile=getInput(d,['mobile','phone','phoneNumber'],/mobile|phone|رقم الهاتف|الجوال/i);if(!mobile)return;
 const host=mobile.closest('.MuiFormControl-root')||mobile.closest('label')||mobile.parentElement?.parentElement||mobile.parentElement;if(!host)return;
 d.dataset.sxPhonebookEmailReady='1';
 const wrap=document.createElement('label');wrap.className='sx-phonebook-email-field';wrap.innerHTML=`<span>${t('Email address','البريد الإلكتروني')}</span><input type="email" name="sx_phonebook_email" maxlength="254" autocomplete="email" placeholder="name@example.com"><small>${t('Email is saved without marking marketing consent.','يُحفظ البريد دون تسجيل موافقة تسويقية.')}</small>`;
 const row=host.parentElement;
 if(row&&row.querySelectorAll('input').length>=2){wrap.classList.add('sx-phonebook-email-full-row');row.insertAdjacentElement('afterend',wrap);}
 else host.insertAdjacentElement('afterend',wrap);
}
function resetInputs(d){for(const input of d.querySelectorAll('input:not([type=submit]):not([type=button]),textarea'))if(input.name==='sx_phonebook_email'||/^(?:name|contactName|mobile|phone|phoneNumber|var[1-5])$/i.test(input.name||'')){input.value='';input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));}}
async function saveWithEmail(d,submit){
 const email=d.querySelector('[name="sx_phonebook_email"]')?.value.trim().toLowerCase();if(!email)return false;
 submit?.preventDefault();submit?.stopPropagation();submit?.stopImmediatePropagation();
 const form=d.querySelector('form'),button=d.querySelector('button[type="submit"],input[type="submit"]')||d.querySelector('button');
 if(button)button.disabled=true;
 try{
  const access=await api('/bootstrap');if(!access.emailMarketing)throw Error('EMAIL_MARKETING_ACCESS_REQUIRED');
  const title=getTitle(d),bookFromControl=d.querySelector('[name="bookId"],select[name="id"]')?.value;
  const candidates=access.books||[];const book=candidates.find(x=>String(x.id)===String(bookFromControl))||candidates.find(x=>title.toLowerCase().includes(String(x.name||'').toLowerCase()))||(candidates.length===1?candidates[0]:null);
  if(!book)throw Error('PHONEBOOK_NOT_IDENTIFIED');
  const name=getInput(d,['name','contactName'],/contact name|name|اسم جهة الاتصال|الاسم/i)?.value.trim()||'';
  const mobile=getInput(d,['mobile','phone','phoneNumber'],/mobile|phone|رقم الهاتف|الجوال/i)?.value.trim()||'';
  const manual={name,mobile,email};for(let i=1;i<=5;i++){const field=d.querySelector(`[name="var${i}"]`);if(field)manual[`var${i}`]=field.value.trim();}
  const result=await api('/add-contacts','POST',{bookId:book.id,manual,emailMarketingConsent:false});
  const refresh=document.querySelector('#sx-phonebook [data-action="reload"]');refresh?.click();
  resetInputs(d);
  status(d,result.bouncedEmailsRemoved?t('Contact saved. Bounce protection removed its email, so the address was not retained.','تم حفظ جهة الاتصال. أزالت حماية الارتداد بريدها الإلكتروني لذلك لم يتم الاحتفاظ به.'):t('Contact and email saved successfully. The form is ready for the next contact.','تم حفظ جهة الاتصال والبريد الإلكتروني بنجاح. النموذج جاهز لإضافة جهة الاتصال التالية.'),true);
  getInput(d,['name','contactName'],/contact name|name|اسم جهة الاتصال|الاسم/i)?.focus();
  return true;
 }catch(e){const messages={EMAIL_MARKETING_ACCESS_REQUIRED:t('Email Marketing access is not enabled for this account. The address was not saved.','صلاحية التسويق بالبريد الإلكتروني غير مفعّلة لهذا الحساب. لم يتم حفظ العنوان.'),PHONEBOOK_NOT_IDENTIFIED:t('Could not identify the phonebook for this contact. Close the dialog and reopen it from the selected phonebook.','تعذر تحديد دفتر الهاتف. أغلق النافذة وافتحها مجددًا من دفتر الهاتف المحدد.'),INVALID_CONTACT:t('Add a name and a mobile number or email address.','أدخل الاسم ورقم الهاتف أو البريد الإلكتروني.'),INVALID_EMAIL_ADDRESS:t('Enter a valid email address.','أدخل بريدًا إلكترونيًا صالحًا.'),CONTACT_LIMIT:t('The contact limit for this account has been reached.','تم الوصول إلى الحد الأقصى لجهات الاتصال لهذا الحساب.'),EMAIL_SUPPRESSION_KEY_UNAVAILABLE:t('Email saving is temporarily unavailable. Try again later.','حفظ البريد غير متاح مؤقتًا. حاول مرة أخرى لاحقًا.')};error(d,messages[e.message]||t('Could not save this contact. Please try again.','تعذر حفظ جهة الاتصال. حاول مرة أخرى.'));return true;
 }finally{if(button?.isConnected)button.disabled=false;}
}
document.addEventListener('click',e=>{if(!active())return;const button=e.target.closest('button,input[type="submit"]');if(!button||!(/save contact|add contact|حفظ جهة الاتصال|إضافة جهة اتصال/i.test(button.textContent||button.value||'')))return;const d=button.closest('[role="dialog"],.MuiDialog-paper,dialog');if(!d?.querySelector('[name="sx_phonebook_email"]')?.value.trim())return;saveWithEmail(d,e);},true);
document.addEventListener('submit',e=>{if(!active())return;const d=e.target.closest('[role="dialog"],.MuiDialog-paper,dialog');if(!d?.querySelector('[name="sx_phonebook_email"]')?.value.trim())return;saveWithEmail(d,e);},true);
let queued=false;new MutationObserver(()=>{if(queued)return;queued=true;requestAnimationFrame(()=>{queued=false;for(const d of dialogs())addField(d);});}).observe(document.documentElement,{childList:true,subtree:true});
})();
