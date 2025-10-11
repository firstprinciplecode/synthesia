import { relations } from 'drizzle-orm';
import {
  pgTable,
  varchar,
  text,
  timestamp,
  jsonb,
  integer,
  boolean,
  numeric,
  index,
  primaryKey,
} from 'drizzle-orm/pg-core';

// === USERS AND ORGANIZATIONS ===

export const users = pgTable('users', {
  id: varchar('id', { length: 191 }).primaryKey(),
  email: varchar('email', { length: 191 }).unique().notNull(),
  name: varchar('name', { length: 191 }),
  avatar: text('avatar'),
  phone: varchar('phone', { length: 50 }),
  bio: text('bio'),
  location: varchar('location', { length: 191 }),
  company: varchar('company', { length: 191 }),
  website: varchar('website', { length: 255 }),
  // Tool/run approval policy for this user (if true, always ask for approval for write actions)
  requireApproval: boolean('require_approval').default(true),
  // OAuth storage for X (Twitter) per-user connection
  xAuth: jsonb('x_auth'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  emailIdx: index('users_email_idx').on(table.email),
}));

export const organizations = pgTable('organizations', {
  id: varchar('id', { length: 191 }).primaryKey(),
  name: varchar('name', { length: 191 }).notNull(),
  slug: varchar('slug', { length: 191 }).unique().notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  slugIdx: index('organizations_slug_idx').on(table.slug),
}));

export const memberships = pgTable('memberships', {
  id: varchar('id', { length: 191 }).primaryKey(),
  userId: varchar('user_id', { length: 191 }).notNull(),
  organizationId: varchar('organization_id', { length: 191 }).notNull(),
  role: varchar('role', { length: 50 }).notNull().default('member'), // owner, admin, member
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  userOrgIdx: index('memberships_user_org_idx').on(table.userId, table.organizationId),
}));

// === AGENTS ===

export const agents = pgTable('agents', {
  id: varchar('id', { length: 191 }).primaryKey(),
  name: varchar('name', { length: 191 }).notNull(),
  description: text('description'),
  instructions: text('instructions').notNull(),
  avatar: text('avatar'), // Agent avatar URL
  organizationId: varchar('organization_id', { length: 191 }).notNull(),
  createdBy: varchar('created_by', { length: 191 }).notNull(),
  
  // LLM Configuration
  defaultModel: varchar('default_model', { length: 100 }).notNull().default('gpt-4o'),
  defaultProvider: varchar('default_provider', { length: 50 }).notNull().default('openai'),
  
  // Tool Configuration
  autoExecuteTools: boolean('auto_execute_tools').default(false), // Whether to auto-execute tools or ask for permission
  toolPreferences: jsonb('tool_preferences'), // Optional per-agent tool preferences (capabilities -> preferred tools, approval)
  
  // Interest-based participation
  interests: jsonb('interests'), // array of strings
  expertise: jsonb('expertise'), // array of strings
  keywords: jsonb('keywords'), // array of strings
  interestSummary: text('interest_summary'), // curated description of what the agent should jump into
  interestEmbedding: jsonb('interest_embedding'), // 1536-dim float array stored as JSON
  participationMode: varchar('participation_mode', { length: 20 }).default('hybrid'), // proactive | reactive | hybrid
  confidenceThreshold: numeric('confidence_threshold', { precision: 3, scale: 2 }).default('0.70'), // 0.00 - 1.00
  cooldownSec: integer('cooldown_sec').default(20),
  successScore: numeric('success_score', { precision: 5, scale: 2 }).default('0.00'),
  // Public participation
  isPublic: boolean('is_public').default(false),
  publicMatchThreshold: numeric('public_match_threshold', { precision: 3, scale: 2 }).default('0.70'),
  
  // Limits and budgets
  maxTokensPerRequest: integer('max_tokens_per_request').default(4000),
  maxToolCallsPerRun: integer('max_tool_calls_per_run').default(10),
  maxRunTimeSeconds: integer('max_run_time_seconds').default(300),
  
  // Status
  isActive: boolean('is_active').default(true),
  
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  orgIdx: index('agents_org_idx').on(table.organizationId),
  createdByIdx: index('agents_created_by_idx').on(table.createdBy),
}));

