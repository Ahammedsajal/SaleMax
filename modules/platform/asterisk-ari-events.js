'use strict';

const os = require('node:os');
const { EventEmitter } = require('node:events');
const WebSocket = require('ws');
const asterisk = require('./asterisk-config');
const secrets = require('./asterisk-secrets');

const LOCK_NAME = 'salemax:asterisk:ari-events';
const APP_NAME = 'salemax-call-center';
const SAFE_ERRORS = new Set([
  'ARI_CREDENTIAL_REQUIRED', 'INVALID_ARI_URL', 'ASTERISK_HOST_ALLOWLIST_REQUIRED',
  'ASTERISK_HOST_NOT_ALLOWED', 'ASTERISK_SECRET_KEY_UNAVAILABLE', 'ARI_EVENTS_CONFIG_UNAVAILABLE',
]);

function safeEvent(raw, isBinary = false) {
  if (isBinary) return null;
  let value;
  try { value = JSON.parse(Buffer.isBuffer(raw) ? raw.toString('utf8') : String(raw)); } catch (_) { return null; }
  if (!value || typeof value !== 'object' || Array.isArray(value) || typeof value.type !== 'string'
    || !/^[A-Z][A-Za-z0-9]{0,79}$/.test(value.type)) return null;
  return value;
}

function eventsUrl(baseUrl) {
  const url = new URL(baseUrl);
  url.protocol = 'wss:';
  url.pathname = '/ari/events';
  url.search = '';
  url.hash = '';
  url.searchParams.set('app', APP_NAME);
  url.searchParams.set('subscribeAll', 'false');
  return url;
}

class AsteriskAriEvents extends EventEmitter {
  constructor({ pool, WebSocketImpl = WebSocket, workerId,
    setTimeoutImpl = setTimeout, clearTimeoutImpl = clearTimeout,
    setIntervalImpl = setInterval, clearIntervalImpl = clearInterval,
    random = Math.random } = {}) {
    super();
    if (!pool) throw new TypeError('ARI_EVENTS_POOL_REQUIRED');
    this.pool = pool;
    this.WebSocketImpl = WebSocketImpl;
    this.workerId = workerId || `asterisk-${os.hostname().replace(/[^A-Za-z0-9._:-]/g, '-').slice(0, 70)}-${process.pid}`;
    this.setTimeout = setTimeoutImpl;
    this.clearTimeout = clearTimeoutImpl;
    this.setInterval = setIntervalImpl;
    this.clearInterval = clearIntervalImpl;
    this.random = random;
    this.running = false;
    this.socket = null;
    this.socketGeneration = 0;
    this.lockConnection = null;
    this.lockConnectionId = null;
    this.lockTimer = null;
    this.lockLost = false;
    this.currentConfig = null;
    this.reconnectTimer = null;
    this.refreshTimer = null;
    this.stableTimer = null;
    this.reconnectAttempt = 0;
  }

  async start() {
    if (this.running) return true;
    this.lockConnection = await this.pool.getConnection();
    const [[lock]] = await this.lockConnection.query('SELECT CONNECTION_ID() AS connectionId,GET_LOCK(?,0) AS acquired', [LOCK_NAME]);
    if (Number(lock?.acquired) !== 1) {
      this.lockConnection.release();
      this.lockConnection = null;
      return false;
    }
    this.lockConnectionId = Number(lock.connectionId);
    this.running = true;
    await this.refresh();
    this.refreshTimer = this.setInterval(() => this.refresh().catch(() => this.markError('ARI_EVENTS_CONFIG_UNAVAILABLE')), 15000);
    this.lockTimer = this.setInterval(() => this.checkLock().catch(() => this.loseLock()), 5000);
    return true;
  }

