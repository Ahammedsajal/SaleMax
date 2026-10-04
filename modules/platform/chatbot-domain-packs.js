'use strict';

const registry = new Map();
const PACK_KEY = /^[a-z][a-z0-9_]{1,79}$/;

const TRAINING_CENTER_GUIDED_DEFAULTS = {
  version: 1,
  messages: {
    greeting: { en: 'Welcome! I can help you explore our training courses.', ar: 'أهلاً بك! يمكنني مساعدتك في استكشاف الدورات التدريبية.' },
    menuPrompt: { en: 'Choose an option or type agent for staff help.', ar: 'اختر خياراً أو أرسل agent لمساعدة الموظفين.' },
    coursesLabel: { en: 'View courses', ar: 'عرض الدورات' },
    enquiryLabel: { en: 'Enquiry form', ar: 'نموذج الاستفسار' },
    mainMenuLabel: { en: 'Main menu', ar: 'القائمة الرئيسية' },
    courseListHeading: { en: 'Available courses', ar: 'الدورات المتاحة' },
    courseListEmpty: { en: 'There are no published courses available right now. Reply 0 for the main menu.', ar: 'لا توجد دورات منشورة متاحة حالياً. أرسل 0 للقائمة الرئيسية.' },
    courseListPrompt: { en: 'Reply with a course number for details, or 0 for the main menu.', ar: 'أرسل رقم الدورة للتفاصيل أو 0 للقائمة الرئيسية.' },
    feeUnavailable: { en: 'Fee details are not published.', ar: 'رسوم الدورة غير منشورة.' },
    durationLabel: { en: 'Duration', ar: 'المدة' },
    deliveryLabel: { en: 'Delivery', ar: 'طريقة الدراسة' },
    currentFeeLabel: { en: 'Current fee', ar: 'الرسوم الحالية' },
    registrationFeeLabel: { en: 'Registration fee', ar: 'رسوم التسجيل' },
    batchesHeading: { en: 'Upcoming batches', ar: 'المجموعات القادمة' },
    noUpcomingBatches: { en: 'No upcoming batch dates are published.', ar: 'لم تُنشر مواعيد مجموعات قادمة.' },
    batchSeatsLabel: { en: 'seats available', ar: 'المقاعد المتاحة' },
    enquiryPrompt: { en: 'Use the published enquiry form to contact the center:', ar: 'يمكنك استخدام نموذج الاستفسار المنشور للتواصل مع المركز:' },
    enquiryUnavailable: { en: 'Enquiries are not available through this chatbot right now. Type agent to contact the team.', ar: 'الاستفسارات غير متاحة عبر هذا الروبوت حالياً. أرسل agent للتواصل مع الفريق.' },
    courseDetailsPrompt: { en: 'Reply 1 to browse courses or 0 for the main menu.', ar: 'أرسل 1 لاستعراض الدورات أو 0 للقائمة الرئيسية.' },
    invalidSelection: { en: 'That selection is not available.', ar: 'هذا الاختيار غير متاح.' },
    handoffMessage: { en: 'I have paused the automated replies so the team can help you.', ar: 'تم إيقاف الردود الآلية مؤقتاً ليتمكن فريق العمل من مساعدتك.' },
    fallbackMessage: { en: 'I did not understand that selection. Please choose an option from the menu.', ar: 'أعتذر، لم أفهم الاختيار. يرجى اختيار أحد الخيارات من القائمة.' },
  },
  display: { maxCourses: 9, showFees: true, showDescription: true, showDuration: true, showDelivery: true, showRegistrationFee: true, showUpcomingBatches: true, showEnquiryForm: true },
};

