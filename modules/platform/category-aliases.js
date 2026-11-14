'use strict';

const legacyCategoryAliases = Object.freeze({ salemax_sales: '7network_sales' });
function canonicalCategoryKey(key) { return legacyCategoryAliases[key] || key; }
function categoryKeyMatches(left, right) {
  return typeof left === 'string' && typeof right === 'string' && canonicalCategoryKey(left) === canonicalCategoryKey(right);
}
function categoryKeysFor(key) {
  const canonical = canonicalCategoryKey(key);
  return [canonical, ...Object.keys(legacyCategoryAliases).filter(alias => legacyCategoryAliases[alias] === canonical)];
}

module.exports = { legacyCategoryAliases, canonicalCategoryKey, categoryKeyMatches, categoryKeysFor };
