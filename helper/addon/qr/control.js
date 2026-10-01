function hi() {
  console.log("HI");
}

function fetchProfileUrl(session, jid, nonHd) {
  return new Promise(async (resolve) => {
    try {
      const ppUrl = nonHd
        ? await session.profilePictureUrl(jid)
        : await session.profilePictureUrl(jid, "image");

      if (ppUrl?.data == 404) {
        return resolve(null);
      }

      if (ppUrl) {
        resolve(ppUrl);
      } else {
        resolve(null);
      }
    } catch (err) {
      const statusCode = err?.output?.statusCode || err?.data || err?.statusCode || err?.code;
      console.warn(
        `fetchProfileUrl skipped for ${jid}: ${err?.message || "unknown"}${statusCode ? ` (code: ${statusCode})` : ""}`,
      );
      resolve(null);
    }
  });
}

function fetchGroupMeta(session, jid) {
  return new Promise(async (resolve) => {
    try {
      const metadata = await session.groupMetadata(jid);

      if (metadata) {
        resolve(metadata);
      } else {
        resolve(null);
      }
    } catch (err) {
      console.warn(`fetchGroupMeta failed for ${jid}: ${err?.message || err}`);
      resolve(err);
    }
  });
}

function fetchPersonStatus(session, jid) {
  return new Promise(async (resolve) => {
    try {
      const status = await session.fetchStatus(jid);

      if (status) {
        resolve(status);
      } else {
        resolve(null);
      }
    } catch (err) {
      console.warn(`fetchPersonStatus failed for ${jid}: ${err?.message || err}`);
      resolve(err);
    }
  });
}

function fetchBusinessprofile(session, jid) {
  return new Promise(async (resolve) => {
    try {
      const busPro = await session.getBusinessProfile(jid);

      if (busPro) {
        resolve(busPro);
      } else {
        resolve(null);
      }
    } catch (err) {
      console.warn(`fetchBusinessprofile failed for ${jid}: ${err?.message || err}`);
      resolve(err);
    }
  });
}

function fetchPersonPresence(session, jid) {
  return new Promise(async (resolve) => {
    try {
      const presence = await session.presenceSubscribe(jid);

      if (presence) {
        resolve(presence);
      } else {
        resolve(null);
      }
    } catch (err) {
      console.warn(`fetchPersonPresence failed for ${jid}: ${err?.message || err}`);
      resolve(err);
    }
  });
}

module.exports = {
  hi,
  fetchProfileUrl,
  fetchGroupMeta,
  fetchPersonStatus,
  fetchPersonPresence,
  fetchBusinessprofile,
};
