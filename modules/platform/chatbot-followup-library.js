'use strict';

const variants = {
  F01: ['overview', 'Would a short overview of {course} help you decide if it’s a good fit?', 'هل تساعدك نبذة عن دورة {course} في معرفة مدى ملاءمتها لك؟'],
  F02: ['fee', 'Would you like the current fee for {course} and a quick breakdown of what it covers?', 'هل ترغب في معرفة رسوم دورة {course} الحالية وما تتضمنه؟'],
  F03: ['duration', 'Would it help to see how long {course} takes and what the weekly commitment looks like?', 'هل ترغب في معرفة مدة دورة {course} والوقت المطلوب أسبوعيًا؟'],
  F04: ['start', 'Would you like us to check the next available start for {course}?', 'هل ترغب في أن نتحقق من موعد الدفعة القادمة لدورة {course}؟'],
  F05: ['schedule', 'If you’re fitting {course} around work, what days are usually easiest for you?', 'إذا كنت تنسق دورة {course} مع دوامك، فما الأيام الأنسب لك؟'],
  F06: ['delivery', 'Would it help to see how {course} is delivered and which parts you’d attend in person?', 'هل ترغب في معرفة طريقة تقديم دورة {course} وما يتطلب الحضور؟'],
  F07: ['location', 'Would you like us to confirm the training venue for {course} before you make plans to visit?', 'هل ترغب في أن نؤكد مكان دورة {course} قبل أن تخطط للزيارة؟'],
  F08: ['curriculum', 'Would a few examples of what you’ll practise in {course} help you decide?', 'هل تساعدك أمثلة على التمارين العملية في دورة {course} في اتخاذ قرارك؟'],
  F09: ['level', 'Would you like us to check whether {course} fits your current level?', 'هل ترغب في أن نتحقق من ملاءمة دورة {course} لمستواك الحالي؟'],
  F10: ['certificate', 'Would you like admissions to confirm the exact certificate for {course}?', 'هل ترغب في أن يؤكد لك فريق القبول نوع شهادة دورة {course}؟'],
  F11: ['shared_material', 'Was there anything in the {course} information we shared that you’d like us to explain?', 'هل هناك نقطة تود توضيحها في المعلومات التي أرسلناها عن دورة {course}؟'],
  F12: ['application', 'Would you like us to walk you through applying for {course}?', 'هل ترغب في أن نوضح لك خطوات التقديم لدورة {course}؟'],
  F13: ['comparison', 'If you’re comparing {course} with another option, what would you most like to learn?', 'إذا كنت تقارن دورة {course} بخيار آخر، فما أهم مهارة ترغب في تعلمها؟'],
  F14: ['timing', 'Is there a month that would suit you better for {course}? We can check options for that period.', 'هل هناك شهر أنسب لك لدورة {course}؟ يمكننا التحقق من الخيارات خلال تلك الفترة.'],
  F15: ['close', 'Would you prefer we leave your {course} enquiry with you for now? You’re welcome to message us when you’re ready.', 'هل تفضل ترك استفسارك عن دورة {course} لوقت لاحق؟ يمكنك مراسلتنا عندما يناسبك.'],
};

function render(id, course, language) {
  const greeting = language === 'ar' ? 'مرحبًا، معك مركز برو كاتاليست للتدريب. ' : 'Hi, it’s Pro Catalyst Training Center. ';
  return greeting + variants[id][language === 'ar' ? 2 : 1].replace('{course}', () => course);
}

module.exports = { variants, render };
