ALTER TABLE flow_data
  DROP INDEX uq_flow_data_owner_key_hash,
  DROP COLUMN owner_key_hash;