// === TOOL CONFIGURATIONS ===

export const toolConfigs = pgTable('tool_configs', {
  id: varchar('id', { length: 191 }).primaryKey(),
  agentId: varchar('agent_id', { length: 191 }).notNull(),
  toolName: varchar('tool_name', { length: 100 }).notNull(), // serpapi, mysql, etc.
  config: jsonb('config').notNull(), // encrypted tool-specific config/keys
  scopes: jsonb('scopes').notNull(), // array of allowed scopes
  isEnabled: boolean('is_enabled').default(true),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  agentToolIdx: index('tool_configs_agent_tool_idx').on(table.agentId, table.toolName),
}));

// === CONVERSATIONS AND MESSAGES ===

export const conversations = pgTable('conversations', {
  id: varchar('id', { length: 191 }).primaryKey(),
  organizationId: varchar('organization_id', { length: 191 }).notNull(),
  title: varchar('title', { length: 255 }),
  type: varchar('type', { length: 50 }).notNull(), // dm, group, agent_chat
  
  // Participants (JSON array of user/agent IDs)
  participants: jsonb('participants').notNull(),
  
  // Settings
  isArchived: boolean('is_archived').default(false),
  
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  orgIdx: index('conversations_org_idx').on(table.organizationId),
  typeIdx: index('conversations_type_idx').on(table.type),
}));

export const messages = pgTable('messages', {
  id: varchar('id', { length: 191 }).primaryKey(),
  conversationId: varchar('conversation_id', { length: 191 }).notNull(),
  
  // Author (user or agent ID)
  authorId: varchar('author_id', { length: 191 }).notNull(),
  authorType: varchar('author_type', { length: 20 }).notNull(), // user, agent
  
  // Content
  role: varchar('role', { length: 20 }).notNull(), // user, assistant, system
  content: jsonb('content').notNull(), // array of content parts (text, citations, etc.)
  
  // Metadata
  runId: varchar('run_id', { length: 191 }), // if this message was generated by a run
  parentMessageId: varchar('parent_message_id', { length: 191 }), // for threading
  
  // Status
  status: varchar('status', { length: 20 }).notNull().default('completed'), // streaming, completed, failed
  
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  conversationIdx: index('messages_conversation_idx').on(table.conversationId),
  authorIdx: index('messages_author_idx').on(table.authorId),
  runIdx: index('messages_run_idx').on(table.runId),
  createdAtIdx: index('messages_created_at_idx').on(table.createdAt),
}));

// === RUNS (AGENT EXECUTIONS) ===

export const runs = pgTable('runs', {
  id: varchar('id', { length: 191 }).primaryKey(),
  conversationId: varchar('conversation_id', { length: 191 }).notNull(),
  agentId: varchar('agent_id', { length: 191 }).notNull(),
  
  // Trigger
  triggerMessageId: varchar('trigger_message_id', { length: 191 }).notNull(),
  
  // Configuration
  model: varchar('model', { length: 100 }).notNull(),
  provider: varchar('provider', { length: 50 }).notNull(),
  
  // Status and timing
  status: varchar('status', { length: 20 }).notNull().default('queued'), // queued, running, completed, failed, cancelled
  startedAt: timestamp('started_at'),
  completedAt: timestamp('completed_at'),
  
  // Costs and usage
  inputTokens: integer('input_tokens').default(0),
  outputTokens: integer('output_tokens').default(0),
  totalCost: numeric('total_cost', { precision: 10, scale: 6 }).default('0.000000'),
  
  // Results
  error: text('error'), // if failed
  toolCallsCount: integer('tool_calls_count').default(0),
  
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  conversationIdx: index('runs_conversation_idx').on(table.conversationId),
  agentIdx: index('runs_agent_idx').on(table.agentId),
  statusIdx: index('runs_status_idx').on(table.status),
  createdAtIdx: index('runs_created_at_idx').on(table.createdAt),
}));