const localizedField = (path, labelEn, labelAr, maxLength = 600) => ({ path, type: 'localized-text', label: { en: labelEn, ar: labelAr }, maxLength });
const toggleField = (path, labelEn, labelAr) => ({ path, type: 'boolean', label: { en: labelEn, ar: labelAr } });
const TRAINING_CENTER_GUIDED_SCHEMA = {
  groups: [
    { id: 'welcome-menu', title: { en: 'Greeting and menu', ar: 'الترحيب والقائمة' }, fields: [
      localizedField('messages.greeting', 'Greeting message', 'رسالة الترحيب'),
      localizedField('messages.menuPrompt', 'Menu instructions', 'تعليمات القائمة'),
      localizedField('messages.coursesLabel', 'Course menu label', 'عنوان خيار الدورات', 100),
      localizedField('messages.enquiryLabel', 'Enquiry menu label', 'عنوان خيار الاستفسار', 100),
      localizedField('messages.mainMenuLabel', 'Main menu label', 'عنوان القائمة الرئيسية', 100),
      toggleField('display.showEnquiryForm', 'Show the enquiry form option when one is published', 'إظهار خيار نموذج الاستفسار عند نشره'),
    ] },
    { id: 'course-list', title: { en: 'Course list', ar: 'قائمة الدورات' }, fields: [
      localizedField('messages.courseListHeading', 'Course list heading', 'عنوان قائمة الدورات', 160),
      localizedField('messages.courseListEmpty', 'No courses available message', 'رسالة عدم توفر الدورات'),
      localizedField('messages.courseListPrompt', 'Course list instructions', 'تعليمات قائمة الدورات'),
      { path: 'display.maxCourses', type: 'integer', label: { en: 'Maximum courses to show', ar: 'الحد الأقصى للدورات المعروضة' }, min: 1, max: 9 },
      toggleField('display.showFees', 'Show published course fees', 'إظهار رسوم الدورات المنشورة'),
    ] },
    { id: 'course-details', title: { en: 'Course details', ar: 'تفاصيل الدورة' }, fields: [
      toggleField('display.showDescription', 'Show published course description', 'إظهار وصف الدورة المنشور'),
      toggleField('display.showDuration', 'Show course duration', 'إظهار مدة الدورة'),
      localizedField('messages.durationLabel', 'Duration label', 'عنوان المدة', 120),
      toggleField('display.showDelivery', 'Show delivery mode', 'إظهار طريقة الدراسة'),
      localizedField('messages.deliveryLabel', 'Delivery mode label', 'عنوان طريقة الدراسة', 120),
      localizedField('messages.feeUnavailable', 'Fee not published message', 'رسالة عدم نشر الرسوم'),
      localizedField('messages.currentFeeLabel', 'Current fee label', 'عنوان الرسوم الحالية', 120),
      localizedField('messages.registrationFeeLabel', 'Registration fee label', 'عنوان رسوم التسجيل', 120),
      toggleField('display.showRegistrationFee', 'Show published registration fees', 'إظهار رسوم التسجيل المنشورة'),
      localizedField('messages.batchesHeading', 'Upcoming batches heading', 'عنوان المجموعات القادمة', 160),
      localizedField('messages.batchSeatsLabel', 'Available seats label', 'عنوان المقاعد المتاحة', 120),
      localizedField('messages.noUpcomingBatches', 'No upcoming batches message', 'رسالة عدم وجود مجموعات قادمة'),
      toggleField('display.showUpcomingBatches', 'Show published batch dates and seats', 'إظهار مواعيد المقاعد المنشورة'),
      localizedField('messages.enquiryPrompt', 'Enquiry form introduction', 'مقدمة نموذج الاستفسار'),
      localizedField('messages.enquiryUnavailable', 'Enquiry form not published message', 'رسالة عدم نشر نموذج الاستفسار'),
      localizedField('messages.courseDetailsPrompt', 'Course detail instructions', 'تعليمات تفاصيل الدورة'),
    ] },
    { id: 'support', title: { en: 'Fallback and staff handoff', ar: 'الرد البديل والتحويل للموظفين' }, fields: [
      localizedField('messages.invalidSelection', 'Invalid selection message', 'رسالة الاختيار غير الصحيح'),
      localizedField('messages.fallbackMessage', 'Fallback message', 'الرد عند عدم فهم الرسالة'),
      localizedField('messages.handoffMessage', 'Human handoff message', 'رسالة التحويل للموظف'),
    ] },
  ],
};

