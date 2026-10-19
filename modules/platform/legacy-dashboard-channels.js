'use strict';

async function listActiveChatbots(query, uid, { includePlatformProfiles = false } = {}) {
  const legacyRows = await query('SELECT title,flow_id FROM beta_chatbot WHERE uid=? AND active=1 ORDER BY id DESC LIMIT 3', [uid]);
  let platformRows = [];
  if (includePlatformProfiles) {
    platformRows = await query(`SELECT p.name AS title,NULL AS flow_id
      FROM sx_chatbot_profiles p
      JOIN sx_chatbot_channel_assignments a ON a.tenant_id=p.tenant_id AND a.chatbot_id=p.id
        AND a.channel_kind IN ('whatsapp_meta','whatsapp_qr')
      JOIN sx_legacy_ownership o ON o.tenant_id=p.tenant_id AND o.source_table='user'
      JOIN user u ON CAST(u.id AS CHAR)=o.source_id
      WHERE u.uid=? AND o.legacy_uid_hash=LOWER(SHA2(u.uid,256)) AND p.status='live'
        AND ((a.channel_kind='whatsapp_meta' AND EXISTS (SELECT 1 FROM meta_api m
          WHERE m.uid=u.uid AND m.business_phone_number_id=a.channel_ref
            AND m.access_token IS NOT NULL AND TRIM(m.access_token)<>''))
          OR (a.channel_kind='whatsapp_qr' AND EXISTS (SELECT 1 FROM instance i
          WHERE i.uid=u.uid AND i.uniqueId=a.channel_ref AND i.status='ACTIVE')))
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
  const rows = await query(`SELECT COUNT(*) AS count FROM (
    SELECT CONCAT('qr:',CAST(uniqueId AS CHAR)) AS channel_ref
      FROM instance WHERE uid=? AND status='ACTIVE' AND uniqueId IS NOT NULL
    UNION DISTINCT
    SELECT CONCAT('meta:',business_phone_number_id) AS channel_ref
      FROM meta_api WHERE uid=? AND business_phone_number_id IS NOT NULL
        AND TRIM(business_phone_number_id)<>'' AND access_token IS NOT NULL
        AND TRIM(access_token)<>''
  ) channels`, [uid, uid]);
  return Number(rows[0]?.count || 0);
}

module.exports = { listActiveChatbots, countConnectedWhatsAppChannels };
