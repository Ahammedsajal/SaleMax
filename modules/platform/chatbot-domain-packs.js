'use strict';

const registry = new Map();
const PACK_KEY = /^[a-z][a-z0-9_]{1,79}$/;
const FIELD_PATH = /^[A-Za-z][A-Za-z0-9]*(?:\.[A-Za-z][A-Za-z0-9]*)*$/;

function plainRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

function valueAtPath(value, path) {
  return path.split('.').reduce((current, key) => current && Object.hasOwn(current, key) ? current[key] : undefined, value);
}

function validateGuidedContentContract(defaults, schema) {
  if (defaults == null && schema == null) return;
  if (!plainRecord(defaults) || !plainRecord(schema) || !Array.isArray(schema.groups) || !schema.groups.length || schema.groups.length > 30) {
    throw Object.assign(new Error('INVALID_CHATBOT_GUIDED_CONTENT_CONTRACT'), { code: 'INVALID_CHATBOT_GUIDED_CONTENT_CONTRACT' });
  }

  const groupIds = new Set();
  const fields = new Map();
  for (const group of schema.groups) {
    if (!plainRecord(group) || typeof group.id !== 'string' || !/^[a-z][a-z0-9-]{1,79}$/.test(group.id) || groupIds.has(group.id)
      || !plainRecord(group.title) || !['en', 'ar'].every(language => typeof group.title[language] === 'string' && group.title[language].trim())
      || !Array.isArray(group.fields) || group.fields.length > 100) {
      throw Object.assign(new Error('INVALID_CHATBOT_GUIDED_CONTENT_CONTRACT'), { code: 'INVALID_CHATBOT_GUIDED_CONTENT_CONTRACT' });
    }
    groupIds.add(group.id);
    for (const field of group.fields) {
      if (!plainRecord(field) || typeof field.path !== 'string' || !FIELD_PATH.test(field.path) || fields.has(field.path)
        || !plainRecord(field.label) || !['en', 'ar'].every(language => typeof field.label[language] === 'string' && field.label[language].trim())) {
        throw Object.assign(new Error('INVALID_CHATBOT_GUIDED_CONTENT_CONTRACT'), { code: 'INVALID_CHATBOT_GUIDED_CONTENT_CONTRACT' });
      }
      const value = valueAtPath(defaults, field.path);
      if (field.type === 'localized-text') {
        if (!plainRecord(value) || !['en', 'ar'].every(language => typeof value[language] === 'string')
          || !Number.isSafeInteger(field.maxLength) || field.maxLength < 1 || field.maxLength > 4000) {
          throw Object.assign(new Error('INVALID_CHATBOT_GUIDED_CONTENT_CONTRACT'), { code: 'INVALID_CHATBOT_GUIDED_CONTENT_CONTRACT' });
        }
      } else if (field.type === 'boolean') {
        if (typeof value !== 'boolean') throw Object.assign(new Error('INVALID_CHATBOT_GUIDED_CONTENT_CONTRACT'), { code: 'INVALID_CHATBOT_GUIDED_CONTENT_CONTRACT' });
      } else if (field.type === 'integer') {
        if (!Number.isSafeInteger(value) || !Number.isSafeInteger(field.min) || !Number.isSafeInteger(field.max) || field.min > value || value > field.max) {
          throw Object.assign(new Error('INVALID_CHATBOT_GUIDED_CONTENT_CONTRACT'), { code: 'INVALID_CHATBOT_GUIDED_CONTENT_CONTRACT' });
        }
      } else {
        throw Object.assign(new Error('INVALID_CHATBOT_GUIDED_CONTENT_CONTRACT'), { code: 'INVALID_CHATBOT_GUIDED_CONTENT_CONTRACT' });
      }
      fields.set(field.path, field.type);
    }
  }

  // Version is pack metadata; every other default must have an editor field so
  // category authors cannot silently ship settings that tenants cannot change.
  function assertEditableDefaults(value, path = '') {
    if (path === 'version') return;
    if (plainRecord(value)) {
      if (path && fields.get(path) === 'localized-text') return;
      for (const [key, child] of Object.entries(value)) assertEditableDefaults(child, path ? `${path}.${key}` : key);
      return;
    }
    const expectedType = typeof value === 'boolean' ? 'boolean' : Number.isSafeInteger(value) ? 'integer' : null;
    if (!expectedType || fields.get(path) !== expectedType) {
      throw Object.assign(new Error('INVALID_CHATBOT_GUIDED_CONTENT_CONTRACT'), { code: 'INVALID_CHATBOT_GUIDED_CONTENT_CONTRACT' });
    }
  }
  assertEditableDefaults(defaults);
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}

