import { drizzle } from 'drizzle-orm/node-postgres';
import pkg from 'pg';
import { users, agents, conversations, actors, rooms, roomMembers, relationships, policies, messages, roomReads, wallets } from './schema.js';

const { Pool } = pkg as any;

// Lazy-loaded database connection to ensure env vars are loaded
let _db: any = null;
let _pool: any = null;

function createConnection() {
  if (!_pool) {
    console.log('🔗 Creating database connection...');
    console.log('DATABASE_URL exists:', !!process.env.DATABASE_URL);
    console.log('DATABASE_URL starts with:', process.env.DATABASE_URL?.substring(0, 20) + '...');
    
    const connectionString = process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/postgres';
    const isNeon = connectionString.includes('neon.tech');

    _pool = new Pool({
      connectionString,
      max: Number(process.env.PG_POOL_MAX ?? 10),
      idleTimeoutMillis: Number(process.env.PG_IDLE_TIMEOUT ?? 30_000),
      connectionTimeoutMillis: Number(process.env.PG_CONNECTION_TIMEOUT ?? 10_000),
      keepAlive: true,
      // Enable SSL for cloud databases like Neon
      ssl: isNeon ? { rejectUnauthorized: false } : false
    });

    _pool.on('error', (err) => {
      console.error('Unexpected error on idle PostgreSQL client', err);
    });
    
    _db = drizzle(_pool);
    console.log('✅ Database connection created');
  }
  return _db;
}

export const db = new Proxy({}, {
  get(target, prop) {
    const dbInstance = createConnection();
    return dbInstance[prop];
  }
}) as any;
export { users, agents, conversations, actors, rooms, roomMembers, relationships, policies, messages, roomReads, wallets };


// Graceful shutdown helper to close the underlying PG pool
export async function closeDbPool(): Promise<void> {
  try {
    if (_pool && typeof _pool.end === 'function') {
      await _pool.end();
    }
  } catch (_) {
    // ignore
  } finally {
    _pool = null;
    _db = null;
  }
}


// Simple connectivity check used by test-db.ts
export async function testConnection(): Promise<boolean> {
  try {
    const conn = createConnection();
    // Perform a lightweight query to validate connectivity
    await conn.execute?.(String.raw`select 1`);
    return true;
  } catch (_) {
    return false;
  }
}


