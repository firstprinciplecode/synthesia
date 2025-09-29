CREATE TABLE "agents" (
	"id" varchar(191) PRIMARY KEY NOT NULL,
	"name" varchar(191) NOT NULL,
	"description" text,
	"instructions" text NOT NULL,
	"organization_id" varchar(191) NOT NULL,
	"created_by" varchar(191) NOT NULL,
	"default_model" varchar(100) DEFAULT 'gpt-4o' NOT NULL,
	"default_provider" varchar(50) DEFAULT 'openai' NOT NULL,
	"max_tokens_per_request" integer DEFAULT 4000,
	"max_tool_calls_per_run" integer DEFAULT 10,
	"max_run_time_seconds" integer DEFAULT 300,
	"is_active" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chunks" (
	"id" varchar(191) PRIMARY KEY NOT NULL,
	"file_id" varchar(191) NOT NULL,
	"organization_id" varchar(191) NOT NULL,
	"content" text NOT NULL,
	"metadata" jsonb NOT NULL,
	"embedding_id" varchar(191),
	"start_index" integer NOT NULL,
	"end_index" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" varchar(191) PRIMARY KEY NOT NULL,
	"organization_id" varchar(191) NOT NULL,
	"title" varchar(255),
	"type" varchar(50) NOT NULL,
	"participants" jsonb NOT NULL,
	"is_archived" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "files" (
	"id" varchar(191) PRIMARY KEY NOT NULL,
	"organization_id" varchar(191) NOT NULL,
	"uploaded_by" varchar(191) NOT NULL,
	"filename" varchar(255) NOT NULL,
	"original_name" varchar(255) NOT NULL,
	"mime_type" varchar(100) NOT NULL,
	"size" integer NOT NULL,
	"storage_url" text NOT NULL,
	"storage_provider" varchar(50) DEFAULT 'local' NOT NULL,
	"processing_status" varchar(50) DEFAULT 'pending' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "memberships" (
	"id" varchar(191) PRIMARY KEY NOT NULL,
	"user_id" varchar(191) NOT NULL,
	"organization_id" varchar(191) NOT NULL,
	"role" varchar(50) DEFAULT 'member' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" varchar(191) PRIMARY KEY NOT NULL,
	"conversation_id" varchar(191) NOT NULL,
	"author_id" varchar(191) NOT NULL,
	"author_type" varchar(20) NOT NULL,
	"role" varchar(20) NOT NULL,
	"content" jsonb NOT NULL,
	"run_id" varchar(191),
	"parent_message_id" varchar(191),
	"status" varchar(20) DEFAULT 'completed' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" varchar(191) PRIMARY KEY NOT NULL,
	"name" varchar(191) NOT NULL,
	"slug" varchar(191) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "organizations_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "runs" (
	"id" varchar(191) PRIMARY KEY NOT NULL,
	"conversation_id" varchar(191) NOT NULL,
	"agent_id" varchar(191) NOT NULL,
	"trigger_message_id" varchar(191) NOT NULL,
	"model" varchar(100) NOT NULL,
	"provider" varchar(50) NOT NULL,
	"status" varchar(20) DEFAULT 'queued' NOT NULL,
	"started_at" timestamp,
	"completed_at" timestamp,
	"input_tokens" integer DEFAULT 0,
	"output_tokens" integer DEFAULT 0,
	"total_cost" numeric(10, 6) DEFAULT '0.000000',
	"error" text,
	"tool_calls_count" integer DEFAULT 0,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tool_calls" (
	"id" varchar(191) PRIMARY KEY NOT NULL,
	"run_id" varchar(191) NOT NULL,
	"tool_name" varchar(100) NOT NULL,
	"function_name" varchar(100) NOT NULL,
	"arguments" jsonb NOT NULL,
	"result" jsonb,
	"error" text,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp,
	"duration_ms" integer,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tool_configs" (
	"id" varchar(191) PRIMARY KEY NOT NULL,
	"agent_id" varchar(191) NOT NULL,
	"tool_name" varchar(100) NOT NULL,
	"config" jsonb NOT NULL,
	"scopes" jsonb NOT NULL,
	"is_enabled" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" varchar(191) PRIMARY KEY NOT NULL,
	"email" varchar(191) NOT NULL,
	"name" varchar(191),
	"avatar" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE INDEX "agents_org_idx" ON "agents" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "agents_created_by_idx" ON "agents" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "chunks_file_idx" ON "chunks" USING btree ("file_id");--> statement-breakpoint
CREATE INDEX "chunks_org_idx" ON "chunks" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "chunks_embedding_idx" ON "chunks" USING btree ("embedding_id");--> statement-breakpoint
CREATE INDEX "conversations_org_idx" ON "conversations" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "conversations_type_idx" ON "conversations" USING btree ("type");--> statement-breakpoint
CREATE INDEX "files_org_idx" ON "files" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "files_uploaded_by_idx" ON "files" USING btree ("uploaded_by");--> statement-breakpoint
CREATE INDEX "files_status_idx" ON "files" USING btree ("processing_status");--> statement-breakpoint
CREATE INDEX "memberships_user_org_idx" ON "memberships" USING btree ("user_id","organization_id");--> statement-breakpoint
CREATE INDEX "messages_conversation_idx" ON "messages" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "messages_author_idx" ON "messages" USING btree ("author_id");--> statement-breakpoint
CREATE INDEX "messages_run_idx" ON "messages" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "messages_created_at_idx" ON "messages" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "organizations_slug_idx" ON "organizations" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "runs_conversation_idx" ON "runs" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "runs_agent_idx" ON "runs" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "runs_status_idx" ON "runs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "runs_created_at_idx" ON "runs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "tool_calls_run_idx" ON "tool_calls" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "tool_calls_tool_idx" ON "tool_calls" USING btree ("tool_name");--> statement-breakpoint
CREATE INDEX "tool_calls_status_idx" ON "tool_calls" USING btree ("status");--> statement-breakpoint
CREATE INDEX "tool_configs_agent_tool_idx" ON "tool_configs" USING btree ("agent_id","tool_name");--> statement-breakpoint
CREATE INDEX "users_email_idx" ON "users" USING btree ("email");