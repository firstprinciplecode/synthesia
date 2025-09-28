#!/usr/bin/env node
import { config } from 'dotenv'
import { join } from 'path'
import pg from 'pg'

// Try backend/.env first, then fall back to project root .env
config({ path: join(process.cwd(), './backend/.env') })
config({ path: join(process.cwd(), './.env') })

const { Client } = pg

async function main() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL?.includes('neon.tech') ? { rejectUnauthorized: false } : false,
  })
  await client.connect()

  const ddl = `
  create table if not exists messages (
    id varchar(191) primary key,
    conversation_id varchar(191) not null,
    author_id varchar(191) not null,
    author_type varchar(20) not null,
    role varchar(20) not null,
    content jsonb not null,
    run_id varchar(191),
    parent_message_id varchar(191),
    status varchar(20) not null default 'completed',
    created_at timestamp not null default now(),
    updated_at timestamp not null default now()
  );
  create index if not exists messages_conversation_idx on messages (conversation_id);
  create index if not exists messages_author_idx on messages (author_id);
  create index if not exists messages_run_idx on messages (run_id);
  create index if not exists messages_created_at_idx on messages (created_at);
  `

  await client.query(ddl)
  console.log('messages table ensured')
  await client.end()
}

main().catch((e) => { console.error(e); process.exit(1) })


