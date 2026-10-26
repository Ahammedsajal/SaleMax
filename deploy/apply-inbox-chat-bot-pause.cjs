'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(process.argv[2] || '.');
const styleAnchor = '      #sx-active-chatbot-control [data-sx-chatbot-toggle]:disabled{opacity:.6;cursor:wait}\n';
const styleAddition = `      #sx-active-chatbot-control.sx-in-chat-info{display:block;width:100%;max-width:none;margin:12px 0;padding:10px;border:1px solid #e4e7ec;border-radius:9px;background:#fff;box-sizing:border-box}
      #sx-active-chatbot-control.sx-in-chat-info [data-sx-chatbot-mobile-toggle]{display:none!important}
      #sx-active-chatbot-control.sx-in-chat-info:not(.sx-mobile-open) [data-sx-chatbot-control-body]{position:static;display:flex!important;flex-direction:column;align-items:stretch;width:100%;max-width:none;padding:0;border:0;border-radius:0;background:transparent;box-shadow:none;box-sizing:border-box}
      #sx-active-chatbot-control.sx-in-chat-info [data-sx-chatbot-control-body] label{justify-content:space-between;white-space:normal}
      #sx-active-chatbot-control.sx-in-chat-info [data-sx-chatbot-control-body] select,#sx-active-chatbot-control.sx-in-chat-info [data-sx-chatbot-control-body] input[type="datetime-local"]{width:100%;max-width:none;box-sizing:border-box}
      #sx-active-chatbot-control.sx-in-chat-info [data-sx-chatbot-state]{max-width:none;white-space:normal;overflow-wrap:anywhere}
`;
const infoPanelFunction = `  function chatInfoPanel() {
    const candidates = [...document.querySelectorAll('aside,[role="complementary"],section,div')]
      .filter(visible)
      .filter(el => {
        const text = (el.innerText || '').replace(/\\s+/g, ' ').trim().toLowerCase();
        return text.length < 6000 && /\\bchat info\\b|معلومات المحادثة/.test(text) && /\\bcontact info\\b|معلومات الاتصال/.test(text);
      });
    return candidates.sort((a, b) => (a.innerText || '').length - (b.innerText || '').length)[0] || null;
  }
`;
const oldPlacement = [
  "    const infoButton = [...document.querySelectorAll('button[aria-label],button[title]')].find(button => /show info|معلومات/i.test(`${button.getAttribute('aria-label') || ''} ${button.title || ''}`));",
  '    const actions = infoButton?.parentElement;',
  '    const header = actions?.parentElement;',
  "    if (!header || !actions) { control.style.display = 'none'; return; }",
  "    control.style.display = '';",
  "    const narrow = window.matchMedia('(max-width: 767px)').matches;",
  '    if (narrow) {',
  "      control.classList.add('sx-mobile-layout');",
  "      if (control.classList.contains('sx-mobile-open') && header.parentElement) {",
  '        if (control.parentElement !== header.parentElement || control.previousElementSibling !== header) header.parentElement.insertBefore(control, header.nextElementSibling);',
  '      } else if (control.parentElement !== actions) actions.insertBefore(control, infoButton);',
  '    } else {',
  "      control.classList.remove('sx-mobile-layout', 'sx-mobile-open');",
  "      control.querySelector('[data-sx-chatbot-mobile-toggle]')?.setAttribute('aria-expanded', 'false');",
  '      if (control.parentElement !== header || control.nextElementSibling !== actions) header.insertBefore(control, actions);',
  '    }',
].join('\n') + '\n';
const newPlacement = `    const infoPanel = chatInfoPanel();
    if (!infoPanel) { control.style.display = 'none'; return; }
    control.style.display = '';
    control.classList.add('sx-in-chat-info');
    control.classList.remove('sx-mobile-layout', 'sx-mobile-open');
    control.querySelector('[data-sx-chatbot-mobile-toggle]')?.setAttribute('aria-expanded', 'false');
    if (control.parentElement !== infoPanel) infoPanel.append(control);
`;