function registerDomainPack(pack) {
  if (!pack || typeof pack !== 'object' || !PACK_KEY.test(pack.key || '') || !Number.isSafeInteger(pack.version) || pack.version < 1 || typeof pack.loadFacts !== 'function' || typeof pack.systemGuidance !== 'string' || !pack.systemGuidance.trim() || (pack.guidedReply != null && typeof pack.guidedReply !== 'function') || (pack.isGuidedIntent != null && typeof pack.isGuidedIntent !== 'function') || (pack.guidedContentDefaults != null && (typeof pack.guidedContentDefaults !== 'object' || Array.isArray(pack.guidedContentDefaults))) || (pack.guidedContentSchema != null && (typeof pack.guidedContentSchema !== 'object' || Array.isArray(pack.guidedContentSchema)))) {
    throw Object.assign(new Error('INVALID_CHATBOT_DOMAIN_PACK'), { code: 'INVALID_CHATBOT_DOMAIN_PACK' });
  }
  const registryKey = `${pack.key}@${pack.version}`;
  if (registry.has(registryKey)) throw Object.assign(new Error('CHATBOT_DOMAIN_PACK_ALREADY_REGISTERED'), { code: 'CHATBOT_DOMAIN_PACK_ALREADY_REGISTERED' });
  const registered = Object.freeze({
    key: pack.key,
    version: pack.version,
    title: String(pack.title || pack.key).slice(0, 120),
    systemGuidance: pack.systemGuidance.trim().slice(0, 4000),
    requiresDatabase: pack.requiresDatabase === true,
    loadFacts: pack.loadFacts,
    guidedReply: pack.guidedReply || null,
    isGuidedIntent: pack.isGuidedIntent || null,
    guidedContentDefaults: pack.guidedContentDefaults || null,
    guidedContentSchema: pack.guidedContentSchema || null,
  });
  registry.set(registryKey, registered);
  return registered;
}

function getDomainPack(key, version) {
  return registry.get(`${key}@${Number(version)}`) || Object.freeze({
    key: 'faq_only',
    version: 1,
    title: String(key || 'business').replace(/[^a-z0-9 _-]/gi, '').slice(0, 80) || 'business',
    systemGuidance: 'Answer only from the tenant-approved FAQ facts. Do not infer business policies, prices, schedules, availability, bookings, or transaction status. If the facts do not fully answer the question, abstain and request staff follow-up.',
    loadFacts: async () => [],
    guidedContentDefaults: null,
    guidedContentSchema: null,
  });
}

function publicFormUrl(origin, tenantSlug, formSlug) {
  if (typeof origin !== 'string' || !tenantSlug || !formSlug) return null;
  try {
    const base = new URL(origin);
    const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname);
    if (base.protocol !== 'https:' && !(process.env.LOCAL_ONLY_MODE === 'true' && loopback && base.protocol === 'http:')) return null;
    return new URL(`/p/${encodeURIComponent(tenantSlug)}/forms/${encodeURIComponent(formSlug)}`, base).href;
  } catch { return null; }
}

function amountFromMinorUnits(value, currency) {
  const minor = Number(value);
  if (!Number.isSafeInteger(minor) || typeof currency !== 'string' || !/^[A-Z]{3}$/i.test(currency)) return null;
  try {
    const code = currency.toUpperCase();
    const digits = new Intl.NumberFormat('en', { style: 'currency', currency: code }).resolvedOptions().maximumFractionDigits;
    return (minor / (10 ** digits)).toFixed(digits);
  } catch { return null; }
}

function normalizeOffer(raw) {
  if (!raw || typeof raw !== 'object') return raw;
  const currency = typeof raw.currency === 'string' ? raw.currency.toUpperCase() : null;
  const offer = {};
  if (currency) offer.currency = currency;
  const priceAmount = amountFromMinorUnits(raw.priceMinor, currency);
  const registrationFeeAmount = amountFromMinorUnits(raw.registrationFeeMinor, currency);
  if (priceAmount !== null) offer.priceAmount = priceAmount;
  if (registrationFeeAmount !== null) offer.registrationFeeAmount = registrationFeeAmount;
  return offer;
}

