(() => {
 'use strict';
 const trainingOnly=new Set(['certificate_name','qid','birth_date','gender','graduated','emergency_phone','courseInterest','preferredSchedule','learningGoal','experienceLevel','payerRelationship','payerName']);
 function shared(contract){return contract?.version===1&&contract.profile==='shared';}
 function apply(form,contract){
  if(!form||!shared(contract))return;
  const ar=document.documentElement.lang.startsWith('ar');
  for(const input of form.querySelectorAll('[name]')){
   const key=input.name.replace(/^qualification_/,'');
   if(input.name==='learnerName'||trainingOnly.has(key))input.closest('.field')?.remove();
  }
  const words=ar?{summary:'بيانات جهة الاتصال (اختيارية)',hint:'استخدم هذه الأسئلة لفهم احتياج العميل. تجاوز ما لا يعرفه بعد.',pricing:'الأسعار',schedule:'التوفر',referral:'اسأل: كيف سمعت عن نشاطنا؟'}:{summary:'Contact details (optional)',hint:'Use these questions to understand the customer. Skip anything they do not know yet.',pricing:'Pricing',schedule:'Availability',referral:'Ask: How did you hear about our business?'};
  for(const details of form.querySelectorAll('details')){
   const summary=details.querySelector('summary');if(summary?.textContent.includes('Student details'))summary.textContent=words.summary;
   const hint=details.querySelector(':scope > .contact-help');if(hint)hint.textContent=words.hint;
  }
  const purpose=form.querySelector('[name=qualification_enquiryPurpose]');
  if(purpose){for(const option of [...purpose.options]){if(['course','corporate_training'].includes(option.value))option.remove();else if(option.value==='pricing')option.textContent=words.pricing;else if(option.value==='schedule')option.textContent=words.schedule;}}
  const referral=form.querySelector('[name=qualification_referralSource]');if(referral?.closest('.field')?.querySelector('small'))referral.closest('.field').querySelector('small').textContent=words.referral;
  for(const row of form.querySelectorAll('.row'))if(!row.querySelector('input,select,textarea'))row.remove();
 }
 function workflows(root,contract,{hasApplications=false}={}){
  if(contract?.version!==1)return;
  if(!contract.workflows.forms){root.querySelector('#createLeadApplication')?.remove();if(!hasApplications)root.querySelector('.application-chain')?.remove();}
  if(!contract.workflows.saleReviews){root.querySelector('#sale-review-area')?.remove();for(const button of root.querySelectorAll('[data-app-sale]'))button.remove();}
 }
 window.SaleMaxPipelineWorkspace=Object.freeze({apply,workflows});
})();