// === TOOL CALLS ===

export const toolCalls = pgTable('tool_calls', {
  id: varchar('id', { length: 191 }).primaryKey(),
  runId: varchar('run_id', { length: 191 }).notNull(),
  
  // Tool details
  toolName: varchar('tool_name', { length: 100 }).notNull(),
  functionName: varchar('function_name', { length: 100 }).notNull(),
  arguments: jsonb('arguments').notNull(),
  
  // Results
  result: jsonb('result'),
  error: text('error'),
  
  // Timing
  startedAt: timestamp('started_at').defaultNow().notNull(),
  completedAt: timestamp('completed_at'),
  durationMs: integer('duration_ms'),
  
  // Status
  status: varchar('status', { length: 20 }).notNull().default('pending'), // pending, running, completed, failed
  
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  runIdx: index('tool_calls_run_idx').on(table.runId),
  toolIdx: index('tool_calls_tool_idx').on(table.toolName),
  statusIdx: index('tool_calls_status_idx').on(table.status),
}));

// === FILES AND KNOWLEDGE ===

export const files = pgTable('files', {
  id: varchar('id', { length: 191 }).primaryKey(),
  organizationId: varchar('organization_id', { length: 191 }).notNull(),
  uploadedBy: varchar('uploaded_by', { length: 191 }).notNull(),
  
  // File details
  filename: varchar('filename', { length: 255 }).notNull(),
  originalName: varchar('original_name', { length: 255 }).notNull(),
  mimeType: varchar('mime_type', { length: 100 }).notNull(),
  size: integer('size').notNull(),
  
  // Storage
  storageUrl: text('storage_url').notNull(),
  storageProvider: varchar('storage_provider', { length: 50 }).notNull().default('local'),
  
  // Processing status
  processingStatus: varchar('processing_status', { length: 50 }).notNull().default('pending'), // pending, processing, completed, failed
  
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  orgIdx: index('files_org_idx').on(table.organizationId),
  uploadedByIdx: index('files_uploaded_by_idx').on(table.uploadedBy),
  statusIdx: index('files_status_idx').on(table.processingStatus),
}));

export const chunks = pgTable('chunks', {
  id: varchar('id', { length: 191 }).primaryKey(),
  fileId: varchar('file_id', { length: 191 }).notNull(),
  organizationId: varchar('organization_id', { length: 191 }).notNull(),
  
  // Content
  content: text('content').notNull(),
  metadata: jsonb('metadata').notNull(), // page number, section, etc.
  
  // Vector embedding (stored separately in Pinecone)
  embeddingId: varchar('embedding_id', { length: 191 }), // reference to Pinecone vector
  
  // Position
  startIndex: integer('start_index').notNull(),
  endIndex: integer('end_index').notNull(),
  
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  fileIdx: index('chunks_file_idx').on(table.fileId),
  orgIdx: index('chunks_org_idx').on(table.organizationId),
  embeddingIdx: index('chunks_embedding_idx').on(table.embeddingId),
}));

// === RELATIONS ===

export const usersRelations = relations(users, ({ many }) => ({
  memberships: many(memberships),
  agents: many(agents),
  files: many(files),
}));

export const organizationsRelations = relations(organizations, ({ many }) => ({
  memberships: many(memberships),
  agents: many(agents),
  conversations: many(conversations),
  files: many(files),
}));

export const membershipsRelations = relations(memberships, ({ one }) => ({
  user: one(users, {
    fields: [memberships.userId],
    references: [users.id],
  }),
  organization: one(organizations, {
    fields: [memberships.organizationId],
    references: [organizations.id],
  }),
}));

export const agentsRelations = relations(agents, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [agents.organizationId],
    references: [organizations.id],
  }),
  creator: one(users, {
    fields: [agents.createdBy],
    references: [users.id],
  }),
  toolConfigs: many(toolConfigs),
  runs: many(runs),
}));

