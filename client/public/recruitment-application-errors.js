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
    RECRUITMENT_UNAVAILABLE:['We could not send your application just now. Please try again. If it still does not work, contact the 7Network recruitment team and include the cause shown in brackets.','تعذر إرسال طلبك الآن. يرجى المحاولة مرة أخرى. إذا لم ينجح ذلك، تواصل مع فريق التوظيف في 7Network وأرسل لهم السبب الظاهر بين القوسين.'],
    APPLICATION_SUBMIT_FAILED:['We could not send your application just now. Please try again. If it still does not work, contact the 7Network recruitment team and include the cause shown in brackets.','تعذر إرسال طلبك الآن. يرجى المحاولة مرة أخرى. إذا لم ينجح ذلك، تواصل مع فريق التوظيف في 7Network وأرسل لهم السبب الظاهر بين القوسين.'],
    HTTP_413:['Your CV could not be uploaded. Please choose a file under 8 MB and try again.','تعذر رفع سيرتك الذاتية. يرجى اختيار ملف أقل من ٨ ميغابايت والمحاولة مرة أخرى.'],
    LIMIT_FILE_SIZE:['Your CV is larger than 8 MB. Please choose a smaller file and try again.','حجم سيرتك الذاتية أكبر من ٨ ميغابايت. يرجى اختيار ملف أصغر والمحاولة مرة أخرى.']
  };
  const causeDescriptions={
    NETWORK_ERROR:['Could not connect to the application service','تعذر الاتصال بخدمة التقديم'],
    ECONNREFUSED:['The application service refused the connection','رفضت خدمة التقديم الاتصال'],
    EHOSTUNREACH:['The application service could not be reached','تعذر الوصول إلى خدمة التقديم'],
    ENETUNREACH:['The network could not reach the application service','تعذر على الشبكة الوصول إلى خدمة التقديم'],
    ENOTFOUND:['The application service address could not be found','تعذر العثور على عنوان خدمة التقديم'],
    EAI_AGAIN:['The application service address could not be checked','تعذر التحقق من عنوان خدمة التقديم'],
    ECONNRESET:['The connection ended before the application was saved','انقطع الاتصال قبل حفظ الطلب'],
    ETIMEDOUT:['The connection took too long while sending the application','استغرق الاتصال وقتًا طويلًا أثناء إرسال الطلب'],
    ECONNABORTED:['The connection ended before the application was saved','انقطع الاتصال قبل حفظ الطلب'],
    EPIPE:['The connection ended before the application was saved','انقطع الاتصال قبل حفظ الطلب'],
    PROTOCOL_CONNECTION_LOST:['The connection ended before the application was saved','انقطع الاتصال قبل حفظ الطلب'],
    ER_NO_SUCH_TABLE:['A required application service component is unavailable','أحد مكونات خدمة التقديم المطلوبة غير متاح'],
    HTTP_413:['The CV upload exceeded the allowed request size','تجاوز رفع السيرة الذاتية الحجم المسموح'],
    LIMIT_FILE_SIZE:['The CV is larger than the 8 MB limit','حجم السيرة الذاتية أكبر من الحد المسموح وهو ٨ ميغابايت']
  };
  function causeText(code,index){
    if(causeDescriptions[code])return `${causeDescriptions[code][index]} (${code})`;
    if(/^ER_[A-Z0-9_]{1,72}$/.test(code))return `${index?'تعذر حفظ بيانات الطلب':'The application details could not be saved'} (${code})`;
    if(/^PROTOCOL_[A-Z0-9_]{1,64}$/.test(code))return `${index?'حدثت مشكلة في الاتصال أثناء إرسال الطلب':'A connection problem occurred while sending the application'} (${code})`;
    if(/^HTTP_5\d\d$/.test(code))return `${index?'أعادت خدمة التقديم خطأ':'The application service returned an error'} (${code})`;
    if(/^HTTP_4\d\d$/.test(code))return `${index?'تعذر قبول الطلب بسبب حالة طلب غير متوقعة':'The application could not be accepted because of an unexpected request status'} (${code})`;
    return `${index?'خطأ تقني غير متوقع':'An unexpected technical error'} (${code})`;
  }
  const safeCode=value=>typeof value==='string'&&/^[A-Z][A-Z0-9_]{1,79}$/.test(value)?value:'UNEXPECTED_SERVER_ERROR';
  function format(code,cause,language='en'){
    const key=safeCode(code),ar=/^ar(?:-|$)/i.test(language),index=ar?1:0;
    const fallback=ar?'تعذر إرسال طلبك الآن. يرجى المحاولة مرة أخرى. إذا لم ينجح ذلك، تواصل مع فريق التوظيف في 7Network وأرسل لهم السبب الظاهر بين القوسين.':'We could not send your application just now. Please try again. If it still does not work, contact the 7Network recruitment team and include the cause shown in brackets.';
    const detail=safeCode(cause||key);
    const message=((/^HTTP_413$|^LIMIT_FILE_SIZE$/.test(detail)?messages[detail]:null)||messages[key]||[fallback,fallback])[index];
    const technical=key==='RECRUITMENT_UNAVAILABLE'||key==='APPLICATION_SUBMIT_FAILED'||key==='UNEXPECTED_SERVER_ERROR'||!messages[key]||/^HTTP_[45]\d\d$|^LIMIT_FILE_SIZE$/.test(detail);
    return `${message}${technical?` [${ar?'السبب':'Cause'}: ${causeText(detail,index)}]`:''}`;
  }

  if(typeof module==='object'&&module.exports)module.exports={format};
  if(typeof window!=='undefined')window.SaleMaXRecruitmentApplicationErrors={format};
})();
