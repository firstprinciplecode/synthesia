import dotenv from 'dotenv';
import { drizzle } from 'drizzle-orm/mysql2';
import mysql from 'mysql2/promise';
import { eq, and } from 'drizzle-orm';
import * as schema from '../dist/db/schema.js';

dotenv.config({ path: '../.env' });

const connection = await mysql.createConnection(process.env.DATABASE_URL);
const db = drizzle(connection, { schema, mode: 'default' });

async function main() {
  try {
    // Find thomas@firstprinciple.co user
    const thomasUsers = await db.select().from(schema.users).where(eq(schema.users.email, 'thomas@firstprinciple.co'));
    if (!thomasUsers.length) {
      console.log('thomas@firstprinciple.co user not found');
      return;
    }
    const thomasUserId = thomasUsers[0].id;
    console.log('Thomas user ID:', thomasUserId);

    // Find all actors belonging to thomas@firstprinciple.co
    const thomasActors = await db.select().from(schema.actors).where(eq(schema.actors.ownerUserId, thomasUserId));
    console.log('Thomas actors:', thomasActors.length);
    const thomasActorIds = thomasActors.map(a => a.id);

    // Find Palmer Lucky agent
    const palmerAgents = await db.select().from(schema.agents).where(eq(schema.agents.name, 'PalmerLucky'));
    if (!palmerAgents.length) {
      console.log('Palmer Lucky agent not found');
      return;
    }
    const palmerAgentId = palmerAgents[0].id;
    console.log('Palmer agent ID:', palmerAgentId);

    // Find Palmer Lucky actor
    const palmerActors = await db.select().from(schema.actors).where(eq(schema.actors.type, 'agent'));
    const palmerActor = palmerActors.find(a => a.settings?.agentId === palmerAgentId);
    if (!palmerActor) {
      console.log('Palmer Lucky actor not found');
      return;
    }
    console.log('Palmer actor ID:', palmerActor.id);

    // Delete all agent_access relationships from Thomas actors to Palmer actor
    const result = await db.delete(schema.relationships)
      .where(
        and(
          eq(schema.relationships.kind, 'agent_access'),
          eq(schema.relationships.toActorId, palmerActor.id)
        )
      );

    console.log('Deleted relationships:', result);
    console.log('Successfully disconnected Thomas from Palmer Lucky');
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await connection.end();
  }
}

main();
