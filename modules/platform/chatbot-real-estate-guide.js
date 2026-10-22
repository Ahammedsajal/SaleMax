'use strict';

const { getCategory } = require('./categories');
const { decision } = require('./policy');

const DEFAULTS = Object.freeze({
  version: 1,
  messages: {
    welcome: { en: 'Hello! I can help you explore the properties currently listed by our team.', ar: 'مرحباً! يمكنني مساعدتك في استكشاف العقارات المعروضة حالياً من فريقنا.' },
    listPrompt: { en: 'Here are some properties currently listed:', ar: 'إليك بعض العقارات المعروضة حالياً:' },
    noProperties: { en: 'There are no active property listings to show right now. Our team can help you directly.', ar: 'لا توجد عقارات نشطة لعرضها حالياً. يمكن لفريقنا مساعدتك مباشرة.' },
    detailPrompt: { en: 'Would you like our team to help with this property?', ar: 'هل ترغب أن يساعدك فريقنا بخصوص هذا العقار؟' },
    priceLabel: { en: 'Listed price', ar: 'السعر المعروض' },
    areaLabel: { en: 'Area', ar: 'المساحة' },
    bedroomsLabel: { en: 'Bedrooms', ar: 'غرف النوم' },
    humanHandoff: { en: 'I’ll ask our team to help you with the property details.', ar: 'سأطلب من فريقنا مساعدتك في تفاصيل العقار.' },
  },
  display: { maxProperties: 5, showPrices: true, showArea: true, showBedrooms: true },
});

const localized = (content, key, language) => content?.messages?.[key]?.[language] || DEFAULTS.messages[key][language];
const text = value => String(value || '').normalize('NFKC').toLowerCase().replace(/[أإآ]/g, 'ا').replace(/ى/g, 'ي').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
function languageFor(message, state) { return /[\u0600-\u06ff]/.test(message) || state?.language === 'ar' ? 'ar' : 'en'; }
function displayLimit(content) { const value = Number(content?.display?.maxProperties); return Number.isSafeInteger(value) ? Math.max(1, Math.min(10, value)) : DEFAULTS.display.maxProperties; }

async function loadFacts({ db, tenantId, context, config = {} }) {
  if (!db || !context || context.tenant?.id !== tenantId || context.category?.key !== 'real_estate' || context.category.version !== 3) return [];
  const access = decision(context, { capability: 'realestate.listings', permission: 'properties.read' });
  if (!access.allowed) return [];
  const [rows] = await db.query(`SELECT id,reference_code AS referenceCode,title_en AS titleEn,title_ar AS titleAr,
      property_type AS propertyType,transaction_type AS transactionType,price_minor AS priceMinor,currency,
      area_sqm AS areaSqm,bedrooms,city,description_en AS descriptionEn,description_ar AS descriptionAr
    FROM sx_real_estate_properties
    WHERE tenant_id=? AND status='active' AND chatbot_visible=1
    ORDER BY updated_at DESC,id LIMIT 100`, [tenantId]);
  const display = config.guidedContent?.display || config.display || {};
  return rows.map(row => ({
    ...row,
    kind: 'property',
    priceMinor: display.showPrices === false ? null : Number(row.priceMinor),
    currency: display.showPrices === false ? null : row.currency,
    areaSqm: display.showArea === false || row.areaSqm == null ? null : Number(row.areaSqm),
    bedrooms: display.showBedrooms === false ? null : row.bedrooms,
  }));
}

function formatPrice(property, language) {
  if (!Number.isSafeInteger(property.priceMinor) || !/^[A-Z]{3}$/.test(property.currency || '')) return null;
  try {
    const digits = new Intl.NumberFormat(language, { style: 'currency', currency: property.currency }).resolvedOptions().maximumFractionDigits;
    return new Intl.NumberFormat(language, { style: 'currency', currency: property.currency, maximumFractionDigits: digits }).format(property.priceMinor / (10 ** digits));
  } catch { return null; }
}

function propertyTitle(property, language) { return (language === 'ar' ? property.titleAr : property.titleEn) || property.titleEn || property.titleAr || property.referenceCode; }
function renderProperty(property, language, content) {
  const lines = [`${propertyTitle(property, language)} (${property.referenceCode})`, property.city];
  if (content?.display?.showPrices !== false) { const price = formatPrice(property, language); if (price) lines.push(`${localized(content, 'priceLabel', language)}: ${price}`); }
  if (content?.display?.showArea !== false && Number.isFinite(property.areaSqm)) lines.push(`${localized(content, 'areaLabel', language)}: ${new Intl.NumberFormat(language, { maximumFractionDigits: 2 }).format(property.areaSqm)} m²`);
  if (content?.display?.showBedrooms !== false && Number.isSafeInteger(property.bedrooms)) lines.push(`${localized(content, 'bedroomsLabel', language)}: ${property.bedrooms}`);
  const description = language === 'ar' ? property.descriptionAr : property.descriptionEn;
  if (description) lines.push(String(description).slice(0, 350));
  return lines.join('\n');
}

function guidedReply({ message, state = null, facts = [], config = {}, defaults = DEFAULTS }) {
  const properties = Array.isArray(facts) ? facts.filter(item => item?.kind === 'property' && item.referenceCode) : [];
  const language = languageFor(message, state);
  const content = config || defaults;
  const value = text(message);
  const nextState = { ...(state || {}), language, step: 'menu' };
  if (!state && /^(hi|hello|hey|مرحبا|اهلا|السلام عليكم|menu|القائمة|0)$/.test(value)) {
    return { reply: `${localized(content, 'welcome', language)}\n${localized(content, 'listPrompt', language)}\n${localized(content, 'detailPrompt', language)}`, state: nextState };
  }
  if (/^(agent|human|staff|موظف|بشر|تواصل|فريق)$/.test(value) || /\b(?:talk|speak|connect)\b.*\b(?:team|agent|person|human)\b|(?:تحدث|تواصل|اريد).*(?:فريق|موظف)/.test(value)) {
    return { reply: localized(content, 'humanHandoff', language), handoff: true, state: { ...nextState, step: 'handoff' } };
  }
  const matched = properties.find(property => value.includes(text(property.referenceCode)) || value.includes(text(property.titleEn)) || value.includes(text(property.titleAr)));
  if (matched) return { reply: `${renderProperty(matched, language, content)}\n${localized(content, 'detailPrompt', language)}`, state: { ...nextState, selectedReference: matched.referenceCode } };
  const wantsList = /\b(?:property|properties|listing|listings|house|houses|apartment|apartments|villa|villas|rent|buy|sale|available|show|options)\b|عقار|عقارات|شقة|فيلا|للبيع|للايجار|إيجار|عرض|خيارات/.test(value) || /^(1|next|التالي)$/.test(value);
  if (wantsList) {
    if (!properties.length) return { reply: localized(content, 'noProperties', language), state: nextState };
    const limit = displayLimit(content);
    const list = properties.slice(0, limit).map((property, index) => `${index + 1}. ${renderProperty(property, language, content)}`).join('\n\n');
    return { reply: `${localized(content, 'listPrompt', language)}\n\n${list}\n\n${localized(content, 'detailPrompt', language)}`, state: { ...nextState, listedReferences: properties.slice(0, limit).map(item => item.referenceCode) } };
  }
  return { reply: localized(content, 'detailPrompt', language), state: nextState };
}

module.exports = { DEFAULTS, loadFacts, guidedReply, formatPrice };
