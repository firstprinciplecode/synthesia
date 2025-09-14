import { db, users } from './backend/src/db/index.js';
import { eq } from 'drizzle-orm';

async function checkTokens() {
  try {
    const rows = await db.select().from(users).where(eq(users.id, 'default-user'));
    console.log('Users found:', rows.length);
    if (rows.length > 0) {
      const user = rows[0];
      console.log('User xAuth:', user.xAuth ? 'Present' : 'Missing');
      if (user.xAuth) {
        const tokens = JSON.parse(user.xAuth);
        console.log('Access token:', tokens.access_token ? 'Present' : 'Missing');
        console.log('Refresh token:', tokens.refresh_token ? 'Present' : 'Missing');
        console.log('Expires at:', tokens.expires_at ? new Date(tokens.expires_at) : 'Not set');
        console.log('User info:', tokens.user);
        console.log('Current time:', new Date());
        if (tokens.expires_at) {
          const timeUntilExpiry = tokens.expires_at - Date.now();
          console.log('Time until expiry (ms):', timeUntilExpiry);
          console.log('Time until expiry (minutes):', Math.round(timeUntilExpiry / 60000));
        }
      }
    }
  } catch (e) {
    console.error('Error:', e.message);
  }
  process.exit(0);
}

checkTokens();
