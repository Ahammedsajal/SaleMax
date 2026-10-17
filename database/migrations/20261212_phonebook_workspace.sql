CREATE TABLE IF NOT EXISTS sx_phonebook_settings (
 owner_hash CHAR(64) NOT NULL, category_key VARCHAR(80) NOT NULL,
 config_json LONGTEXT NOT NULL, revision INT UNSIGNED NOT NULL DEFAULT 1,
 updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
 PRIMARY KEY(owner_hash,category_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE IF NOT EXISTS sx_phonebook_shares (
 owner_hash CHAR(64) NOT NULL, resource_type ENUM('book','contact') NOT NULL, resource_id BIGINT UNSIGNED NOT NULL,
 recipient_type ENUM('user','agents') NOT NULL, recipient_id BIGINT UNSIGNED NOT NULL,
 created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 PRIMARY KEY(owner_hash,resource_type,resource_id,recipient_type,recipient_id),
 KEY idx_phonebook_recipient(recipient_type,recipient_id,owner_hash)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE IF NOT EXISTS sx_phonebook_openings (
 owner_hash CHAR(64) NOT NULL, conversation_hash CHAR(64) NOT NULL,
 created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 PRIMARY KEY(owner_hash,conversation_hash)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
ALTER TABLE contact
 ADD KEY idx_sx_phonebook_owner_book (uid(191),phonebook_id(100)),
 ADD KEY idx_sx_phonebook_owner_mobile (uid(191),mobile(32));
