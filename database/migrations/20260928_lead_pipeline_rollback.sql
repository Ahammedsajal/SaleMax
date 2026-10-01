-- Rollback only after exporting any pipeline-created lead history that must be kept.
DROP TABLE IF EXISTS pipeline_phonebook_memberships;
DROP TABLE IF EXISTS pipeline_phonebook_map;
DROP TABLE IF EXISTS pipeline_activity;
DROP TABLE IF EXISTS pipeline_events;
DROP TABLE IF EXISTS pipeline_attributions;
DROP TABLE IF EXISTS pipeline_conversations;
DROP TABLE IF EXISTS pipeline_identity_locks;
DROP TABLE IF EXISTS pipeline_leads;
DROP TABLE IF EXISTS pipeline_stages;
DROP TABLE IF EXISTS pipeline_settings;