export const conversationsRelations = relations(conversations, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [conversations.organizationId],
    references: [organizations.id],
  }),
  messages: many(messages),
  runs: many(runs),
  roomReads: many(roomReads),
}));

export const messagesRelations = relations(messages, ({ one }) => ({
  conversation: one(conversations, {
    fields: [messages.conversationId],
    references: [conversations.id],
  }),
  run: one(runs, {
    fields: [messages.runId],
    references: [runs.id],
  }),
}));

export const runsRelations = relations(runs, ({ one, many }) => ({
  conversation: one(conversations, {
    fields: [runs.conversationId],
    references: [conversations.id],
  }),
  agent: one(agents, {
    fields: [runs.agentId],
    references: [agents.id],
  }),
  triggerMessage: one(messages, {
    fields: [runs.triggerMessageId],
    references: [messages.id],
  }),
  toolCalls: many(toolCalls),
}));

export const toolCallsRelations = relations(toolCalls, ({ one }) => ({
  run: one(runs, {
    fields: [toolCalls.runId],
    references: [runs.id],
  }),
}));

export const filesRelations = relations(files, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [files.organizationId],
    references: [organizations.id],
  }),
  uploader: one(users, {
    fields: [files.uploadedBy],
    references: [users.id],
  }),
  chunks: many(chunks),
}));

export const chunksRelations = relations(chunks, ({ one }) => ({
  file: one(files, {
    fields: [chunks.fileId],
    references: [files.id],
  }),
}));

// === SOCIAL CORE (Actors, Rooms, Relationships, Policies, Feed) ===

export const actors = pgTable('actors', {
  id: varchar('id', { length: 191 }).primaryKey(),
  type: varchar('type', { length: 20 }).notNull(), // user | agent
  handle: varchar('handle', { length: 191 }).unique(),
  displayName: varchar('display_name', { length: 255 }),
  avatarUrl: text('avatar_url'),
  ownerUserId: varchar('owner_user_id', { length: 191 }), // if this is an agent owned by a user
  orgId: varchar('org_id', { length: 191 }),
  capabilityTags: jsonb('capability_tags'),
  settings: jsonb('settings'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  typeIdx: index('actors_type_idx').on(table.type),
  ownerIdx: index('actors_owner_idx').on(table.ownerUserId),
  orgIdx: index('actors_org_idx').on(table.orgId),
}));

export const rooms = pgTable('rooms', {
  id: varchar('id', { length: 191 }).primaryKey(),
  kind: varchar('kind', { length: 20 }).notNull(), // dm | group | channel | feed
  title: varchar('title', { length: 255 }),
  slug: varchar('slug', { length: 191 }),
  createdByActorId: varchar('created_by_actor_id', { length: 191 }).notNull(),
  orgId: varchar('org_id', { length: 191 }),
  isPublic: boolean('is_public').default(false),
  policyId: varchar('policy_id', { length: 191 }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  kindIdx: index('rooms_kind_idx').on(table.kind),
  slugIdx: index('rooms_slug_idx').on(table.slug),
  orgIdx: index('rooms_org_idx').on(table.orgId),
}));

export const roomMembers = pgTable('room_members', {
  id: varchar('id', { length: 191 }).primaryKey(),
  roomId: varchar('room_id', { length: 191 }).notNull(),
  actorId: varchar('actor_id', { length: 191 }).notNull(),
  role: varchar('role', { length: 20 }).notNull().default('member'), // owner | admin | member | guest
  joinsAt: timestamp('joins_at').defaultNow().notNull(),
  leavesAt: timestamp('leaves_at'),
  settings: jsonb('settings'),
}, (table) => ({
  uniqueMember: index('room_members_room_actor_idx').on(table.roomId, table.actorId),
  actorIdx: index('room_members_actor_idx').on(table.actorId),
  roomIdx: index('room_members_room_idx').on(table.roomId),
}));

