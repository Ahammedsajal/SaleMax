'use strict';

const GUIDED_DEFAULTS = {
  version: 1,
  messages: {
    greeting: { en: 'Hello! I can help you explore our property listings.', ar: 'مرحباً! يمكنني مساعدتك في استكشاف العقارات المعروضة.' },
    menuPrompt: { en: 'Ask about a listing, or type agent to speak with our team.', ar: 'اسأل عن أحد العقارات أو اكتب موظفاً للتواصل مع فريقنا.' },
    listingsHeading: { en: 'Active property listings', ar: 'العقارات المعروضة حالياً' },
    noListings: { en: 'There are no active listings to share right now. Our team can help you.', ar: 'لا توجد عقارات معروضة حالياً. يمكن لفريقنا مساعدتك.' },
    listingPrompt: { en: 'Send a listing reference or number for details. A viewing must be confirmed by our team.', ar: 'أرسل رقم الإعلان أو رقمه المرجعي لمعرفة التفاصيل. يجب تأكيد موعد المعاينة من فريقنا.' },
    handoff: { en: 'I’ll ask our team to help with this request. They will confirm the details with you.', ar: 'سأطلب من فريقنا مساعدتك في هذا الطلب وسيؤكدون التفاصيل معك.' },
    unavailable: { en: 'I can’t confirm that from the active listings. Our team can check it for you.', ar: 'لا أستطيع تأكيد ذلك من العقارات المعروضة. يمكن لفريقنا التحقق لك.' },
  },
  display: { maxProperties: 5, showPrice: true, showArea: true },
};

const localized = (path, en, ar, maxLength = 400) => ({
  path, type: 'localized-text', label: { en, ar }, maxLength,
});
const toggle = (path, en, ar) => ({ path, type: 'boolean', label: { en, ar } });
const GUIDED_SCHEMA = {
  groups: [
    { id: 'property-greeting', title: { en: 'Greeting and listing menu', ar: 'الترحيب وقائمة العقارات' }, fields: [
      localized('messages.greeting', 'Greeting', 'رسالة الترحيب'),
      localized('messages.menuPrompt', 'Menu instructions', 'تعليمات القائمة'),
      localized('messages.listingsHeading', 'Listings heading', 'عنوان العقارات'),
      localized('messages.noListings', 'No active listings', 'رسالة عدم توفر عقارات'),
      localized('messages.listingPrompt', 'Listing details instructions', 'تعليمات تفاصيل العقارات'),
      { path: 'display.maxProperties', type: 'integer', label: { en: 'Maximum listings to show', ar: 'الحد الأقصى للعقارات المعروضة' }, min: 1, max: 8 },
      toggle('display.showPrice', 'Show published asking prices', 'إظهار الأسعار المنشورة'),
      toggle('display.showArea', 'Show published property areas', 'إظهار المساحات المنشورة'),
    ] },
    { id: 'property-handoff', title: { en: 'Staff handoff', ar: 'التحويل إلى فريق العمل' }, fields: [
      localized('messages.handoff', 'Staff handoff message', 'رسالة التحويل إلى الفريق'),
      localized('messages.unavailable', 'Unconfirmed property details', 'رسالة التفاصيل غير المؤكدة'),
    ] },
  ],
};

async function loadFacts({ db, tenantId }) {
  const [rows] = await db.query(`SELECT p.id AS sourceId,p.reference_code AS referenceCode,
      p.title_en AS titleEn,p.title_ar AS titleAr,p.property_type AS propertyType,
      p.transaction_type AS transactionType,p.price_minor AS priceMinor,p.currency,
      p.area_sqm AS areaSqm,p.bedrooms,p.bathrooms,p.city,p.description_en AS descriptionEn,
      p.description_ar AS descriptionAr,p.updated_at AS updatedAt
    FROM sx_real_estate_properties p
    JOIN sx_tenants t ON t.id=p.tenant_id AND t.category_key='real_estate'
      AND t.category_version IN (1,2,3,4,5) AND t.status='active'
    WHERE p.tenant_id=? AND p.status='active' AND p.chatbot_visible=1
    ORDER BY p.updated_at DESC,p.id LIMIT 50`, [tenantId]);
  return rows;
}

function isGuidedIntent(message) {
  return /\b(?:hello|hi|properties|property|listing|listings|viewing|view|visit|appointment|schedule|buy|rent|agent)\b|مرحبا|السلام|عقار|عقارات|إعلان|اعلان|معاينة|مشاهدة|زيارة|موعد|جدولة|شراء|إيجار|ايجار|موظف/iu.test(String(message || ''));
}

