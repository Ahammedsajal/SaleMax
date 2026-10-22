'use strict';

const definitions = Object.freeze({
  'training-registration-v1': Object.freeze({
    key: 'training-registration-v1',
    requiredCapabilities: Object.freeze([]),
    fieldKeys: Object.freeze(['contact_name','learner_name','phone','email','nationality','course_id','preferred_date','consent','student_id','certificate_name','qid','phone_res','address','city','social_contact','emergency_phone','local_address','city_state','birth_date','gender','graduated','source','referral_name','courses','student_agreement','tuition_qar','student_signature','student_signature_date','representative_signature','representative_signature_date','payment_plan','batch_id','payment_plan_id','staff_attended','level','class_day','class_time','enrollment_terms','course_selections']),
  }),
  'generic-lead-capture-v1': Object.freeze({
    key: 'generic-lead-capture-v1',
    requiredCapabilities: Object.freeze(['portal.forms']),
    fieldKeys: Object.freeze(['contact_name','phone','email','consent']),
  }),
});

function validateDeclaration(value, categoryCapabilities) {
  if (value === undefined) return undefined;
  const definition = definitions[value];
  if (!definition || value !== 'generic-lead-capture-v1' || !Array.isArray(categoryCapabilities)
    || definition.requiredCapabilities.some(capability => !categoryCapabilities.includes(capability))) {
    throw Object.assign(new Error('INVALID_CATEGORY_MANIFEST'), { code: 'INVALID_CATEGORY_MANIFEST' });
  }
  return definition.key;
}

function resolve(category) {
  if (!category || typeof category.key !== 'string' || !Number.isSafeInteger(category.version)) return null;
  if (category.formsAdapter === 'generic-lead-capture-v1') return 'generic-lead-capture-v1';
  // Training Center v1's registration adapter predates explicit manifest
  // declarations. Keep that exact historical contract; future versions must
  // declare a reviewed adapter before Forms can use them.
  if (category.key === 'training_center' && category.version === 1 && category.formsAdapter === undefined) {
    return 'training-registration-v1';
  }
  return null;
}

function supportsExecution(category, adapter) {
  return adapter === 'training-registration-v1' && resolve(category) === adapter;
}

function allowsField(adapter, key) {
  return Boolean(definitions[adapter]?.fieldKeys.includes(key));
}

module.exports = { validateDeclaration, resolve, supportsExecution, allowsField };
