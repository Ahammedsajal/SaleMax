'use strict';

async function listActiveChatbots(query, uid, { includePlatformProfiles = false } = {}) {
  const legacyRows = await query('SELECT title,flow_id FROM beta_chatbot WHERE uid=? AND active=1 ORDER BY id DESC LIMIT 3', [uid]);
  let platformRows = [];
  if (includePlatformProfiles) {
    platformRows = await query(`SELECT p.name AS title,NULL AS flow_id
      FROM sx_chatbot_profiles p
      JOIN sx_chatbot_channel_assignments a ON a.tenant_id=p.tenant_id AND a.chatbot_id=p.id
        AND BINARY a.channel_kind IN (BINARY 'whatsapp_meta',BINARY 'whatsapp_qr')
      JOIN sx_legacy_ownership o ON o.tenant_id=p.tenant_id AND BINARY o.source_table=BINARY 'user'
      JOIN user u ON BINARY CAST(u.id AS CHAR)=BINARY o.source_id
      WHERE BINARY u.uid=BINARY ? AND BINARY o.legacy_uid_hash=BINARY LOWER(SHA2(u.uid,256)) AND BINARY p.status=BINARY 'live'
        AND ((BINARY a.channel_kind=BINARY 'whatsapp_meta' AND EXISTS (SELECT 1 FROM meta_api m
          WHERE BINARY m.uid=BINARY u.uid AND BINARY m.business_phone_number_id=BINARY a.channel_ref
            AND m.access_token IS NOT NULL AND BINARY TRIM(m.access_token)<>BINARY ''))
          OR (BINARY a.channel_kind=BINARY 'whatsapp_qr' AND EXISTS (SELECT 1 FROM instance i
          WHERE BINARY i.uid=BINARY u.uid AND BINARY i.uniqueId=BINARY a.channel_ref AND BINARY i.status=BINARY 'ACTIVE')))
      GROUP BY p.id,p.name,p.updated_at ORDER BY p.updated_at DESC LIMIT 3`, [uid]);
  }
  const seen = new Set();
  return [...platformRows, ...legacyRows].filter(row => {
    const key = String(row.title || '').trim().toLocaleLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 3).map(row => ({ title: row.title, flow_id: row.flow_id ?? null }));
}

async function countConnectedWhatsAppChannels(query, uid) {
  const [qrRows, metaRows] = await Promise.all([
    query(`SELECT COUNT(DISTINCT uniqueId) AS count FROM instance
      WHERE BINARY uid=BINARY ? AND BINARY status=BINARY 'ACTIVE' AND uniqueId IS NOT NULL`, [uid]),
    query(`SELECT COUNT(DISTINCT business_phone_number_id) AS count FROM meta_api
      WHERE BINARY uid=BINARY ? AND business_phone_number_id IS NOT NULL
        AND BINARY TRIM(business_phone_number_id)<>BINARY '' AND access_token IS NOT NULL
        AND BINARY TRIM(access_token)<>BINARY ''`, [uid]),
  ]);
  return Number(qrRows[0]?.count || 0) + Number(metaRows[0]?.count || 0);
}

module.exports = { listActiveChatbots, countConnectedWhatsAppChannels };
