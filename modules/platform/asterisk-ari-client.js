'use strict';

const asterisk = require('./asterisk-config');
const secrets = require('./asterisk-secrets');

const APP_NAME = 'salemax-call-center';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RESOURCE_ID = /^[A-Za-z0-9_.:-]{1,128}$/;
const EXTENSION = /^[0-9]{3,8}$/;
const fail = code => { throw Object.assign(new Error(code), { code }); };

function safeArgs(values) {
  if (!Array.isArray(values) || values.length > 8 || values.some(value => typeof value !== 'string'
    || value.length > 128 || !/^[A-Za-z0-9_.:+-]{1,128}$/.test(value))) fail('INVALID_ARI_APP_ARGS');
  return values.join(',');
}

function createAriClient(row, { fetchImpl = globalThis.fetch, timeoutMs = 5000, pool = null } = {}) {
  if (!row || !row.enabled || !row.ari_base_url || !row.ari_username || !row.credential_ciphertext) fail('ASTERISK_CONTROL_NOT_READY');
  const target = asterisk.endpoint(row.ari_base_url);
  asterisk.allowlisted(target.hostname);
  const password = secrets.decrypt(row);
  const origin = new URL(target.value);
  const authorization = `Basic ${Buffer.from(`${row.ari_username}:${password}`, 'utf8').toString('base64')}`;
  const revision = Number(row.revision);

  async function request(method, path, query = {}, body = undefined) {
    if (!['GET', 'POST', 'PUT', 'DELETE'].includes(method) || typeof path !== 'string'
      || path.startsWith('/') || path.includes('..') || path.includes('?') || path.includes('#')) fail('INVALID_ARI_REQUEST');
    if (pool) {
      const [[current]] = await pool.query('SELECT enabled,revision FROM sx_platform_asterisk_config WHERE id=1');
      if (!current?.enabled || Number(current.revision) !== revision) fail('ASTERISK_CONFIG_CHANGED');
    }
    const url = new URL(`${origin.pathname.replace(/\/$/, '')}/${path}`, origin.origin);
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null || value === '') continue;
      if (!/^[A-Za-z][A-Za-z0-9]*$/.test(key) || typeof value !== 'string' && typeof value !== 'number') fail('INVALID_ARI_REQUEST');
      url.searchParams.set(key, String(value));
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(url, {
        method, redirect: 'error', signal: controller.signal,
        headers: { Accept: 'application/json', Authorization: authorization, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      if (response.status === 401 || response.status === 403) fail('ARI_AUTH_REJECTED');
      if (response.status === 404) fail('ARI_RESOURCE_NOT_FOUND');
      if (response.status === 409) fail('ARI_CONFLICT');
      if (!response.ok) fail('ARI_UNAVAILABLE');
      if (response.status === 204) return null;
      const raw = await response.text();
      if (raw.length > 1024 * 1024) fail('ARI_INVALID_RESPONSE');
      let result;
      try { result = JSON.parse(raw); } catch (_) { fail('ARI_INVALID_RESPONSE'); }
      if (!result || typeof result !== 'object') fail('ARI_INVALID_RESPONSE');
      return result;
    } catch (error) {
      const known = ['ARI_AUTH_REJECTED', 'ARI_RESOURCE_NOT_FOUND', 'ARI_CONFLICT', 'ARI_UNAVAILABLE', 'ARI_INVALID_RESPONSE', 'INVALID_ARI_REQUEST'];
      if (known.includes(error.code)) throw error;
      fail(error.name === 'AbortError' ? 'ARI_TIMEOUT' : 'ARI_UNREACHABLE');
    } finally {
      clearTimeout(timer);
    }
  }

  return Object.freeze({
    async originateAgent({ extension, clientType, channelId, appArgs, timeout = 25 }) {
      if (!EXTENSION.test(extension || '') || !['mobile', 'browser'].includes(clientType) || !UUID.test(channelId || '')
        || !Number.isInteger(timeout) || timeout < 5 || timeout > 60) fail('INVALID_ARI_ORIGINATE');
      const channel = await request('POST', 'channels', { endpoint: `PJSIP/salemax-${extension}-${clientType}`, app: APP_NAME,
        appArgs: safeArgs(appArgs), channelId, timeout: String(timeout) });
      if (typeof channel.id !== 'string' || channel.id !== channelId) fail('ARI_INVALID_RESPONSE');
      return { id: channel.id, name: typeof channel.name === 'string' ? channel.name.slice(0, 160) : '' };
    },
    async originateGateway({ destination, channelNo, channelId, appArgs, timeout = 45 }) {
      if (typeof destination !== 'string' || !/^\+[1-9][0-9]{7,14}$/.test(destination) || !UUID.test(channelId || '')
        || !Number.isInteger(channelNo) || channelNo < 1 || channelNo > 4
        || !Number.isInteger(timeout) || timeout < 5 || timeout > 60) fail('INVALID_ARI_ORIGINATE');
      const endpoint = `PJSIP/990${channelNo}${destination}@salemax_dinstar_uc2000ve`;
      const channel = await request('POST', 'channels', { endpoint,
        app: APP_NAME, appArgs: safeArgs(appArgs), channelId, timeout: String(timeout) });
      if (typeof channel.id !== 'string' || channel.id !== channelId) fail('ARI_INVALID_RESPONSE');
      return { id: channel.id, name: typeof channel.name === 'string' ? channel.name.slice(0, 160) : '' };
    },
    async answer(channelId) {
      if (!RESOURCE_ID.test(channelId || '')) fail('INVALID_ARI_CHANNEL_ID');
      await request('POST', `channels/${encodeURIComponent(channelId)}/answer`);
    },
    async hangup(channelId) {
      if (!RESOURCE_ID.test(channelId || '')) fail('INVALID_ARI_CHANNEL_ID');
      await request('DELETE', `channels/${encodeURIComponent(channelId)}`);
    },
    async createMixingBridge(bridgeId) {
      if (!UUID.test(bridgeId || '')) fail('INVALID_ARI_BRIDGE_ID');
      const bridge = await request('POST', 'bridges', { type: 'mixing', bridgeId });
      if (typeof bridge.id !== 'string' || bridge.id !== bridgeId) fail('ARI_INVALID_RESPONSE');
      return { id: bridge.id };
    },
    async addToBridge(bridgeId, channelIds) {
      if (!UUID.test(bridgeId || '') || !Array.isArray(channelIds) || !channelIds.length || channelIds.length > 8
        || channelIds.some(id => !RESOURCE_ID.test(id))) fail('INVALID_ARI_BRIDGE_MEMBERS');
      await request('POST', `bridges/${encodeURIComponent(bridgeId)}/addChannel`, { channel: channelIds.join(',') });
    },
    async destroyBridge(bridgeId) {
      if (!UUID.test(bridgeId || '')) fail('INVALID_ARI_BRIDGE_ID');
      await request('DELETE', `bridges/${encodeURIComponent(bridgeId)}`);
    },
    async upsertPjsipObject(objectType, objectId, fields) {
      if (!['aor', 'auth', 'endpoint', 'identify'].includes(objectType)
        || !/^salemax_[A-Za-z0-9_-]{1,96}$/.test(objectId || '')
        || !Array.isArray(fields) || !fields.length || fields.length > 32
        || fields.some(field => !field || typeof field.attribute !== 'string'
          || !/^[a-z][a-z0-9_]{0,63}$/.test(field.attribute)
          || typeof field.value !== 'string' || field.value.length > 512
          || /[\r\n\0]/.test(field.value))) fail('INVALID_ARI_PJSIP_OBJECT');
      const result = await request('PUT', `asterisk/config/dynamic/res_pjsip/${objectType}/${encodeURIComponent(objectId)}`, {}, { fields });
      if (!Array.isArray(result) || result.length > 64 || result.some(field => !field || typeof field.attribute !== 'string' || typeof field.value !== 'string')) fail('ARI_INVALID_RESPONSE');
      return { attributes: result.length };
    },
  });
}

async function fromDatabase(db, options) {
  const [[row]] = await db.query(`SELECT ari_base_url,ari_username,credential_ciphertext,credential_iv,credential_auth_tag,enabled,revision
    FROM sx_platform_asterisk_config WHERE id=1`);
  return createAriClient(row, { ...options, pool: db });
}

module.exports = { APP_NAME, safeArgs, createAriClient, fromDatabase };
