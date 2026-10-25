'use strict';

const SALES_SITE = 'https://7network.live/';
const CONTACT_URL = 'https://7network.live/#contact';
const languageFor = (message, state) => /[\u0600-\u06ff\u0750-\u077f\u08a0-\u08ff]/u.test(String(message || '')) || state?.language === 'ar' ? 'ar' : 'en';
const normalize = value => String(value || '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const menu = language => language === 'ar'
  ? 'يمكنني شرح كيف يساعد 7Network مراكز التدريب في تنظيم استفسارات الدورات ومتابعة العملاء المحتملين والتواصل مع الطلاب. اختر موضوعاً: نبذة عن النظام، المزايا، الأسعار، أو التواصل مع الفريق.'
  : 'I can explain how 7Network helps training centers organise course enquiries, follow up with prospective students and manage customer conversations. Ask about the platform, features, pricing or speaking with our team.';
const defaults = Object.freeze({ messages: { greeting: { en: `Hi! I’m Lucy from 7Network. We help businesses manage leads, customer follow-up, WhatsApp and daily operations in a customizable CRM. ${menu('en')}`, ar: `مرحباً! أنا لوسي من 7Network. نساعد الشركات على إدارة العملاء المحتملين والمتابعة وواتساب والعمليات اليومية عبر نظام CRM قابل للتخصيص. ${menu('ar')}` } } });

function trainingCenterProspectReply({ message, state = null }) {
  const language = languageFor(message, state);
  const input = normalize(message);
  const prior = state && typeof state === 'object' ? state : {};
  const isArabic = language === 'ar';
  const choose = (en, ar) => isArabic ? ar : en;
  let reply;
  const handoff = /^(?:talk to (?:a )?(?:person|human|team|sales)|speak to (?:a )?(?:person|human|team|sales)|contact sales|تحدث مع (?:الفريق|المبيعات|موظف)|اريد التواصل|أريد التواصل)$/u.test(input);
  if (handoff) return { reply: choose('I’ll hand this conversation to our team so they can help you directly.', 'سأحوّل المحادثة إلى فريقنا لمساعدتك مباشرة.'), state: { ...prior, language, greeted: true }, buttons: [], handoff: true, handoffReason: 'sales-prospect-requested-human' };
  if (prior.awaitingCenterName && input.length >= 2 && input.length <= 120) {
    reply = choose(`Thanks. I’ve recorded your enquiry for ${String(message).trim().slice(0, 120)}. What would you like to manage first: course enquiries, WhatsApp follow-up, campaigns or team workflows?`, `شكراً. سجلت استفساركم لمركز ${String(message).trim().slice(0, 120)}. ما الأولوية لديكم: استفسارات الدورات، متابعة واتساب، الحملات أم سير عمل الفريق؟`);
    return { reply, state: { ...prior, language, greeted: true, awaitingCenterName: false, topic: 'training_center' }, buttons: [] };
  }

  if (/^(?:menu|main menu|start over|القائمة|القائمة الرئيسية|الرئيسية)$/u.test(input)) {
    reply = menu(language);
  } else if (/(?:price|pricing|cost|fee|subscription|اسعار|أسعار|الاسعار|الأسعار|السعر|التكلفة|الاشتراك)/u.test(input)) {
    reply = choose('The current public plans are QAR 350 for 30 days or QAR 3,700 for 365 days (QAR 500 annual savings). Scope and any industry-specific custom work should be confirmed with our team. Details: https://7network.live/website/', 'الأسعار المنشورة حالياً هي 350 ريالاً قطرياً لمدة 30 يوماً أو 3,700 ريال لمدة 365 يوماً (توفير 500 ريال سنوياً). يرجى تأكيد النطاق وأي تخصيص خاص بقطاعكم مع فريقنا. التفاصيل: https://7network.live/website/');
  } else if (/(?:training|center|centre|course|student|batch|admission|مركز|تدريب|دورة|طالب|طلاب|دفعة|قبول)/u.test(input) || prior.topic === 'training_center') {
    reply = choose('For a training center, 7Network can provide a configurable CRM workflow for enquiries and student follow-up, with WhatsApp conversations, campaigns, automations, team work and reporting in one platform. We confirm the exact course, batch and finance modules for your setup before onboarding. What is your center’s name?', 'يمكن تهيئة 7Network لمركز التدريب لتنظيم الاستفسارات ومتابعة الطلاب، مع محادثات واتساب والحملات والأتمتة وعمل الفريق والتقارير في منصة واحدة. نؤكد الوحدات الدقيقة للدورات والدفعات والمالية قبل بدء الإعداد. ما اسم مركزكم؟');
  } else if (/(?:feature|what can|how does|crm|whatsapp|automation|campaign|مزايا|ماذا يقدم|كيف يعمل|واتساب|أتمتة|حملات|ادارة|إدارة)/u.test(input)) {
    reply = choose('7Network brings lead and customer management, WhatsApp inbox and campaigns, workflow automation, team follow-up and reporting together. Each business can have a category-specific setup. See https://7network.live/website/ for the current overview.', 'يجمع 7Network إدارة العملاء المحتملين والعملاء، وواتساب والحملات، وأتمتة سير العمل، ومتابعة الفريق والتقارير. ويمكن إعداد النظام بما يناسب قطاع كل شركة. للاطلاع على التفاصيل الحالية: https://7network.live/website/');
  } else if (/(?:demo|demonstration|consult|contact|trial|عرض تجريبي|تجربة|استشارة|تواصل)/u.test(input)) {
    reply = choose(`You can request a consultation using our enquiry form: ${CONTACT_URL}. Or tell me your training center’s name and what you would like to manage, and our team can follow up.`, `يمكنك طلب استشارة عبر نموذج التواصل: ${CONTACT_URL}. أو أرسل اسم مركز التدريب وما ترغب في إدارته، وسيتابع فريقنا معك.`);
  } else {
    reply = prior.greeted ? menu(language) : defaults.messages.greeting[language];
  }

  const awaitingCenterName = /what is your center|ما اسم مركزكم/iu.test(reply);
  return { reply, state: { ...prior, language, greeted: true, ...(awaitingCenterName ? { awaitingCenterName: true, topic: 'training_center' } : {}) }, buttons: [], handoff: false, link: SALES_SITE };
}

module.exports = { SALES_SITE, CONTACT_URL, defaults, trainingCenterProspectReply };
