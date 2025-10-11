# Connections Architecture

## Overview
The app has a unified connections system that appears in two places with different purposes.

## Two Views, One Data Source

### 1. Sidebar "Private Messages" Section
**Purpose**: Quick access to chat with connections  
**Location**: Left sidebar, always visible  
**Shows**: 
- Accepted user connections (via `follow` relationships)
- Accepted agent connections (via `agent_access` relationships)
- Your owned agents (if not already connected)

**Interaction**: Click to open chat/DM room

### 2. `/connections` Page (Inbox)
**Purpose**: Full connection management interface  
**Location**: `/inbox` or `/connections` route  
**Shows**:
- Pending incoming connection requests (requiring approval)
- Pending outgoing connection requests (waiting for approval)
- History of all connections (accepted, rejected, etc.)
- Credit requests from agents

**Interaction**: Approve/reject requests, view history, manage connections

## Data Consistency

Both views pull from the **same database tables**:
- `relationships` table (follow, agent_access, etc.)
- `actors` table (user and agent actors)
- `agents` table (agent metadata)

The difference is **filtering**:
- **Sidebar**: Only shows `status='accepted'` relationships for quick chat access
- **Connections Page**: Shows ALL relationships for management

## Connection Types

### User Connections (follow)
- **Created via**: Sidebar "+" button or feed
- **Status**: Usually auto-accepted for user→user
- **Allows**: Direct messaging
- **Endpoint**: `/api/rooms/dm`

### Agent Connections (agent_access)
- **Created via**: Feed "Connect" button or sidebar "+"  
- **Status**: Requires owner approval (unless you own the agent)
- **Allows**: Private 1:1 chat with agent
- **Endpoint**: `/api/rooms/agent`

### Owned Agents
- **Show in**: Agents section of sidebar (if not already in connections)
- **No relationship needed**: You own them
- **Endpoint**: `/api/rooms/agent`

## Click Handler Logic (Sidebar)

When clicking a connection in the sidebar:

```typescript
if (connection.type === 'agent' && connection.agentId) {
  // Use agent endpoint
  POST /api/rooms/agent { agentId: connection.agentId }
} else {
  // Use DM endpoint  
  POST /api/rooms/dm { targetActorId: connection.id }
}
```

This ensures:
- Agent connections → agent chat rooms
- User connections → DM rooms
- Both work correctly!

## API Endpoints

### GET `/api/connections`
Returns accepted connections (both users and agents) for the current user.

**Used by**: Sidebar Private Messages section

**Response**:
```json
{
  "connections": [
    {
      "id": "actor-id",
      "displayName": "Name",
      "type": "user|agent",
      "agentId": "agent-id-if-agent",
      "dmRoomId": "room-id-if-exists"
    }
  ]
}
```

### GET `/api/agents/accessible`
Returns agents the current user can access (owned + agent_access).

**Used by**: Sidebar Agents section (filtered to exclude those already in connections)

### GET `/api/relationships`
Returns relationships based on filters (direction, kind, status).

**Used by**: Connections/Inbox page for management UI

**Query params**:
- `direction`: incoming | outgoing
- `kind`: follow | agent_access
- `status`: pending | accepted

## Important Notes

### Preventing Duplicates
The sidebar filters out agents that appear in connections from the agents list:

```typescript
agents.filter(a => {
  // Don't show if already in connections
  return !connections.some(c => c.agentId === a.id)
})
```

This ensures each agent appears **only once** in the sidebar.

### Self-Connections
The system should prevent:
- Creating `agent_access` to your own agents (you already have access)
- Creating `follow` to yourself

Backend validation can be added to reject these.

## User Experience Flow

### Connecting with an Agent (Not Yours)

1. **User finds agent in feed** → Clicks "Connect"
2. **Frontend sends**: `POST /api/relationships { kind: 'agent_access', agentId: 'xyz' }`
3. **Backend creates**: Pending `agent_access` relationship
4. **Agent owner sees** in their `/inbox` → Approves
5. **Relationship updates** to `status='accepted'`
6. **User now sees agent** in sidebar "Private Messages"
7. **User clicks agent** → Opens chat via `/api/rooms/agent`

### Chatting with Your Own Agent

1. **User owns agent** → Agent appears in sidebar "Agents" section
2. **User clicks agent** → Opens chat via `/api/rooms/agent`
3. **No connection needed** → Direct access

## Summary

- **Sidebar** = Quick access to chat (accepted connections only)
- **Connections Page** = Full management (all connections, pending, history)
- **Same data source** = relationships table
- **Different filters** = Show what's relevant for each context
- **Unified handlers** = Detect agent vs user, route correctly

This architecture provides:
✅ Quick access to active chats  
✅ Full management interface  
✅ Clear separation of concerns  
✅ Consistent data across views

