import { SimpleUser } from 'sip.js/lib/platform/web/index.js';

let user = null;
let registered = false;
let stateListener = () => {};

function status(state, detail = '') {
  stateListener({ state, detail });
}

export async function connectBrowserSip(config, remoteAudio, onState = () => {}) {
  if (user) throw new Error('BROWSER_SIP_ALREADY_CONNECTED');
  if (!config || typeof config.server !== 'string' || !config.server.startsWith('wss://')
    || typeof config.uri !== 'string' || !/^sip:[0-9]{3,8}-browser@[^\s]+$/.test(config.uri)
    || typeof config.authorizationUsername !== 'string' || !/^[0-9]{3,8}-browser$/.test(config.authorizationUsername)
    || typeof config.authorizationPassword !== 'string' || config.authorizationPassword.length < 40
    || !remoteAudio || typeof remoteAudio.play !== 'function') throw new Error('INVALID_BROWSER_SIP_CONFIG');
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('BROWSER_MICROPHONE_UNAVAILABLE');

  stateListener = onState;
  status('requesting-microphone');
  const microphone = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
  microphone.getTracks().forEach(track => track.stop());

  const candidate = new SimpleUser(config.server, {
    aor: config.uri,
    delegate: {
      onServerConnect: () => status('connected'),
      onServerDisconnect: () => { registered = false; status('disconnected'); },
      onRegistered: () => { registered = true; status('registered'); },
      onUnregistered: () => { registered = false; status('disconnected'); },
      onCallCreated: () => status('ringing'),
      onCallAnswered: () => status('in-call'),
      onCallHangup: () => status('registered'),
      onCallReceived: async () => {
        status('answering');
        try {
          await candidate.answer();
          status('in-call');
        } catch (_) {
          status('call-failed');
        }
      },
    },
    media: { constraints: { audio: true, video: false }, remote: { audio: remoteAudio } },
    userAgentOptions: {
      authorizationUsername: config.authorizationUsername,
      authorizationPassword: config.authorizationPassword,
      displayName: 'SaleMaX Call Center',
    },
  });
  user = candidate;
  try {
    await user.connect();
    await user.register();
    registered = true;
    status('registered');
    return true;
  } catch (error) {
    try { await user.disconnect(); } catch (_) {}
    user = null;
    registered = false;
    status('connection-failed');
    throw error;
  }
}

export async function disconnectBrowserSip() {
  const current = user;
  user = null;
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

export function browserSipConnected() {
  return !!user?.isConnected() && registered;
}
