(() => {
  'use strict';

  const messages={
    TENANT_NOT_FOUND:['This recruitment page is unavailable.','صفحة التوظيف غير متاحة.'],
    APPLICATION_RATE_LIMITED:['Too many attempts. Please wait a little and try again.','هناك محاولات كثيرة. يرجى الانتظار قليلًا ثم المحاولة مرة أخرى.'],
    CV_TYPE_NOT_ALLOWED:['Please upload your CV as a PDF or DOCX file.','يرجى رفع السيرة الذاتية بصيغة PDF أو DOCX.'],
    INVALID_CV_FILE:['Please choose a CV file smaller than 8 MB and try again.','يرجى اختيار سيرة ذاتية بحجم أقل من 8 ميغابايت والمحاولة مرة أخرى.'],
    CV_FILE_REQUIRED:['Please attach your CV before submitting.','يرجى إرفاق سيرتك الذاتية قبل الإرسال.'],
    CONSENT_REQUIRED:['Please agree to the recruitment privacy notice before applying.','يرجى الموافقة على إشعار الخصوصية قبل التقديم.'],
    INVALID_EMAIL:['Please check that your email address is correct.','يرجى التحقق من صحة عنوان بريدك الإلكتروني.'],
    INVALID_MOBILE:['Please include your country code with your phone number.','يرجى إضافة رمز الدولة إلى رقم هاتفك.'],
    INVALID_SUBMISSION_TOKEN:['Please refresh the page and submit your application again.','يرجى تحديث الصفحة وإرسال طلبك مرة أخرى.'],
    INVALID_APPLICATION:['Please review the required answers and try again.','يرجى مراجعة الإجابات المطلوبة والمحاولة مرة أخرى.'],
    INVALID_ENGLISH_LEVEL:['Please choose an English level from the list.','يرجى اختيار مستوى اللغة الإنجليزية من القائمة.'],
    INVALID_HINDI_LEVEL:['Please choose a Hindi level from the list.','يرجى اختيار مستوى اللغة الهندية من القائمة.'],
    INVALID_EXPERIENCE_YEARS:['Please enter a whole number of years from 0 to 50.','يرجى إدخال عدد صحيح من ٠ إلى ٥٠ سنة.'],
    INVALID_AVAILABILITY:['Please choose your preferred working arrangement.','يرجى اختيار نظام العمل المفضل.'],
    ORIGIN_DENIED:['This application link could not be verified. Please reopen the official 7Network recruitment link and try again.','تعذر التحقق من رابط التقديم. يرجى فتح رابط التوظيف الرسمي من 7Network والمحاولة مرة أخرى.'],
    PREFILL_NOT_FOUND:['This saved application link has expired. Please request a fresh link from the 7Network recruitment team.','انتهت صلاحية رابط الطلب المحفوظ. يرجى طلب رابط جديد من فريق التوظيف في 7Network.'],
    RECRUITMENT_UNAVAILABLE:['We could not submit your application right now. Please try again in a few minutes.','تعذر إرسال طلبك الآن. يرجى المحاولة مرة أخرى بعد بضع دقائق.'],
    APPLICATION_SUBMIT_FAILED:['We could not submit your application right now. Please try again in a few minutes.','تعذر إرسال طلبك الآن. يرجى المحاولة مرة أخرى بعد بضع دقائق.'],
    HTTP_413:['Your CV could not be uploaded. Please choose a file under 8 MB and try again.','تعذر رفع سيرتك الذاتية. يرجى اختيار ملف أقل من ٨ ميغابايت والمحاولة مرة أخرى.']
  };
  const safeCode=value=>typeof value==='string'&&/^[A-Z][A-Z0-9_]{1,79}$/.test(value)?value:'UNEXPECTED_SERVER_ERROR';
  function format(code,cause,language='en'){
    const key=safeCode(code),ar=/^ar(?:-|$)/i.test(language),index=ar?1:0;
    const fallback=ar?'تعذر إرسال طلبك الآن. يرجى المحاولة مرة أخرى بعد بضع دقائق.':'We could not submit your application right now. Please try again in a few minutes.';
    const detail=safeCode(cause||key);
    const message=((/^HTTP_413$/.test(detail)?messages[detail]:null)||messages[key]||[fallback,fallback])[index];
    const technical=key==='RECRUITMENT_UNAVAILABLE'||key==='APPLICATION_SUBMIT_FAILED'||key==='UNEXPECTED_SERVER_ERROR'||!messages[key]||/^HTTP_[45]\d\d$/.test(detail);
    return `${message}${technical?` [${ar?'السبب':'Cause'}: ${detail}]`:''}`;
  }

  if(typeof module==='object'&&module.exports)module.exports={format};
  if(typeof window!=='undefined')window.SaleMaXRecruitmentApplicationErrors={format};
})();
