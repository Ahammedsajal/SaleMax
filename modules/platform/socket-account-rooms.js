'use strict';

function accountRoom(uid) {
  if (uid == null) return null;
  const value = String(uid).trim();
  if (!value || value.length > 999) return null;
  return `crm:account:${Buffer.from(value, 'utf8').toString('base64url')}`;
}

function accountRoomsForUser(userData) {
  if (!userData || typeof userData !== 'object') return [];
  const rooms = new Set();
  for (const uid of [userData.uid, userData.teamOwnerUid, userData.isAgent ? userData.owner_uid : null]) {
    const room = accountRoom(uid);
    if (room) rooms.add(room);
  }
  return [...rooms];
}

function presenceForUserData(userData) {
  if (!userData?.uid) return null;
  const isAgent = Boolean(userData.isAgent);
  return {
    uid: String(userData.uid),
    isAgent,
    owner_uid: isAgent ? String(userData.owner_uid || '') : null,
    teamOwnerUid: userData.teamOwnerUid ? String(userData.teamOwnerUid) : null,
  };
}

function connectedUidsFromSockets(sockets) {
  return (Array.isArray(sockets) ? sockets : [])
    .map((socket) => socket?.data?.crmPresence)
    .filter((presence) => presence?.uid)
    .map((presence) => ({
      uid: String(presence.uid),
      isAgent: Boolean(presence.isAgent),
      ...(presence.isAgent && { owner: presence.owner_uid }),
    }));
}

async function joinAccountRooms(socket, userData) {
  const rooms = accountRoomsForUser(userData);
  if (typeof socket?.join !== 'function') throw new TypeError('SOCKET_JOIN_REQUIRED');
  for (const room of rooms) await socket.join(room);
  return rooms;
}

function emitToAccount(io, uid, event, data) {
  const room = accountRoom(uid);
  if (!io || !room || typeof event !== 'string' || !event) return false;
  io.to(room).emit(event, data);
  return true;
}

module.exports = {
  accountRoom,
  accountRoomsForUser,
  presenceForUserData,
  connectedUidsFromSockets,
  joinAccountRooms,
  emitToAccount,
};