function replaceOnce(source, before, after, label) {
  if (source.includes(after)) return source;
  const first = source.indexOf(before);
  if (first < 0 || source.indexOf(before, first + before.length) >= 0) throw new Error(`Expected one ${label} anchor`);
  return source.slice(0, first) + after + source.slice(first + before.length);
}

function edit(relativePath, transform) {
  const file = path.join(root, relativePath);
  const before = fs.readFileSync(file, 'utf8');
  const after = transform(before);
  if (after !== before) fs.writeFileSync(file, after);
}

edit('client/public/chatbot-admin.js', source => {
  let next = replaceOnce(source, styleAnchor, styleAnchor + styleAddition, 'Chat Info control styles');
  next = replaceOnce(next, '  function renderActiveChatControl(conversation) {\n', infoPanelFunction + '  function renderActiveChatControl(conversation) {\n', 'Chat Info panel finder');
  return replaceOnce(next, oldPlacement, newPlacement, 'Chat Info control placement');
});

edit('client/public/training-sidebar.js', source => {
  const prefix = "chatbotScript.src = '/chatbot-admin.js?v=";
  const at = source.indexOf(prefix);
  if (at < 0) {
    if (source.includes('chatbot-admin.js?v=20261026-inbox-bot-pause-info1')) return source;
    throw new Error('Chatbot editor asset URL is missing');
  }
  if (source.indexOf(prefix, at + prefix.length) >= 0) throw new Error('Found duplicate chatbot editor asset URLs');
  const start = at + prefix.length;
  const end = source.indexOf("'", start);
  if (end < 0) throw new Error('Chatbot editor asset URL is malformed');
  if (source.slice(start, end) === '20261026-inbox-bot-pause-info1') return source;
  return source.slice(0, start) + '20261026-inbox-bot-pause-info1' + source.slice(end);
});

edit('client/public/index.html', source => {
  const prefix = 'training-sidebar.js?v=';
  const at = source.indexOf(prefix);
  if (at < 0) {
    if (source.includes('training-sidebar.js?v=20261026-inbox-bot-pause-info1')) return source;
    throw new Error('Training sidebar asset URL is missing');
  }
  if (source.indexOf(prefix, at + prefix.length) >= 0) throw new Error('Found duplicate training sidebar asset URLs');
  const start = at + prefix.length;
  let end = start;
  while (end < source.length && /[A-Za-z0-9_-]/.test(source[end])) end++;
  if (end === start) throw new Error('Training sidebar asset URL is malformed');
  if (source.slice(start, end) === '20261026-inbox-bot-pause-info1') return source;
  return source.slice(0, start) + '20261026-inbox-bot-pause-info1' + source.slice(end);
});

edit('automation/automation.js', source => {
  let next = replaceOnce(source,
    'const { shouldPause } = require("../modules/platform/chatbot-conversation-control");\n',
    'const { shouldPause } = require("../modules/platform/chatbot-conversation-control");\nconst { channelFor } = require("../modules/platform/chatbot-channels");\n',
    'legacy flow channel helper import');
  return replaceOnce(next, 'if (chatId && await shouldPause(uid, chatId)) return;',
    'if (chatId && await shouldPause(uid, chatId, channelFor(origin), sessionId)) return;', 'legacy flow pause guard');
});

edit('automation/functions.js', source => {
  let next = replaceOnce(source,
    'const { shouldPause } = require("../modules/platform/chatbot-conversation-control");\n',
    'const { shouldPause } = require("../modules/platform/chatbot-conversation-control");\nconst { channelFor } = require("../modules/platform/chatbot-channels");\n',
    'outbound channel helper import');
  next = replaceOnce(next, 'if (chatId && await shouldPause(uid, chatId)) return null;',
    'if (chatId && await shouldPause(uid, chatId, channelFor(origin), sessionId)) return null;', 'text/media outbound pause guard');
  return replaceOnce(next, 'if (chatId && await shouldPause(user?.uid, chatId)) return {};',
    'if (chatId && await shouldPause(user?.uid, chatId, channelFor(origin), sessionId)) return {};', 'Meta template pause guard');
});

console.log(`Applied chat-scoped bot pause patch to ${root}`);
