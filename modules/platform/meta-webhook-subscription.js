'use strict';

const DEFAULT_GRAPH_VERSION = 'v26.0';

async function subscribeWabaWebhook({
  wabaId,
  accessToken,
  apiVersion = DEFAULT_GRAPH_VERSION,
  fetchImpl = global.fetch,
}) {
  const accountId = String(wabaId || '').trim();
  const token = String(accessToken || '').trim();
  const version = String(apiVersion || '').trim();

  if (!/^\d{6,40}$/.test(accountId)) {
    throw new Error('Meta WhatsApp Business Account ID is invalid');
  }
  if (!token || token.length > 4096) {
    throw new Error('Meta access token is invalid');
  }
  if (!/^v\d+\.\d+$/.test(version)) {
    throw new Error('Meta Graph API version is invalid');
  }
  if (typeof fetchImpl !== 'function') {
    throw new Error('Meta Graph API transport is unavailable');
  }

  let response;
  try {
    response = await fetchImpl(
      `https://graph.facebook.com/${version}/${encodeURIComponent(accountId)}/subscribed_apps`,
      {
        method: 'POST',
        headers: {
          accept: 'application/json',
          authorization: `Bearer ${token}`,
        },
      },
    );
  } catch (_) {
    throw new Error('Meta could not be reached to subscribe WhatsApp webhooks');
  }

  let payload;
  try {
    const text = await response.text();
    if (Buffer.byteLength(text, 'utf8') > 65536) throw new Error('too large');
    payload = text ? JSON.parse(text) : {};
  } catch (_) {
    throw new Error('Meta returned an invalid WhatsApp webhook subscription response');
  }

  if (!response.ok || (payload.success !== true && payload.success !== 'true')) {
    throw new Error('Meta rejected the WhatsApp webhook subscription');
  }

  return { subscribed: true, wabaId: accountId };
}

module.exports = { subscribeWabaWebhook };