export const relationships = pgTable('relationships', {
  id: varchar('id', { length: 191 }).primaryKey(),
  fromActorId: varchar('from_actor_id', { length: 191 }).notNull(),
  toActorId: varchar('to_actor_id', { length: 191 }).notNull(),
  kind: varchar('kind', { length: 20 }).notNull(), // follow | block | mute
  metadata: jsonb('metadata'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  uniqueEdge: index('relationships_unique_edge_idx').on(table.fromActorId, table.toActorId, table.kind),
  toIdx: index('relationships_to_idx').on(table.toActorId, table.kind),
  fromIdx: index('relationships_from_idx').on(table.fromActorId, table.kind),
}));

export const policies = pgTable('policies', {
  id: varchar('id', { length: 191 }).primaryKey(),
  scope: varchar('scope', { length: 20 }).notNull(), // room | actor | org
  scopeId: varchar('scope_id', { length: 191 }).notNull(),
  requireApproval: varchar('require_approval', { length: 10 }).notNull().default('ask'), // auto|ask|off
  toolLimits: jsonb('tool_limits'),
  autoReplyThreshold: numeric('auto_reply_threshold', { precision: 3, scale: 2 }).default('0.70'),
  safety: jsonb('safety'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  uniqueScope: index('policies_scope_idx').on(table.scope, table.scopeId),
}));

export const feedItems = pgTable('feed_items', {
  id: varchar('id', { length: 191 }).primaryKey(), // usually messageId
  actorId: varchar('actor_id', { length: 191 }).notNull(),
  replyToId: varchar('reply_to_id', { length: 191 }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  createdIdx: index('feed_items_created_idx').on(table.createdAt),
  actorIdx: index('feed_items_actor_idx').on(table.actorId, table.createdAt),
  replyIdx: index('feed_items_reply_idx').on(table.replyToId),
}));

// === MEMORY SYSTEM ===

export const agentProfiles = pgTable('agent_profiles', {
  id: varchar('id', { length: 191 }).primaryKey(),
  agentId: varchar('agent_id', { length: 191 }).notNull().unique(),
  name: varchar('name', { length: 191 }),
  email: varchar('email', { length: 191 }),
  birthday: timestamp('birthday'),
  interests: jsonb('interests'), // array of strings
  timezone: varchar('timezone', { length: 50 }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  agentIdx: index('agent_profiles_agent_idx').on(table.agentId),
}));

export const agentPreferences = pgTable('agent_preferences', {
  id: varchar('id', { length: 191 }).primaryKey(),
  agentId: varchar('agent_id', { length: 191 }).notNull().unique(),
  communicationStyle: varchar('communication_style', { length: 50 }), // detailed, concise, casual, formal
  technicalLevel: varchar('technical_level', { length: 50 }), // beginner, intermediate, advanced
  responseLength: varchar('response_length', { length: 50 }), // short, medium, long
  topics: jsonb('topics'), // array of preferred topics
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  agentIdx: index('agent_preferences_agent_idx').on(table.agentId),
}));

export const agentProjects = pgTable('agent_projects', {
  id: varchar('id', { length: 191 }).primaryKey(),
  agentId: varchar('agent_id', { length: 191 }).notNull(),
  name: varchar('name', { length: 191 }).notNull(),
  description: text('description'),
  config: jsonb('config'), // project-specific configuration
  status: varchar('status', { length: 50 }).notNull().default('active'), // active, completed, archived
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  agentIdx: index('agent_projects_agent_idx').on(table.agentId),
  statusIdx: index('agent_projects_status_idx').on(table.status),
}));

export const agentContacts = pgTable('agent_contacts', {
  id: varchar('id', { length: 191 }).primaryKey(),
  agentId: varchar('agent_id', { length: 191 }).notNull(),
  name: varchar('name', { length: 191 }).notNull(),
  email: varchar('email', { length: 191 }),
  relationship: varchar('relationship', { length: 50 }), // colleague, friend, family, business
  context: text('context'), // how they know each other, important details
  metadata: jsonb('metadata'), // additional contact information
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  agentIdx: index('agent_contacts_agent_idx').on(table.agentId),
  nameIdx: index('agent_contacts_name_idx').on(table.name),
}));