function languageFor(message, state) {
  return state?.language === 'ar' || /[\u0600-\u06ff]/u.test(String(message || '')) ? 'ar' : 'en';
}

function configured(config, path, language) {
  const value = path.split('.').reduce((current, key) => current?.[key], config);
  return typeof value?.[language] === 'string' && value[language].trim()
    ? value[language].trim() : GUIDED_DEFAULTS.messages[path.split('.').at(-1)][language];
}

function formatPrice(minor, currency, language) {
  const amount = Number(minor);
  if (!Number.isSafeInteger(amount) || !/^[A-Z]{3}$/.test(String(currency || ''))) return null;
  try {
    return new Intl.NumberFormat(language === 'ar' ? 'ar-QA' : 'en-QA', {
      style: 'currency', currency,
    }).format(amount / 100);
  } catch { return `${(amount / 100).toFixed(2)} ${currency}`; }
}

function guidedReply({ message, state = null, facts = [], config = {} }) {
  const language = languageFor(message, state);
  const text = String(message || '').trim();
  const handoff = /\b(?:agent|human|person|viewing|visit|appointment|schedule|book|reserve|offer|negotiate)\b|موظف|إنسان|انسان|شخص|معاينة|زيارة|موعد|جدولة|احجز|حجز|عرض|تفاوض/iu.test(text);
  if (handoff) return { reply: configured(config, 'messages.handoff', language), state: { ...(state || {}), language }, handoff: true };

  const items = Array.isArray(facts) ? facts.slice(0, 50) : [];
  const numericSelection = /^(?:\d{1,2}|[١-٨])$/.test(text);
  if (numericSelection && state?.step === 'property-list') {
    const index = Number(text.replace(/[١-٨]/g, digit => String('١٢٣٤٥٦٧٨'.indexOf(digit) + 1))) - 1;
    const selected = items.find(item => item.sourceId === state.propertyIds?.[index]);
    if (!selected) return { reply: configured(config, 'messages.unavailable', language), state: { language } };
    const title = language === 'ar' ? selected.titleAr : selected.titleEn;
    const description = language === 'ar' ? selected.descriptionAr : selected.descriptionEn;
    const price = config.display?.showPrice === false ? null : formatPrice(selected.priceMinor, selected.currency, language);
    const area = config.display?.showArea === false || selected.areaSqm == null ? null : `${selected.areaSqm} ${language === 'ar' ? 'م²' : 'm²'}`;
    const details = [selected.referenceCode, title, selected.city, price, area,
      selected.bedrooms == null ? null : `${selected.bedrooms} ${language === 'ar' ? 'غرف نوم' : 'bedrooms'}`,
      typeof description === 'string' && description.trim() ? description.trim().slice(0, 400) : null].filter(Boolean);
    return { reply: `${details.join(' · ')}\n${configured(config, 'messages.listingPrompt', language)}`, state: { ...state, language } };
  }

  if (/\b(?:hello|hi)\b|مرحبا|السلام/iu.test(text) || !items.length) {
    const greeting = configured(config, 'messages.greeting', language);
    const prompt = items.length
      ? configured(config, 'messages.menuPrompt', language)
      : configured(config, 'messages.noListings', language);
    return { reply: `${greeting}\n${prompt}`, state: { ...(state || {}), language } };
  }

  const limit = Number.isSafeInteger(config.display?.maxProperties)
    ? Math.max(1, Math.min(8, config.display.maxProperties)) : GUIDED_DEFAULTS.display.maxProperties;
  const shown = items.slice(0, limit);
  const heading = configured(config, 'messages.listingsHeading', language);
  const lines = shown.map((item, index) => {
    const title = language === 'ar' ? item.titleAr : item.titleEn;
    const price = config.display?.showPrice === false ? null : formatPrice(item.priceMinor, item.currency, language);
    const area = config.display?.showArea === false || item.areaSqm == null ? null : `${item.areaSqm} ${language === 'ar' ? 'م²' : 'm²'}`;
    return `${index + 1}. ${item.referenceCode} · ${title} · ${item.city}${price ? ` · ${price}` : ''}${area ? ` · ${area}` : ''}`;
  });
  const prompt = configured(config, 'messages.listingPrompt', language);
  return { reply: `${heading}\n${lines.join('\n')}\n${prompt}`, state: { language, step: 'property-list', propertyIds: shown.map(item => item.sourceId) } };
}

module.exports = { GUIDED_DEFAULTS, GUIDED_SCHEMA, loadFacts, isGuidedIntent, guidedReply };
