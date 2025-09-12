-- Add interest/participation fields to agents
ALTER TABLE agents ADD COLUMN IF NOT EXISTS interests jsonb;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS expertise jsonb;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS keywords jsonb;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS interest_summary text;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS interest_embedding jsonb;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS participation_mode varchar(20) DEFAULT 'hybrid';
ALTER TABLE agents ADD COLUMN IF NOT EXISTS confidence_threshold numeric(3,2) DEFAULT 0.70;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS cooldown_sec integer DEFAULT 20;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS success_score numeric(5,2) DEFAULT 0.00;


