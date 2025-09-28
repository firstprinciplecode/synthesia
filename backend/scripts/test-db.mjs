#!/usr/bin/env node
import { config } from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load env from project root .env
config({ path: path.resolve(__dirname, '../.env') });

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL not set. Please configure it in .env');
    process.exit(1);
  }
  console.log('[db] Connecting to:', url.split('@').pop());
  const { Client } = pg;
  const needsSsl = /sslmode=require|neon\.tech/i.test(url);
  const client = new Client({ connectionString: url, ssl: needsSsl ? { rejectUnauthorized: false } : undefined });
  try {
    await client.connect();
    const now = await client.query('select now() as now');
    console.log('[db] now():', now.rows[0].now);
    const col = await client.query(
      `select column_name from information_schema.columns where table_name='agents' and column_name='tool_preferences'`
    );
    console.log('[db] agents.tool_preferences exists:', col.rowCount > 0);
    process.exit(0);
  } catch (err) {
    console.error('[db] Error:', err);
    process.exit(2);
  } finally {
    try { await client.end(); } catch {}
  }
}

main();


