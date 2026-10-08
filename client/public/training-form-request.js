((root, factory) => {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SXTrainingFormRequest = api;
})(globalThis, () => {
  'use strict';

  const RETRYABLE_STATUS = new Set([502, 503, 504]);

  async function post(fetchImpl, url, options, { retrySafe = false, delayMs = 250, onRetry } = {}) {
    const retry = async () => {
      onRetry?.();
      if (delayMs > 0) await new Promise(resolve => setTimeout(resolve, delayMs));
      return fetchImpl(url, options);
    };

    let response;
    try {
      response = await fetchImpl(url, options);
    } catch (error) {
      if (!retrySafe || !(error instanceof TypeError)) throw error;
      return retry();
    }

    return retrySafe && RETRYABLE_STATUS.has(response.status) ? retry() : response;
  }

  return Object.freeze({ post });
});
