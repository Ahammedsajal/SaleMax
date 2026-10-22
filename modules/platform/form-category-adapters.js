'use strict';

const definitions = Object.freeze({
  'generic-lead-capture-v1': Object.freeze({
    key: 'generic-lead-capture-v1',
    requiredCapabilities: Object.freeze(['portal.forms']),
  }),
});

function validateDeclaration(value, categoryCapabilities) {
  if (value === undefined) return undefined;
  const definition = definitions[value];
  if (!definition || !Array.isArray(categoryCapabilities)
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

module.exports = { validateDeclaration, resolve, supportsExecution };
