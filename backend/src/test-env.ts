import { config } from 'dotenv';
import { join } from 'path';

// Load .env from parent directory
config({ path: join(process.cwd(), '../.env') });

console.log('Environment variables:');
console.log('MYSQL_HOST:', process.env.MYSQL_HOST);
console.log('MYSQL_PORT:', process.env.MYSQL_PORT);
console.log('MYSQL_USER:', process.env.MYSQL_USER);
console.log('MYSQL_PASSWORD:', process.env.MYSQL_PASSWORD ? '[SET]' : '[NOT SET]');
console.log('MYSQL_DATABASE:', process.env.MYSQL_DATABASE);
console.log('DATABASE_URL:', process.env.DATABASE_URL ? '[SET]' : '[NOT SET]');
