#!/usr/bin/env node
import { config } from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load env from project root .env
config({ path: path.resolve(__dirname, '../.env') });
// Also attempt to load root .env one level up (../..), in case this script lives under backend/scripts
config({ path: path.resolve(__dirname, '../../.env') });

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('[add-tool-preferences] DATABASE_URL not set in .env');
    process.exit(1);
  }
  const { Client } = pg;
  const needsSsl = /sslmode=require|neon\.tech/i.test(url);
  const client = new Client({ connectionString: url, ssl: needsSsl ? { rejectUnauthorized: false } : undefined });
  try {
    await client.connect();
    const check = await client.query(`select column_name from information_schema.columns where table_name='agents' and column_name='tool_preferences'`);
    if (check.rowCount > 0) {
      console.log('[add-tool-preferences] agents.tool_preferences already exists');
      process.exit(0);
    }
    await client.query('ALTER TABLE agents ADD COLUMN IF NOT EXISTS tool_preferences JSONB');
    console.log('[add-tool-preferences] agents.tool_preferences added');
    process.exit(0);
  } catch (err) {
    console.error('[add-tool-preferences] Error:', err.message || err);
    process.exit(2);
  } finally {
    try { await client.end(); } catch {}
  }
}

main();


