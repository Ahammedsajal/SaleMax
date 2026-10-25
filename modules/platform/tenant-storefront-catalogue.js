'use strict';
const plans=require('./plans');
const categories=require('./categories');

// Only the storefront's explicitly published Training Center catalogue is
// public. Draft courses, expired offers, enrollment state and capacity are
// excluded. Opaque public IDs support stable links and do not authorize access.
async function trainingCourses(db,tenantId){
  const entitlement=await plans.loadEntitlements(db,tenantId);
  if(!entitlement||!['active','trial','grace'].includes(entitlement.status)||entitlement.categoryKey!=='training_center'||!entitlement.capabilities.includes('training.courses'))return [];
  const [rows]=await db.query(`SELECT c.id,c.name_en AS nameEn,c.name_ar AS nameAr,
    c.description_en AS descriptionEn,c.description_ar AS descriptionAr,
    c.duration_value AS durationValue,c.duration_unit AS durationUnit,
    c.delivery_mode AS deliveryMode,c.outcomes_en AS outcomesEn,c.outcomes_ar AS outcomesAr,
    c.prerequisites_en AS prerequisitesEn,c.prerequisites_ar AS prerequisitesAr,
    o.currency,o.price_minor AS priceMinor,o.registration_fee_minor AS registrationFeeMinor,
    o.inclusions,brochure.id AS brochureMediaId,brochure.original_name AS brochureName
    FROM sx_training_courses c
    JOIN sx_training_offers o ON o.tenant_id=c.tenant_id AND o.course_id=c.id
      AND o.status='active'
      AND (o.valid_from IS NULL OR o.valid_from<=DATE(CONVERT_TZ(UTC_TIMESTAMP(),'UTC','Asia/Qatar')))
      AND (o.valid_until IS NULL OR o.valid_until>=DATE(CONVERT_TZ(UTC_TIMESTAMP(),'UTC','Asia/Qatar')))
      AND o.version=(SELECT MAX(current_offer.version) FROM sx_training_offers current_offer
        WHERE current_offer.tenant_id=c.tenant_id AND current_offer.course_id=c.id AND current_offer.status='active'
          AND (current_offer.valid_from IS NULL OR current_offer.valid_from<=DATE(CONVERT_TZ(UTC_TIMESTAMP(),'UTC','Asia/Qatar')))
          AND (current_offer.valid_until IS NULL OR current_offer.valid_until>=DATE(CONVERT_TZ(UTC_TIMESTAMP(),'UTC','Asia/Qatar'))))
    LEFT JOIN sx_training_public_brochures selected ON selected.tenant_id=c.tenant_id AND selected.course_id=c.id
    LEFT JOIN sx_training_course_media brochure ON brochure.tenant_id=selected.tenant_id AND brochure.course_id=selected.course_id AND brochure.id=selected.media_id AND brochure.media_kind='document' AND brochure.mime_type='application/pdf' AND brochure.deleted_at IS NULL
    WHERE c.tenant_id=? AND c.status='active' AND c.deleted_at IS NULL
    ORDER BY c.name_en,c.id LIMIT 100`,[tenantId]);
  if(!rows.length)return [];
  const ids=rows.map(row=>row.id),[batches]=await db.query(`SELECT b.course_id AS courseId,DATE_FORMAT(b.starts_on,'%Y-%m-%d') AS startsOn,DATE_FORMAT(b.ends_on,'%Y-%m-%d') AS endsOn,b.language_code AS language,br.name_en AS branchNameEn,br.name_ar AS branchNameAr,br.address_en AS branchAddressEn,br.address_ar AS branchAddressAr FROM sx_training_batches b LEFT JOIN sx_tenant_branches br ON br.tenant_id=b.tenant_id AND br.id=b.branch_id AND br.status='active' AND br.public_enabled=1 WHERE b.tenant_id=? AND b.course_id IN (${ids.map(()=>'?').join(',')}) AND b.status IN ('scheduled','open') AND b.starts_on>=DATE(CONVERT_TZ(UTC_TIMESTAMP(),'UTC','Asia/Qatar')) AND (b.branch_id IS NULL OR br.id IS NOT NULL) ORDER BY b.starts_on,b.course_id LIMIT 500`,[tenantId,...ids]);
  const byCourse=new Map();for(const batch of batches){const list=byCourse.get(batch.courseId)||[];list.push({startsOn:batch.startsOn,endsOn:batch.endsOn,language:batch.language,...(batch.branchNameEn||batch.branchNameAr||batch.branchAddressEn||batch.branchAddressAr?{branchNameEn:batch.branchNameEn,branchNameAr:batch.branchNameAr,branchAddressEn:batch.branchAddressEn,branchAddressAr:batch.branchAddressAr}:{})});byCourse.set(batch.courseId,list);}
  return rows.map(row=>{const {id,...publicRow}=row;return {...publicRow,publicId:id,durationValue:Number(row.durationValue),priceMinor:Number(row.priceMinor),registrationFeeMinor:Number(row.registrationFeeMinor),inclusions:typeof row.inclusions==='string'?JSON.parse(row.inclusions):row.inclusions||[],brochureUrl:row.brochureMediaId?`/courses/${encodeURIComponent(id)}/brochure`:null,batches:byCourse.get(id)||[]};});
}
async function realEstateProperties(db,tenantId,categoryKey='real_estate',categoryVersion=1){
  const category=categories.getCategory(categoryKey,Number(categoryVersion));
  if(!category||category.key!=='real_estate'||!category.public||!category.capabilities.includes('realestate.listings'))return [];
  const entitlement=await plans.loadEntitlements(db,tenantId);
  if(!entitlement||!['active','trial','grace'].includes(entitlement.status)||entitlement.categoryKey!=='real_estate'||!entitlement.capabilities.includes('realestate.listings'))return [];
  const [rows]=await db.query(`SELECT p.id AS publicId,p.reference_code AS referenceCode,p.title_en AS titleEn,p.title_ar AS titleAr,
    p.property_type AS propertyType,p.transaction_type AS transactionType,p.price_minor AS priceMinor,p.currency,
    p.area_sqm AS areaSqm,p.bedrooms,p.bathrooms,p.city,
    IF(branch.public_enabled=1,branch.name_en,NULL) AS branchNameEn,
    IF(branch.public_enabled=1,branch.name_ar,NULL) AS branchNameAr,
    IF(branch.public_enabled=1,branch.address_en,NULL) AS branchAddressEn,
    IF(branch.public_enabled=1,branch.address_ar,NULL) AS branchAddressAr,
    p.description_en AS descriptionEn,p.description_ar AS descriptionAr
    FROM sx_real_estate_properties p LEFT JOIN sx_tenant_branches branch
      ON branch.tenant_id=p.tenant_id AND branch.id=p.branch_id AND branch.status='active'
    WHERE p.tenant_id=? AND p.status='active' AND (p.branch_id IS NULL OR branch.id IS NOT NULL)
    ORDER BY p.updated_at DESC,p.id LIMIT 100`,[tenantId]);
  return rows.map(row=>({...row,priceMinor:Number(row.priceMinor),areaSqm:row.areaSqm==null?null:Number(row.areaSqm)}));
}
module.exports={trainingCourses,realEstateProperties};