async function trainingCenterFacts({ db, tenantId, platformOrigin }) {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Qatar', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const [courses] = await db.query(`SELECT c.id,c.code,c.name_en AS nameEn,c.name_ar AS nameAr,c.description_en AS descriptionEn,c.description_ar AS descriptionAr,
      c.outcomes_en AS outcomesEn,c.outcomes_ar AS outcomesAr,c.duration_value AS durationValue,c.duration_unit AS durationUnit,c.delivery_mode AS deliveryMode,
      (SELECT JSON_OBJECT('currency',o.currency,'priceMinor',o.price_minor,'registrationFeeMinor',o.registration_fee_minor)
        FROM sx_training_offers o WHERE o.tenant_id=c.tenant_id AND o.course_id=c.id AND o.status='active' AND (o.valid_from IS NULL OR o.valid_from<=?) AND (o.valid_until IS NULL OR o.valid_until>=?) ORDER BY o.version DESC LIMIT 1) AS offer
    FROM sx_training_courses c WHERE c.tenant_id=? AND c.status='active' ORDER BY c.updated_at DESC LIMIT 30`, [today,today,tenantId]);
  let batches = [];
  if (courses.length) {
    [batches] = await db.query(`WITH ranked_batches AS (
      SELECT b.course_id,b.code,b.starts_on,b.ends_on,b.language_code,b.status,b.capacity,b.reserved_seats,
        ROW_NUMBER() OVER (PARTITION BY b.course_id ORDER BY b.starts_on,b.id) AS batch_rank
      FROM sx_training_batches b
      WHERE b.tenant_id=? AND b.status IN ('open','scheduled','full') AND b.starts_on>=?
    )
    SELECT course_id AS courseId,JSON_ARRAYAGG(JSON_OBJECT('code',code,'startsOn',starts_on,'endsOn',ends_on,'language',language_code,'status',status,'seatsAvailable',GREATEST(0,capacity-reserved_seats))) AS batches
    FROM ranked_batches WHERE batch_rank<=4 GROUP BY course_id`, [tenantId,today]);
  }
  const batchesByCourse = new Map(batches.map(row => [String(row.courseId), typeof row.batches === 'string' ? JSON.parse(row.batches) : row.batches]));
  const facts = courses.map(row => {
    const rawOffer = typeof row.offer === 'string' ? JSON.parse(row.offer) : row.offer;
    const { id, ...course } = row;
    return {
      ...course,
      offer: normalizeOffer(rawOffer),
      batches: batchesByCourse.get(String(id)) || [],
    };
  });
  const [[form]] = await db.query(`SELECT t.slug AS tenantSlug,v.slug AS formSlug
    FROM sx_training_forms f JOIN sx_training_form_versions v ON v.tenant_id=f.tenant_id AND v.form_id=f.id AND v.version=f.published_version
    JOIN sx_tenants t ON t.id=f.tenant_id
    WHERE f.tenant_id=? AND f.status='published' AND f.published_version IS NOT NULL LIMIT 1`, [tenantId]);
  const url = form && publicFormUrl(platformOrigin, form.tenantSlug, form.formSlug);
  if (url) facts.push({ kind: 'published_enquiry_form', url });
  return facts;
}

registerDomainPack({
  key: 'training_center',
    version: 1,
    title: 'Training center',
    requiresDatabase: true,
  systemGuidance: 'Use only tenant-approved FAQs and the live course, offer, batch, and published enquiry-form facts supplied in context. You may share the published enquiry form link when someone asks to enquire, enrol, register, or leave contact details; sharing it does not create a lead or enrolment. Never invent fees, dates, seat counts, discounts, certificates, admissions, invoices, or payment state.',
  loadFacts: trainingCenterFacts,
  guidedContentDefaults: TRAINING_CENTER_GUIDED_DEFAULTS,
  guidedContentSchema: TRAINING_CENTER_GUIDED_SCHEMA,
  guidedReply: ({ message, state, facts, config }) => require('./chatbot-training-guide').trainingCenterGuidedReply({ message, state, facts, config, defaults: TRAINING_CENTER_GUIDED_DEFAULTS }),
  isGuidedIntent: require('./chatbot-training-guide').shouldStartGuided,
});

module.exports = { registerDomainPack, getDomainPack, publicFormUrl, amountFromMinorUnits, normalizeOffer };
