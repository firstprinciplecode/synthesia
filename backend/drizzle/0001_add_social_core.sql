CREATE TABLE "actors" (
	"id" varchar(191) PRIMARY KEY NOT NULL,
	"type" varchar(20) NOT NULL,
	"handle" varchar(191),
	"display_name" varchar(255),
	"avatar_url" text,
	"owner_user_id" varchar(191),
	"org_id" varchar(191),
	"capability_tags" jsonb,
	"settings" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "actors_handle_unique" UNIQUE("handle")
);
--> statement-breakpoint
CREATE TABLE "feed_items" (
	"id" varchar(191) PRIMARY KEY NOT NULL,
	"actor_id" varchar(191) NOT NULL,
	"reply_to_id" varchar(191),
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "policies" (
	"id" varchar(191) PRIMARY KEY NOT NULL,
	"scope" varchar(20) NOT NULL,
	"scope_id" varchar(191) NOT NULL,
	"require_approval" varchar(10) DEFAULT 'ask' NOT NULL,
	"tool_limits" jsonb,
	"auto_reply_threshold" numeric(3, 2) DEFAULT '0.70',
	"safety" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "relationships" (
	"id" varchar(191) PRIMARY KEY NOT NULL,
	"from_actor_id" varchar(191) NOT NULL,
	"to_actor_id" varchar(191) NOT NULL,
	"kind" varchar(20) NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "room_members" (
	"id" varchar(191) PRIMARY KEY NOT NULL,
	"room_id" varchar(191) NOT NULL,
	"actor_id" varchar(191) NOT NULL,
	"role" varchar(20) DEFAULT 'member' NOT NULL,
	"joins_at" timestamp DEFAULT now() NOT NULL,
	"leaves_at" timestamp,
	"settings" jsonb
);
--> statement-breakpoint
CREATE TABLE "rooms" (
	"id" varchar(191) PRIMARY KEY NOT NULL,
	"kind" varchar(20) NOT NULL,
	"title" varchar(255),
	"slug" varchar(191),
	"created_by_actor_id" varchar(191) NOT NULL,
	"org_id" varchar(191),
	"is_public" boolean DEFAULT false,
	"policy_id" varchar(191),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "actors_type_idx" ON "actors" USING btree ("type");--> statement-breakpoint
CREATE INDEX "actors_owner_idx" ON "actors" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX "actors_org_idx" ON "actors" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "feed_items_created_idx" ON "feed_items" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "feed_items_actor_idx" ON "feed_items" USING btree ("actor_id","created_at");--> statement-breakpoint
CREATE INDEX "feed_items_reply_idx" ON "feed_items" USING btree ("reply_to_id");--> statement-breakpoint
CREATE INDEX "policies_scope_idx" ON "policies" USING btree ("scope","scope_id");--> statement-breakpoint
CREATE INDEX "relationships_unique_edge_idx" ON "relationships" USING btree ("from_actor_id","to_actor_id","kind");--> statement-breakpoint
CREATE INDEX "relationships_to_idx" ON "relationships" USING btree ("to_actor_id","kind");--> statement-breakpoint
CREATE INDEX "relationships_from_idx" ON "relationships" USING btree ("from_actor_id","kind");--> statement-breakpoint
CREATE INDEX "room_members_room_actor_idx" ON "room_members" USING btree ("room_id","actor_id");--> statement-breakpoint
CREATE INDEX "room_members_actor_idx" ON "room_members" USING btree ("actor_id");--> statement-breakpoint
CREATE INDEX "room_members_room_idx" ON "room_members" USING btree ("room_id");--> statement-breakpoint
CREATE INDEX "rooms_kind_idx" ON "rooms" USING btree ("kind");--> statement-breakpoint
CREATE INDEX "rooms_slug_idx" ON "rooms" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "rooms_org_idx" ON "rooms" USING btree ("org_id");