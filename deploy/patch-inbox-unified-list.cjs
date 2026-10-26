'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const root = process.argv[2] || '/app';
const socketPath = path.join(root, 'helper/socket/index.js');
const socket = fs.readFileSync(socketPath, 'utf8');
const expectedSocketHash = 'c8876dbe3553aaa4ffbd215934c08243d4a87667a7cd7e6afa7c86b797b4ba67';
const actualSocketHash = crypto.createHash('sha256').update(socket).digest('hex');
if (actualSocketHash !== expectedSocketHash) throw new Error(`UNEXPECTED_LIVE_SOCKET_PREIMAGE:${actualSocketHash}`);

const replacements = [
  [
    `            origin = "",\n            unreadOnly = false,`,
    `            origin: requestedOrigin = "",\n            unreadOnly = false,`,
  ],
  [
    `          } = payload;\n\n          const chatListOwnerUid = isAgent ? socket?.userData?.owner_uid : uid;`,
    `          } = payload;\n\n          const origin = conversationKind === 'group' && requestedOrigin === 'qr' ? '' : requestedOrigin;\n\n          const chatListOwnerUid = isAgent ? socket?.userData?.owner_uid : uid;`,
  ],
  [
    `                assignedOnly: assignedOnly || origin === 'assigned',\n                conversationKind,`,
    `                assignedOnly: assignedOnly || origin === 'assigned',\n                conversationKind: 'all',`,
  ],
  [
    `          chats = chats.filter(chat => (conversationKind === 'group') === require('../../modules/platform/qr-inbox-groups').isGroup(chat));\n          chats = inboxAccess.filterAssignedChats(chats, inboxScope);\n          if (conversationKind === 'group') chats = sortGroupChatsByActivity(chats);`,
    `          chats = inboxAccess.filterAssignedChats(chats, inboxScope);\n          chats = sortGroupChatsByActivity(chats);`,
  ],
];
let updatedSocket = socket;
for (const [before, after] of replacements) {
  if (updatedSocket.split(before).length !== 2) throw new Error('SOCKET_PATCH_ANCHOR_MISMATCH');
  updatedSocket = updatedSocket.replace(before, after);
}
fs.writeFileSync(socketPath, updatedSocket);

const htmlPath = path.join(root, 'client/public/index.html');
const html = fs.readFileSync(htmlPath, 'utf8');
const oldRef = '/inbox-groups.js?v=20261026-native-groups9';
if (html.split(oldRef).length !== 2) throw new Error('INBOX_GROUPS_CACHE_ANCHOR_MISMATCH');
fs.writeFileSync(htmlPath, html.replace(oldRef, '/inbox-groups.js?v=20261026-native-groups10'));