const TRAINING_CENTER_GUIDED_DEFAULTS = {
  version: 1,
  messages: {
    greeting: { en: 'Hi! 👋 Welcome to Pro Catalyst Training Center. I’m happy to help you find a course that fits what you’re looking for.', ar: 'مرحباً بك في مركز برو كاتاليست للتدريب 👋 يسعدني مساعدتك في اختيار الدورة المناسبة لك.' },
    menuPrompt: { en: 'Reply with a number, or simply tell me what you have in mind.', ar: 'أرسل رقم الخيار أو أخبرني ببساطة بما تبحث عنه.' },
    admissionsLabel: { en: 'Chat with our team', ar: 'التواصل مع فريقنا' },
    coursesLabel: { en: 'View courses', ar: 'عرض الدورات' },
    enquiryLabel: { en: 'Enquiry form', ar: 'نموذج الاستفسار' },
    applicationLabel: { en: 'Course application', ar: 'طلب الالتحاق بالدورة' },
    mainMenuLabel: { en: 'Main menu', ar: 'القائمة الرئيسية' },
    courseListHeading: { en: 'Available courses', ar: 'الدورات المتاحة' },
    courseListEmpty: { en: 'Our course list is being updated. Type agent and our team will help you.', ar: 'نعمل على تحديث قائمة الدورات. اكتب موظف وسيساعدك فريقنا.' },
    courseListPrompt: { en: 'Reply with a course number to see details, or send 0 for the menu.', ar: 'أرسل رقم الدورة لعرض التفاصيل، أو أرسل 0 للقائمة.' },
    feeUnavailable: { en: 'Our team can confirm the fee for you.', ar: 'يمكن لفريقنا تأكيد الرسوم لك.' },
    durationLabel: { en: 'Duration', ar: 'المدة' },
    deliveryLabel: { en: 'Delivery', ar: 'طريقة الدراسة' },
    currentFeeLabel: { en: 'Current fee', ar: 'الرسوم الحالية' },
    registrationFeeLabel: { en: 'Registration fee', ar: 'رسوم التسجيل' },
    batchesHeading: { en: 'Upcoming batches', ar: 'المجموعات القادمة' },
    noUpcomingBatches: { en: 'Our team can help you find the next start date.', ar: 'يمكن لفريقنا مساعدتك في معرفة موعد البداية القادم.' },
    batchSeatsLabel: { en: 'seats available', ar: 'المقاعد المتاحة' },
    enquiryPrompt: { en: 'Share your details here and our team will get in touch:', ar: 'شارك بياناتك هنا وسيتواصل معك فريقنا:' },
    enquiryUnavailable: { en: 'Type agent and our team will help with your enquiry.', ar: 'اكتب موظف وسيساعدك فريقنا في استفسارك.' },
    courseDetailsPrompt: { en: 'Would you like to know anything else about this course?', ar: 'هل تود معرفة شيء آخر عن هذه الدورة؟' },
    applicationOfferMessage: { en: 'If it feels right, I can send the application form whenever you’re ready.', ar: 'إذا كانت الدورة مناسبة لك، يمكنني إرسال نموذج التقديم عندما تكون مستعداً.' },
    applicationLinkIntro: { en: 'Of course — here’s the application form. Take your time, and message me here if you’d like help with any part:', ar: 'بكل سرور — إليك نموذج التقديم. خذ وقتك، وأرسل لي هنا إذا رغبت بالمساعدة في أي جزء:' },
    invalidSelection: { en: 'Please choose a course number from this list.', ar: 'يرجى اختيار رقم دورة من هذه القائمة.' },
    handoffMessage: { en: 'I’ll leave this with our team so they can help you personally.', ar: 'سأترك المحادثة لفريقنا ليتمكن من مساعدتك مباشرة.' },
    simpleDurationMessage: { en: '{course} takes {duration}.', ar: 'مدة {course} هي {duration}.' },
    durationUnavailable: { en: 'The duration for {course} isn’t published yet. Our team can confirm it for you.', ar: 'مدة {course} غير منشورة حالياً. يمكن لفريقنا تأكيدها لك.' },
    simpleFeeMessage: { en: '{course} is currently {fee}.{registration}', ar: 'رسوم {course} حالياً {fee}.{registration}' },
    collectNameMessage: { en: 'May I have your name?', ar: 'ما اسمك؟' },
    collectCourseMessage: { en: 'Which course are you interested in?', ar: 'أي دورة تهمك؟' },
    nameCollectedMessage: { en: 'Thanks! What would you like to know about the course?', ar: 'شكراً! ما الذي تود معرفته عن الدورة؟' },
    clarificationMessage: { en: 'Happy to help — which course are you interested in? If you’d prefer our team, just type agent.', ar: 'حتى أساعدك بشكل أدق، أي دورة تهمك؟ وإذا أردت التحدث مع فريقنا، اكتب موظف.' },
    unavailableMessage: { en: 'I can’t confirm that from our published details yet. Type agent if you’d like our team to check it for you.', ar: 'لا أستطيع تأكيد ذلك من معلوماتنا المنشورة حالياً. اكتب موظف إذا أردت أن يتحقق فريقنا لك.' },
    fallbackMessage: { en: 'Could you try one of these options? Type agent if you’d like our team’s help.', ar: 'هل يمكنك اختيار أحد الخيارات؟ اكتب موظف إذا أردت مساعدة فريقنا.' },
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
      localizedField('messages.admissionsLabel', 'Staff menu label', 'عنوان خيار الموظف', 100),
      localizedField('messages.coursesLabel', 'Course menu label', 'عنوان خيار الدورات', 100),
      localizedField('messages.enquiryLabel', 'Enquiry menu label', 'عنوان خيار الاستفسار', 100),
      localizedField('messages.applicationLabel', 'Course application menu label', 'عنوان طلب الالتحاق', 100),
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
      localizedField('messages.applicationOfferMessage', 'Application form invitation after course details', 'دعوة نموذج التقديم بعد تفاصيل الدورة'),
      localizedField('messages.applicationLinkIntro', 'Application form link introduction', 'مقدمة رابط نموذج التقديم'),
    ] },
    { id: 'support', title: { en: 'Fallback and staff handoff', ar: 'الرد البديل والتحويل للموظفين' }, fields: [
      localizedField('messages.simpleDurationMessage', 'Short duration reply: {course}, {duration}', 'رد المدة المختصر: {course}, {duration}'),
      localizedField('messages.durationUnavailable', 'Duration not published: {course}', 'المدة غير منشورة: {course}'),
      localizedField('messages.simpleFeeMessage', 'Short Hybrid fee reply: {course}, {fee}, {registration}', 'رد الرسوم الهجين المختصر: {course}, {fee}, {registration}'),
      localizedField('messages.collectNameMessage', 'Ask for learner name', 'طلب اسم المتعلم'),
      localizedField('messages.collectCourseMessage', 'Ask for interested course', 'طلب الدورة المطلوبة'),
      localizedField('messages.nameCollectedMessage', 'Name received reply', 'رد استلام الاسم'),
      localizedField('messages.clarificationMessage', 'Course clarification message', 'رسالة توضيح الدورة'),
      localizedField('messages.unavailableMessage', 'Unpublished information message', 'رسالة المعلومات غير المنشورة'),
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
  validateGuidedContentContract(pack.guidedContentDefaults, pack.guidedContentSchema);
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
    guidedContentDefaults: pack.guidedContentDefaults ? deepFreeze(JSON.parse(JSON.stringify(pack.guidedContentDefaults))) : null,
    guidedContentSchema: pack.guidedContentSchema ? deepFreeze(JSON.parse(JSON.stringify(pack.guidedContentSchema))) : null,
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
      c.outcomes_en AS outcomesEn,c.outcomes_ar AS outcomesAr,c.revision AS revision,c.updated_at AS updatedAt,c.duration_value AS durationValue,c.duration_unit AS durationUnit,c.delivery_mode AS deliveryMode,
      (SELECT JSON_OBJECT('currency',o.currency,'priceMinor',o.price_minor,'registrationFeeMinor',o.registration_fee_minor)
        FROM sx_training_offers o WHERE o.tenant_id=c.tenant_id AND o.course_id=c.id AND o.status='active' AND (o.valid_from IS NULL OR o.valid_from<=?) AND (o.valid_until IS NULL OR o.valid_until>=?) ORDER BY o.version DESC LIMIT 1) AS offer
    FROM sx_training_courses c WHERE c.tenant_id=? AND c.status='active' ORDER BY c.updated_at DESC LIMIT 500`, [today,today,tenantId]);
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
  let media = [];
  if (courses.length) {
    [media] = await db.query(`SELECT m.id,m.course_id AS courseId,m.media_kind AS kind,m.mime_type AS mimeType,m.original_name AS filename,m.file_size_bytes AS sizeBytes
      FROM sx_training_course_media m JOIN sx_training_courses c ON c.tenant_id=m.tenant_id AND c.id=m.course_id
      WHERE m.tenant_id=? AND c.status='active' AND c.deleted_at IS NULL AND m.deleted_at IS NULL
        AND ((m.media_kind='image' AND m.file_size_bytes<=5242880) OR (m.mime_type='application/pdf' AND m.file_size_bytes<=20971520))
      ORDER BY m.created_at DESC,m.id`, [tenantId]);
  }
  const facts = courses.map(row => {
    const rawOffer = typeof row.offer === 'string' ? JSON.parse(row.offer) : row.offer;
    const { id, ...course } = row;
    return {
      ...course,
      courseId: id,
      media: media.filter(item => item.courseId === id).map(({ courseId, ...item }) => item),
      offer: normalizeOffer(rawOffer),
      batches: batchesByCourse.get(String(id)) || [],
    };
  });
  const [forms] = await db.query(`SELECT t.slug AS tenantSlug,v.slug AS formSlug,f.id AS formId,v.version AS publishedVersion,v.name_en AS nameEn,v.name_ar AS nameAr,JSON_UNQUOTE(JSON_EXTRACT(v.schema_json,'$.templateKey')) AS templateKey
    FROM sx_training_forms f JOIN sx_training_form_versions v ON v.tenant_id=f.tenant_id AND v.form_id=f.id AND v.version=f.published_version
    JOIN sx_tenants t ON t.id=f.tenant_id
    WHERE f.tenant_id=? AND f.status='published' AND f.published_version IS NOT NULL ORDER BY f.updated_at DESC,f.id LIMIT 10`, [tenantId]);
  for (const form of forms) {
    const url = publicFormUrl(platformOrigin, form.tenantSlug, form.formSlug);
    if (url) facts.push({ kind: 'published_enquiry_form', url, formId: form.formId, publishedVersion: form.publishedVersion, nameEn: form.nameEn, nameAr: form.nameAr, purpose: form.templateKey === 'procatalyst-registration-v1' || form.formSlug === 'student-registration' ? 'registration' : 'enquiry' });
  }
  const [[business]] = await db.query(`SELECT display_name_en AS nameEn,display_name_ar AS nameAr,website_url AS website,email,phone,address_en AS addressEn,address_ar AS addressAr,google_maps_url AS mapsUrl,opening_hours AS openingHours,about_en AS aboutEn,about_ar AS aboutAr,revision,updated_at AS updatedAt FROM sx_training_center_profiles WHERE tenant_id=?`, [tenantId]);
  if (business) facts.push({ kind: 'business_profile', ...business });
  return facts;
}

registerDomainPack({
  key: 'training_center',
    version: 1,
    title: 'Training center',
    requiresDatabase: true,
  systemGuidance: 'Use only tenant-approved FAQs and the live course, offer, batch, and published form facts supplied in context. Describe each form using its supplied purpose and name: registration and enquiry are different. Never claim enrolment or form submission is already completed. Do not speculate about what submitting a form does. Never invent fees, dates, seat counts, discounts, certificates, admissions, invoices, or payment state.',
  loadFacts: trainingCenterFacts,
  guidedContentDefaults: TRAINING_CENTER_GUIDED_DEFAULTS,
  guidedContentSchema: TRAINING_CENTER_GUIDED_SCHEMA,
  guidedReply: ({ message, state, facts, config }) => require('./chatbot-training-guide').trainingCenterGuidedReply({ message, state, facts, config, defaults: TRAINING_CENTER_GUIDED_DEFAULTS }),
  isGuidedIntent: require('./chatbot-training-guide').shouldStartGuided,
});

module.exports = { registerDomainPack, getDomainPack, publicFormUrl, amountFromMinorUnits, normalizeOffer };
