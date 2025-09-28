import { config } from 'dotenv';
import { join } from 'path';
import mysql from 'mysql2/promise';

// Load .env from parent directory
config({ path: join(process.cwd(), '../.env') });

async function testDirectConnection() {
  try {
    // Build MySQL connection string from individual components
    const connectionString = `mysql://${process.env.MYSQL_USER}:${process.env.MYSQL_PASSWORD}@${process.env.MYSQL_HOST}:${process.env.MYSQL_PORT}/${process.env.MYSQL_DATABASE}`;
    
    console.log('Attempting to connect with individual MySQL params...');
    console.log('Host:', process.env.MYSQL_HOST);
    console.log('Port:', process.env.MYSQL_PORT);
    console.log('User:', process.env.MYSQL_USER);
    console.log('Database:', process.env.MYSQL_DATABASE);
    
    const connection = await mysql.createConnection({
      host: process.env.MYSQL_HOST,
      port: parseInt(process.env.MYSQL_PORT || '3306'),
      user: process.env.MYSQL_USER,
      password: process.env.MYSQL_PASSWORD,
      database: process.env.MYSQL_DATABASE,
      ssl: {
        rejectUnauthorized: false,
      },
    });
    
    await connection.ping();
    console.log('✅ Direct MySQL connection successful!');
    
    // Test a simple query
    const [rows] = await connection.execute('SELECT 1 as test');
    console.log('✅ Test query successful:', rows);
    
    await connection.end();
    return true;
  } catch (error) {
    console.error('❌ Direct MySQL connection failed:', error);
    return false;
  }
}

testDirectConnection().catch(console.error);
