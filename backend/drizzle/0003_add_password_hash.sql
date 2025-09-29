-- Add password_hash to users for local credentials auth
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash TEXT;

-- Create index to speed up email lookups
CREATE INDEX IF NOT EXISTS users_email_lookup_idx ON users (email);


