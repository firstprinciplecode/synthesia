CREATE TABLE "agent_contacts" (
	"id" varchar(191) PRIMARY KEY NOT NULL,
	"agent_id" varchar(191) NOT NULL,
	"name" varchar(191) NOT NULL,
	"email" varchar(191),
	"relationship" varchar(50),
	"context" text,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_preferences" (
	"id" varchar(191) PRIMARY KEY NOT NULL,
	"agent_id" varchar(191) NOT NULL,
	"communication_style" varchar(50),
	"technical_level" varchar(50),
	"response_length" varchar(50),
	"topics" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "agent_preferences_agent_id_unique" UNIQUE("agent_id")
);
--> statement-breakpoint
CREATE TABLE "agent_profiles" (
	"id" varchar(191) PRIMARY KEY NOT NULL,
	"agent_id" varchar(191) NOT NULL,
	"name" varchar(191),
	"email" varchar(191),
	"birthday" timestamp,
	"interests" jsonb,
	"timezone" varchar(50),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "agent_profiles_agent_id_unique" UNIQUE("agent_id")
);
--> statement-breakpoint
CREATE TABLE "agent_projects" (
	"id" varchar(191) PRIMARY KEY NOT NULL,
	"agent_id" varchar(191) NOT NULL,
	"name" varchar(191) NOT NULL,
	"description" text,
	"config" jsonb,
	"status" varchar(50) DEFAULT 'active' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversation_summaries" (
	"id" varchar(191) PRIMARY KEY NOT NULL,
	"agent_id" varchar(191) NOT NULL,
	"conversation_id" varchar(191) NOT NULL,
	"summary" text NOT NULL,
	"key_points" jsonb NOT NULL,
	"decisions" jsonb NOT NULL,
	"next_steps" jsonb NOT NULL,
	"level" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "agent_contacts_agent_idx" ON "agent_contacts" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "agent_contacts_name_idx" ON "agent_contacts" USING btree ("name");--> statement-breakpoint
CREATE INDEX "agent_preferences_agent_idx" ON "agent_preferences" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "agent_profiles_agent_idx" ON "agent_profiles" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "agent_projects_agent_idx" ON "agent_projects" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "agent_projects_status_idx" ON "agent_projects" USING btree ("status");--> statement-breakpoint
CREATE INDEX "conversation_summaries_agent_idx" ON "conversation_summaries" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "conversation_summaries_conversation_idx" ON "conversation_summaries" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "conversation_summaries_level_idx" ON "conversation_summaries" USING btree ("level");--> statement-breakpoint
CREATE INDEX "conversation_summaries_created_at_idx" ON "conversation_summaries" USING btree ("created_at");