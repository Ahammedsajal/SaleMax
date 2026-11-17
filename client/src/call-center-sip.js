import { SimpleUser } from 'sip.js/lib/platform/web/index.js';

let user = null;
let registered = false;
let stateListener = () => {};
let userConfigKey = '';
let connectPromise = null;

function status(state, detail = '') {
  stateListener({ state, detail });
}

export async function connectBrowserSip(config, remoteAudio, onState = () => {}) {
  const sipIdentity = typeof config?.uri === 'string'
    ? /^sip:(salemax-[0-9]{3,8}-browser-r[1-9][0-9]*)@[!-~]+$/.exec(config.uri)?.[1] || '' : '';
  if (!config || typeof config.server !== 'string' || !config.server.startsWith('wss://')
    || !sipIdentity || typeof config.authorizationUsername !== 'string' || config.authorizationUsername !== sipIdentity
    || typeof config.authorizationPassword !== 'string' || config.authorizationPassword.length < 40
    || !remoteAudio || typeof remoteAudio.play !== 'function') throw new Error('INVALID_BROWSER_SIP_CONFIG');
  stateListener = onState;
  if (connectPromise) return connectPromise;
  connectPromise = (async () => {
    const nextConfigKey = `${config.server}|${config.uri}|${config.authorizationUsername}|${config.authorizationPassword}`;
    if (user && userConfigKey !== nextConfigKey) await disconnectBrowserSip();
    if (user && !user.isConnected()) {
      const stale = user;
      user = null;
      userConfigKey = '';
      registered = false;
      try { await stale.disconnect(); } catch (_) {}
    }
    let candidate = user;
    if (!candidate) {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('BROWSER_MICROPHONE_UNAVAILABLE');
      status('requesting-microphone');
      const microphone = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      microphone.getTracks().forEach(track => track.stop());
      candidate = new SimpleUser(config.server, {
        aor: config.uri,
        delegate: {
          onServerConnect: () => status('connected'),
          onServerDisconnect: () => {
            registered = false;
            if (user === candidate) { user = null; userConfigKey = ''; }
            status('disconnected');
          },
          onRegistered: () => { registered = true; status('registered'); },
          onUnregistered: () => { registered = false; status('disconnected'); },
          onCallCreated: () => status('ringing'),
          onCallAnswered: () => status('in-call'),
          onCallHangup: () => status('registered'),
          onCallReceived: () => status('incoming-call'),
        },
        media: { constraints: { audio: true, video: false }, remote: { audio: remoteAudio } },
        userAgentOptions: {
          authorizationUsername: config.authorizationUsername,
          authorizationPassword: config.authorizationPassword,
          displayName: '7Network Call Center',
        },
      });
      user = candidate;
      userConfigKey = nextConfigKey;
    }
    try {
      if (!candidate.isConnected()) await candidate.connect();
      if (!registered) await candidate.register();
      registered = true;
      status('registered');
      return true;
    } catch (error) {
      if (!candidate.isConnected()) {
        try { await candidate.disconnect(); } catch (_) {}
        if (user === candidate) { user = null; userConfigKey = ''; }
      }
      registered = false;
      status('connection-failed');
      throw error;
    }
  })();
  try { return await connectPromise; }
  finally { connectPromise = null; }
}

export async function disconnectBrowserSip() {
  const current = user;
  user = null;
  userConfigKey = '';
  registered = false;
  if (!current) return;
  try { if (current.isConnected()) await current.hangup(); } catch (_) {}
  try { if (current.isConnected()) await current.unregister(); } catch (_) {}
  try { await current.disconnect(); } catch (_) {}
  status('disconnected');
}

export async function hangupBrowserCall() {
  if (user?.isConnected()) await user.hangup();
}

export async function answerBrowserCall() {
  if (!user?.isConnected()) throw new Error('BROWSER_SIP_NOT_CONNECTED');
  await user.answer();
  status('in-call');
}

export async function declineBrowserCall() {
  if (!user?.isConnected()) throw new Error('BROWSER_SIP_NOT_CONNECTED');
  await user.decline();
  status('registered');
}

export function browserSipConnected() {
  return !!user?.isConnected() && registered;
}
