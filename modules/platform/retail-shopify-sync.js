'use strict';

function compactShopifyQueries() {
  const after = '$after: String';
  const pageInfo = 'pageInfo { hasNextPage endCursor }';
  return {
    products: `query Products(${after}) { products(first: 25, after: $after, sortKey: ID) { edges { cursor node { id title descriptionHtml handle status productType updatedAt featuredImage { url altText } media(first: 12) { nodes { ... on MediaImage { image { url altText } } } } priceRangeV2 { minVariantPrice { amount currencyCode } } variantsCount { count } variants(first: 5) { nodes { id title sku price selectedOptions { name value } updatedAt } pageInfo { hasNextPage endCursor } } } } ${pageInfo} } }`,
    productVariants: 'query ProductVariants($productId: ID!, $after: String) { product(id: $productId) { id title descriptionHtml updatedAt variants(first: 100, after: $after) { nodes { id title sku price selectedOptions { name value } updatedAt } pageInfo { hasNextPage endCursor } } } }',
    orders: `query Orders(${after}) { orders(first: 10, after: $after, sortKey: ID) { edges { cursor node { id name displayFinancialStatus displayFulfillmentStatus cancelledAt closed currency totalPriceSet { shopMoney { amount currencyCode } } createdAt updatedAt shippingAddress { address1 address2 city province zip countryCodeV2 } customer { id firstName lastName email phone emailMarketingConsent { marketingState marketingOptInLevel consentUpdatedAt } defaultAddress { address1 address2 city province zip countryCodeV2 } } lineItems(first: 20) { nodes { id title quantity sku product { id } variant { id } originalUnitPriceSet { shopMoney { amount currencyCode } } } pageInfo { hasNextPage } } transactions(first: 20) { nodes { id kind status gateway createdAt amountSet { shopMoney { amount currencyCode } } } pageInfo { hasNextPage } } refunds { id createdAt totalRefundedSet { shopMoney { amount currencyCode } } transactions(first: 20) { nodes { id kind status gateway createdAt amountSet { shopMoney { amount currencyCode } } } pageInfo { hasNextPage } } } } } ${pageInfo} } }`,
    customers: `query Customers(${after}) { customers(first: 50, after: $after, sortKey: ID) { edges { cursor node { id firstName lastName email phone emailMarketingConsent { marketingState marketingOptInLevel consentUpdatedAt } updatedAt defaultAddress { address1 address2 city province zip countryCodeV2 } } } ${pageInfo} } }`,
    checkouts: `query Checkouts(${after}) { abandonedCheckouts(first: 20, after: $after, sortKey: ID) { edges { cursor node { id createdAt updatedAt completedAt abandonedCheckoutUrl totalPriceSet { shopMoney { amount currencyCode } } customer { id firstName lastName email phone emailMarketingConsent { marketingState marketingOptInLevel consentUpdatedAt } } lineItems(first: 20) { nodes { id title sku quantity originalUnitPriceSet { shopMoney { amount currencyCode } } } pageInfo { hasNextPage } } } } ${pageInfo} } }`,
  };
}

function queueVariantPage(queue, product) {
  const page = product?.variants?.pageInfo;
  if (!page?.hasNextPage) return false;
  const id = typeof product.id === 'string' ? product.id : '';
  if (!Array.isArray(queue) || !/^gid:\/\/shopify\/Product\/\d+$/.test(id) ||
      typeof page.endCursor !== 'string' || !page.endCursor || page.endCursor.length > 2048) {
    throw Object.assign(Error('SHOPIFY_SYNC_FAILED'), { code: 'SHOPIFY_SYNC_FAILED', status: 502 });
  }
  if (queue.some(item => item && item.productId === id)) return false;
  queue.push({ productId: id, after: page.endCursor });
  return true;
}

module.exports = { compactShopifyQueries, queueVariantPage };
