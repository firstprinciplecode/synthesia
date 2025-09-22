import { drizzle } from 'drizzle-orm/node-postgres';
import pkg from 'pg';
import { users, agents, conversations, actors, rooms, roomMembers, relationships, policies, messages } from './schema.js';

const { Pool } = pkg as any;

// Lazy-loaded database connection to ensure env vars are loaded
let _db: any = null;
let _pool: any = null;

function createConnection() {
  if (!_pool) {
    console.log('🔗 Creating database connection...');
    console.log('DATABASE_URL exists:', !!process.env.DATABASE_URL);
    console.log('DATABASE_URL starts with:', process.env.DATABASE_URL?.substring(0, 20) + '...');
    
    _pool = new Pool({
      connectionString: process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/postgres',
      // Enable SSL for cloud databases like Neon
      ssl: process.env.DATABASE_URL?.includes('neon.tech') ? { rejectUnauthorized: false } : false
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
export { users, agents, conversations, actors, rooms, roomMembers, relationships, policies, messages };


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


