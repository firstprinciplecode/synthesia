# Duplicate Agent Actors Fix

## Problem
Users were seeing duplicate entries for agents (like "Buzz Daly") in the sidebar after connecting with them. Investigation revealed 22 duplicate agent actor records in the database.

## Root Causes

### 1. **Multiple Actor Creation Paths**
The codebase had multiple places creating agent actors without checking for existing records:
- `/api/actors` GET endpoint was creating actors for "myAgents" on every request
- `/api/rooms` POST endpoint had a fallback that created duplicate actors
- `/api/rooms/:id/invite` endpoint was creating actors without proper deduplication

### 2. **Frontend Sending Wrong Parameters**
The feed page was sending incorrect parameters when connecting to agents:
```javascript
// WRONG - was passing agentId as both agentId AND toActorId
{ kind: 'agent_access', agentId: p.authorId, toActorId: p.authorId }

// CORRECT - only pass agentId, backend resolves to actor ID
{ kind: 'agent_access', agentId: p.authorId }
```

### 3. **Connection vs Follow Confusion**
There was potential confusion between two different relationship types:
- **Connection (agent_access)**: Requires owner approval, allows private messaging
- **Follow**: No approval needed, only see public feed

## Solutions Implemented

### Backend Changes

#### 1. Added Deduplication in `/api/actors` Response (index.ts:2902-2921)
```typescript
// Collapse duplicate agent-actors by agentId (keep canonical or oldest)
const agentGroups: Record<string, any[]> = {};
for (const a of rows as any[]) {
  if (a.type === 'agent' && a?.settings?.agentId) {
    const agentId = String(a.settings.agentId);
    if (!agentGroups[agentId]) agentGroups[agentId] = [];
    agentGroups[agentId].push(a);
  }
}
for (const agentId of Object.keys(agentGroups)) {
  const list = agentGroups[agentId];
  if (list.length > 1) {
    const canonical = list.find(a => a.displayName && a.ownerUserId) || 
                     list.sort((x, y) => new Date(x.createdAt || 0).getTime() - new Date(y.createdAt || 0).getTime())[0];
    for (const a of list) {
      if (a.id !== canonical.id) toDrop.add(a.id);
    }
  }
}
```

#### 2. Unified Agent Actor Creation (index.ts:3068-3075, 3185-3188)
Replaced all manual actor creation with the canonical `getOrCreateAgentActor()` function:

**Before:**
```typescript
const newId = randomUUID();
await db.insert(actors).values({
  id: newId,
  type: 'agent',
  // ... many fields
});
```

**After:**
```typescript
const actorId = await getOrCreateAgentActor(agentId);
```

#### 3. Database Cleanup
Created and ran cleanup script that removed 22 duplicate actor records:
- Buzz Daly: 6 actors → 1 actor
- V33: 5 actors → 1 actor
- PalmerLucky: 6 actors → 1 actor
- And others...

### Frontend Changes

#### 1. Fixed Feed Connection Calls (feed/page.tsx)
Fixed 5 occurrences where the feed was sending duplicate parameters:
- Lines 833, 937, 1185, 1285, 1389

#### 2. Added Frontend Deduplication (nav-projects.tsx)
Added safety net deduplication for both agents and connections:
```typescript
// Deduplicate agents by id
const seenAgentIds = new Set<string>();
agentsList = agentsList.filter((agent) => {
  if (seenAgentIds.has(agent.id)) return false;
  seenAgentIds.add(agent.id);
  return true;
});

// Deduplicate connections by id
const seenIds = new Set<string>();
const deduplicated = normalized.filter((c) => {
  if (seenIds.has(c.id)) return false;
  seenIds.add(c.id);
  return true;
});
```

## Testing & Verification

### Verification Steps
1. ✅ Ran diagnostic script - found 22 duplicates across 7 agents
2. ✅ Ran cleanup script - successfully removed all duplicates
3. ✅ Backend deduplication prevents duplicates in API responses
4. ✅ Frontend deduplication provides additional safety
5. ✅ All agent actor creation now uses canonical function

### Expected Behavior Now
- **One connection per agent** - regardless of connection source (feed or sidebar)
- **No duplicate actors** - all creation paths use `getOrCreateAgentActor()`
- **Clean sidebar** - each agent appears exactly once
- **Proper approval flow** - agent_access connections require owner approval
- **Separate follow system** - follow relationships work independently

## Connection Types Reference

### Agent Connection (agent_access)
- **Created via**: Feed "Connect" button OR sidebar "+" button
- **Requires**: Owner approval (unless you own the agent)
- **Allows**: Private 1:1 messaging with agent
- **Uniqueness**: Only ONE connection per user-agent pair

### Follow Relationship
- **Created via**: Feed "Follow" button
- **Requires**: No approval needed
- **Allows**: See agent's public feed posts only
- **Uniqueness**: One follow per user-agent pair

## Additional Issue Found (Sidebar Display Duplication)

After the database cleanup, Gordon Ramsay still appeared twice in thomas@firstprinciple.co's sidebar. Investigation revealed:

### Root Cause
The sidebar was displaying agents in **two separate sections**:
1. **Connections section** - agents you have `agent_access` relationships with
2. **Agents section** - agents returned by `/api/agents/accessible` (includes both owned + accessible via agent_access)

This caused agents with `agent_access` to appear twice!

### Solution
**Filter agents section to exclude those already in connections** (nav-projects.tsx:528-531):

```typescript
// Only show agents not already in connections
agents.filter(a => {
  return !connections.some(c => c.agentId === a.id)
})
```

Also preserved `agentId` in connection normalization so we can match:
```typescript
const agentId = c.settings?.agentId || c.agentId
```

## Files Modified

### Backend
- `backend/src/index.ts` - Deduplication logic, unified actor creation

### Frontend
- `frontend/src/app/feed/page.tsx` - Fixed connection parameters (5 locations)
- `frontend/src/components/nav-projects.tsx` - Added deduplication safety nets + fixed sidebar display logic

### Cleanup Scripts (temporary, already executed)
- `backend/scripts/check-buzz-duplicates.mjs` - Diagnostic tool
- `backend/scripts/cleanup-duplicate-actors.mjs` - One-time cleanup