export const conversationSummaries = pgTable('conversation_summaries', {
  id: varchar('id', { length: 191 }).primaryKey(),
  agentId: varchar('agent_id', { length: 191 }).notNull(),
  conversationId: varchar('conversation_id', { length: 191 }).notNull(),
  summary: text('summary').notNull(),
  keyPoints: jsonb('key_points').notNull(), // array of strings
  decisions: jsonb('decisions').notNull(), // array of strings
  nextSteps: jsonb('next_steps').notNull(), // array of strings
  level: integer('level').notNull().default(1), // 1-5 (immediate to quarterly)
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  agentIdx: index('conversation_summaries_agent_idx').on(table.agentId),
  conversationIdx: index('conversation_summaries_conversation_idx').on(table.conversationId),
  levelIdx: index('conversation_summaries_level_idx').on(table.level),
  createdAtIdx: index('conversation_summaries_created_at_idx').on(table.createdAt),
}));

// === PUBLIC FEED ===
export const publicFeedPosts = pgTable('public_feed_posts', {
  id: varchar('id', { length: 191 }).primaryKey(),
  authorType: varchar('author_type', { length: 32 }).notNull(), // 'user' | 'agent'
  authorId: varchar('author_id', { length: 191 }).notNull(),
  text: text('text').notNull(),
  media: jsonb('media'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  authorIdx: index('public_feed_posts_author_idx').on(table.authorId),
  createdIdx: index('public_feed_posts_created_idx').on(table.createdAt),
}));

export const publicFeedReplies = pgTable('public_feed_replies', {
  id: varchar('id', { length: 191 }).primaryKey(),
  postId: varchar('post_id', { length: 191 }).notNull(),
  authorType: varchar('author_type', { length: 32 }).notNull(), // 'user' | 'agent'
  authorId: varchar('author_id', { length: 191 }).notNull(),
  text: text('text').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  postIdx: index('public_feed_replies_post_idx').on(table.postId),
  authorIdx: index('public_feed_replies_author_idx').on(table.authorId),
  createdIdx: index('public_feed_replies_created_idx').on(table.createdAt),
}));

// === MEMORY RELATIONS ===

export const agentProfilesRelations = relations(agentProfiles, ({ one }) => ({
  agent: one(agents, {
    fields: [agentProfiles.agentId],
    references: [agents.id],
  }),
}));

export const agentPreferencesRelations = relations(agentPreferences, ({ one }) => ({
  agent: one(agents, {
    fields: [agentPreferences.agentId],
    references: [agents.id],
  }),
}));

export const agentProjectsRelations = relations(agentProjects, ({ one }) => ({
  agent: one(agents, {
    fields: [agentProjects.agentId],
    references: [agents.id],
  }),
}));

export const agentContactsRelations = relations(agentContacts, ({ one }) => ({
  agent: one(agents, {
    fields: [agentContacts.agentId],
    references: [agents.id],
  }),
}));

export const conversationSummariesRelations = relations(conversationSummaries, ({ one }) => ({
  agent: one(agents, {
    fields: [conversationSummaries.agentId],
    references: [agents.id],
  }),
  conversation: one(conversations, {
    fields: [conversationSummaries.conversationId],
    references: [conversations.id],
  }),
}));

// Public feed relations (optional minimal)
export const publicFeedRelations = relations(publicFeedReplies, ({ one }) => ({
  post: one(publicFeedPosts, {
    fields: [publicFeedReplies.postId],
    references: [publicFeedPosts.id],
  }),
}));

export const roomReads = pgTable('room_reads', {
  roomId: varchar('room_id', { length: 191 }).notNull(),
  actorId: varchar('actor_id', { length: 191 }).notNull(),
  lastReadMessageId: varchar('last_read_message_id', { length: 191 }),
  lastReadAt: timestamp('last_read_at').defaultNow().notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  pk: primaryKey(table.roomId, table.actorId),
  idxUpdated: index('room_reads_updated_idx').on(table.updatedAt),
}));