  async checkLock() {
    if (!this.running || !this.lockConnection) return;
    const [[row]] = await this.lockConnection.query('SELECT CONNECTION_ID() AS connectionId,IS_USED_LOCK(?) AS lockConnectionId', [LOCK_NAME]);
    if (Number(row?.connectionId) !== this.lockConnectionId || Number(row?.lockConnectionId) !== this.lockConnectionId) this.loseLock();
    else if (this.socket?.readyState === this.WebSocketImpl.OPEN) {
      await this.pool.query(`UPDATE sx_platform_asterisk_runtime SET updated_at=UTC_TIMESTAMP(3)
        WHERE id=1 AND worker_id=? AND status='connected'`, [this.workerId]);
    }
  }

  loseLock() {
    if (this.lockLost) return;
    this.lockLost = true;
    this.running = false;
    if (this.refreshTimer) this.clearInterval(this.refreshTimer);
    if (this.lockTimer) this.clearInterval(this.lockTimer);
    this.refreshTimer = null;
    this.lockTimer = null;
    this.closeSocket();
    this.emit('lockLost');
  }

  async refresh() {
    if (!this.running) return;
    let row;
    try {
      const [rows] = await this.pool.query(`SELECT ari_base_url,ari_username,credential_ciphertext,credential_iv,credential_auth_tag,enabled,revision
        FROM sx_platform_asterisk_config WHERE id=1`);
      row = rows[0];
      if (!row) throw Object.assign(new Error(), { code: 'ARI_EVENTS_CONFIG_UNAVAILABLE' });
    } catch (_) {
      this.closeSocket();
      await this.markError('ARI_EVENTS_CONFIG_UNAVAILABLE');
      return;
    }

    if (!row.enabled || !row.ari_base_url || !row.ari_username || !row.credential_ciphertext) {
      this.closeSocket();
      this.currentConfig = null;
      await this.writeStatus('disabled', null, null);
      return;
    }

    let target, password;
    try {
      target = asterisk.endpoint(row.ari_base_url);
      asterisk.allowlisted(target.hostname);
      password = secrets.decrypt(row);
    } catch (error) {
      this.closeSocket();
      this.currentConfig = null;
      await this.markError(SAFE_ERRORS.has(error.code) ? error.code : 'ASTERISK_RUNTIME_CONFIG_INVALID');
      return;
    }

    const revision = Number(row.revision);
    if (this.currentConfig?.revision === revision && this.socket
      && (this.socket.readyState === this.WebSocketImpl.OPEN || this.socket.readyState === this.WebSocketImpl.CONNECTING)) return;

    this.closeSocket();
    this.currentConfig = { revision, hostname: target.hostname };
    await this.writeStatus('starting', this.currentConfig, null);
    const url = eventsUrl(target.value);
    const authorization = `Basic ${Buffer.from(`${row.ari_username}:${password}`, 'utf8').toString('base64')}`;
    const generation = ++this.socketGeneration;
    const socket = new this.WebSocketImpl(url.toString(), {
      headers: { Authorization: authorization },
      handshakeTimeout: 5000,
      rejectUnauthorized: true,
      maxPayload: 1024 * 1024,
    });
    this.socket = socket;
    socket.on('open', () => {
      if (!this.isCurrent(socket, generation)) return;
      if (this.stableTimer) this.clearTimeout(this.stableTimer);
      this.stableTimer = this.setTimeout(() => { this.reconnectAttempt = 0; this.stableTimer = null; }, 30000);
      this.writeStatus('connected', this.currentConfig, null, true).catch(() => {});
      this.emit('connected');
    });
    socket.on('message', (raw, isBinary) => {
      if (!this.isCurrent(socket, generation)) return;
      const event = safeEvent(raw, isBinary);
      if (!event) {
        this.emit('invalidEvent');
        return;
      }
      this.pool.query(`UPDATE sx_platform_asterisk_runtime SET status='connected',last_event_at=UTC_TIMESTAMP(3),last_event_type=?,
        events_received=events_received+1,error_code=NULL,updated_at=UTC_TIMESTAMP(3) WHERE id=1 AND worker_id=?`, [event.type, this.workerId]).catch(() => {});
      this.emit('ariEvent', event);
    });
    socket.on('error', () => {
      if (this.isCurrent(socket, generation)) this.markError('ARI_EVENTS_SOCKET_ERROR').catch(() => {});
    });
    socket.on('close', () => {
      if (!this.isCurrent(socket, generation)) return;
      if (this.stableTimer) this.clearTimeout(this.stableTimer);
      this.stableTimer = null;
      this.socket = null;
      this.writeStatus('reconnecting', this.currentConfig, 'ARI_EVENTS_DISCONNECTED').catch(() => {});
      this.scheduleReconnect();
    });
  }

