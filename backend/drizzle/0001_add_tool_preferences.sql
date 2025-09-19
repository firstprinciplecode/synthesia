-- add tool_preferences column
ALTER TABLE agents ADD COLUMN IF NOT EXISTS tool_preferences JSONB;
