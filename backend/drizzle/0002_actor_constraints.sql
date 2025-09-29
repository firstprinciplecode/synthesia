-- Ensure case-insensitive unique handles
CREATE UNIQUE INDEX IF NOT EXISTS actors_handle_lower_unique ON actors ((lower(handle))) WHERE handle IS NOT NULL;

-- Ensure one-to-one mapping between agent actors and agents via settings->>'agentId'
CREATE UNIQUE INDEX IF NOT EXISTS actors_agent_link_unique ON actors (((settings->>'agentId'))) WHERE type = 'agent' AND (settings->>'agentId') IS NOT NULL;