  isCurrent(socket, generation) {
    return this.running && this.socket === socket && this.socketGeneration === generation;
  }

  closeSocket() {
    this.socketGeneration++;
    const socket = this.socket;
    this.socket = null;
    if (this.reconnectTimer) this.clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    if (this.stableTimer) this.clearTimeout(this.stableTimer);
    this.stableTimer = null;
    if (socket && (socket.readyState === this.WebSocketImpl.OPEN || socket.readyState === this.WebSocketImpl.CONNECTING)) {
      try { socket.close(1000, 'SaleMaX ARI configuration changed'); } catch (_) {}
    }
  }

  scheduleReconnect() {
    if (!this.running || this.reconnectTimer) return;
    const base = Math.min(60000, 1000 * (2 ** Math.min(this.reconnectAttempt, 6)));
    const delay = Math.round(base * (0.8 + this.random() * 0.4));
    this.reconnectAttempt++;
    this.reconnectTimer = this.setTimeout(() => {
      this.reconnectTimer = null;
      this.refresh().catch(() => this.markError('ARI_EVENTS_CONFIG_UNAVAILABLE'));
    }, delay);
  }

  async markError(code) {
    await this.writeStatus('error', this.currentConfig, SAFE_ERRORS.has(code) || /^[A-Z0-9_]{2,80}$/.test(code) ? code : 'ARI_EVENTS_FAILED');
  }

  async writeStatus(status, config, errorCode, connected = false) {
    await this.pool.query(`INSERT INTO sx_platform_asterisk_runtime(id,status,worker_id,ari_host,config_revision,connected_at,error_code,updated_at)
      VALUES(1,?,?,?,?,IF(?=1,UTC_TIMESTAMP(3),NULL),?,UTC_TIMESTAMP(3))
      ON DUPLICATE KEY UPDATE status=VALUES(status),worker_id=VALUES(worker_id),ari_host=VALUES(ari_host),config_revision=VALUES(config_revision),
      connected_at=IF(?=1,UTC_TIMESTAMP(3),NULL),error_code=VALUES(error_code),updated_at=UTC_TIMESTAMP(3)`,
    [status, this.workerId, config?.hostname || null, config?.revision || null, connected ? 1 : 0, errorCode,
      connected ? 1 : 0]);
  }

  async stop() {
    if (!this.running && !this.lockConnection) return;
    this.running = false;
    if (this.refreshTimer) this.clearInterval(this.refreshTimer);
    if (this.lockTimer) this.clearInterval(this.lockTimer);
    this.refreshTimer = null;
    this.lockTimer = null;
    this.closeSocket();
    if (!this.lockLost) try { await this.writeStatus('stopped', this.currentConfig, null); } catch (_) {}
    this.currentConfig = null;
    if (this.lockConnection) {
      if (!this.lockLost) try { await this.lockConnection.query('SELECT RELEASE_LOCK(?)', [LOCK_NAME]); } catch (_) {}
      try { this.lockConnection.release(); } catch (_) {}
      this.lockConnection = null;
      this.lockConnectionId = null;
    }
  }
}

module.exports = { AsteriskAriEvents, safeEvent, eventsUrl, APP_NAME, LOCK_NAME };
