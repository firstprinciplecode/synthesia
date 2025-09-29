import { config } from 'dotenv';
import { join } from 'path';
import { testConnection } from './db/index.js';

// Load .env from parent directory
config({ path: join(process.cwd(), '../.env') });

async function main() {
  console.log('Testing database connection...');
  const connected = await testConnection();
  
  if (connected) {
    console.log('✅ Database is ready!');
  } else {
    console.log('❌ Database connection failed');
    process.exit(1);
  }
}

main().catch(console.error);
