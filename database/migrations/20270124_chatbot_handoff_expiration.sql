-- An unclaimed human handoff pauses automation for one day. Once a staff
-- member claims the chat, the pause becomes staff-owned until explicitly resumed.
ALTER TABLE sx_chatbot_handoff_claims
  MODIFY COLUMN status ENUM('open','claimed','expired') NOT NULL DEFAULT 'open',
  ADD COLUMN expires_at DATETIME(3) NULL AFTER status,
  ADD KEY idx_sx_chatbot_handoff_expiry (tenant_id,status,expires_at);

UPDATE sx_chatbot_handoff_claims
SET expires_at=DATE_ADD(created_at,INTERVAL 24 HOUR)
WHERE expires_at IS NULL;

UPDATE sx_chatbot_conversation_controls c
JOIN sx_chatbot_handoff_claims h ON h.tenant_id=c.tenant_id AND h.channel_kind=c.channel_kind
  AND h.channel_ref=c.channel_ref AND h.conversation_id=c.conversation_id
SET c.pause_until=h.expires_at,c.revision=c.revision+1
WHERE h.status='open' AND c.mode='paused' AND c.updated_by_kind='system';

UPDATE sx_chatbot_conversation_controls c
JOIN sx_chatbot_handoff_claims h ON h.tenant_id=c.tenant_id AND h.channel_kind=c.channel_kind
  AND h.channel_ref=c.channel_ref AND h.conversation_id=c.conversation_id
SET c.pause_until=NULL,c.revision=c.revision+1,c.updated_by_kind='identity',
  c.updated_by_identity_id=h.claimed_identity_id
WHERE h.status='claimed' AND h.claimed_identity_id IS NOT NULL
  AND c.mode='paused' AND c.updated_by_kind='system';

UPDATE sx_chatbot_conversation_controls
SET pause_until=DATE_ADD(updated_at,INTERVAL 24 HOUR),revision=revision+1
WHERE mode='paused' AND updated_by_kind='system' AND pause_until IS NULL;
