'use strict';

// The inbox has working configured-bot send and conversation-state adapters
// for WhatsApp QR and Meta only. Keep the API and inbound runtime on this
// exact allowlist until another adapter has end-to-end coverage.
const ORIGIN_CHANNELS = Object.freeze({
  meta: 'whatsapp_meta',
  qr: 'whatsapp_qr',
});

const SUPPORTED_CHANNEL_KINDS = Object.freeze(Object.values(ORIGIN_CHANNELS));

function channelFor(origin) {
  return ORIGIN_CHANNELS[String(origin || '').toLowerCase()] || null;
}

module.exports = { ORIGIN_CHANNELS, SUPPORTED_CHANNEL_KINDS, channelFor };
