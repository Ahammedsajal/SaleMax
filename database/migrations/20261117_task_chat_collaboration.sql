-- Task chat @mention targets. Membership is checked by the application on write and read.
CREATE TABLE sx_task_message_mentions (
  tenant_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  task_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  message_id BIGINT UNSIGNED NOT NULL,
  mentioned_actor_type ENUM('user','agent','identity') NOT NULL,
  mentioned_actor_id VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (tenant_id, message_id, mentioned_actor_type, mentioned_actor_id),
  KEY idx_sx_task_mentions_actor (tenant_id, task_id, mentioned_actor_type, mentioned_actor_id, message_id),
  CONSTRAINT fk_sx_task_mentions_task FOREIGN KEY (tenant_id, task_id) REFERENCES sx_tasks(tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT fk_sx_task_mentions_message FOREIGN KEY (message_id) REFERENCES sx_task_messages(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Existing tasks: make creator a participant without generating unread history.
INSERT IGNORE INTO sx_task_participants
  (tenant_id, task_id, actor_type, actor_id, participant_role, added_by_type, added_by_id, added_at, last_read_message_id, last_read_at)
SELECT t.tenant_id, t.id, t.created_by_type, t.created_by_id, 'observer', t.created_by_type, t.created_by_id, t.created_at,
       COALESCE((SELECT MAX(m.id) FROM sx_task_messages m WHERE m.tenant_id=t.tenant_id AND m.task_id=t.id), 0), UTC_TIMESTAMP(3)
FROM sx_tasks t
WHERE t.deleted_at IS NULL;