export const roomReadsRelations = relations(roomReads, ({ one }) => ({
  room: one(conversations, {
    fields: [roomReads.roomId],
    references: [conversations.id],
  }),
}));

// === CREDIT SYSTEM ===

export const wallets = pgTable('wallets', {
  id: varchar('id', { length: 191 }).primaryKey(),
  ownerId: varchar('owner_id', { length: 191 }).notNull(),
  ownerType: varchar('owner_type', { length: 20 }).notNull(), // USER | AGENT
  balance: numeric('balance', { precision: 10, scale: 2 }).notNull().default('0.00'),
  lifetimeEarned: numeric('lifetime_earned', { precision: 12, scale: 2 }).notNull().default('0.00'),
  lifetimeSpent: numeric('lifetime_spent', { precision: 12, scale: 2 }).notNull().default('0.00'),
  status: varchar('status', { length: 20 }).notNull().default('ACTIVE'), // ACTIVE | FROZEN
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  uniqueOwner: index('wallets_owner_idx').on(table.ownerId, table.ownerType),
  statusIdx: index('wallets_status_idx').on(table.status),
}));

export const transactions = pgTable('transactions', {
  id: varchar('id', { length: 191 }).primaryKey(),
  fromWalletId: varchar('from_wallet_id', { length: 191 }),
  toWalletId: varchar('to_wallet_id', { length: 191 }),
  amount: numeric('amount', { precision: 10, scale: 2 }).notNull(),
  transactionType: varchar('transaction_type', { length: 20 }).notNull(), // ALLOCATE | SPEND | TRANSFER | RECLAIM | INITIAL | EARN
  status: varchar('status', { length: 20 }).notNull().default('COMPLETED'), // PENDING | COMPLETED | FAILED
  reason: text('reason'),
  metadata: jsonb('metadata'), // messageId, agentId, tokenUsage, etc.
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  fromIdx: index('transactions_from_idx').on(table.fromWalletId),
  toIdx: index('transactions_to_idx').on(table.toWalletId),
  createdIdx: index('transactions_created_idx').on(table.createdAt),
  typeIdx: index('transactions_type_idx').on(table.transactionType),
}));

export const creditRequests = pgTable('credit_requests', {
  id: varchar('id', { length: 191 }).primaryKey(),
  agentId: varchar('agent_id', { length: 191 }).notNull(),
  userId: varchar('user_id', { length: 191 }).notNull(),
  amountRequested: numeric('amount_requested', { precision: 10, scale: 2 }).notNull(),
  status: varchar('status', { length: 20 }).notNull().default('PENDING'), // PENDING | APPROVED | REJECTED
  reason: text('reason'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  resolvedAt: timestamp('resolved_at'),
}, (table) => ({
  agentIdx: index('credit_requests_agent_idx').on(table.agentId),
  userIdx: index('credit_requests_user_idx').on(table.userId),
  statusIdx: index('credit_requests_status_idx').on(table.status),
}));

// Credit system relations
export const walletsRelations = relations(wallets, ({ many }) => ({
  transactionsFrom: many(transactions, { relationName: 'from_wallet' }),
  transactionsTo: many(transactions, { relationName: 'to_wallet' }),
}));

export const transactionsRelations = relations(transactions, ({ one }) => ({
  fromWallet: one(wallets, {
    fields: [transactions.fromWalletId],
    references: [wallets.id],
    relationName: 'from_wallet',
  }),
  toWallet: one(wallets, {
    fields: [transactions.toWalletId],
    references: [wallets.id],
    relationName: 'to_wallet',
  }),
}));

export const creditRequestsRelations = relations(creditRequests, ({ one }) => ({
  agent: one(agents, {
    fields: [creditRequests.agentId],
    references: [agents.id],
  }),
  user: one(users, {
    fields: [creditRequests.userId],
    references: [users.id],
  }),
}));
