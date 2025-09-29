CREATE TABLE "public_feed_posts" (
	"id" varchar(191) PRIMARY KEY NOT NULL,
	"author_type" varchar(32) NOT NULL,
	"author_id" varchar(191) NOT NULL,
	"text" text NOT NULL,
	"media" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "public_feed_replies" (
	"id" varchar(191) PRIMARY KEY NOT NULL,
	"post_id" varchar(191) NOT NULL,
	"author_type" varchar(32) NOT NULL,
	"author_id" varchar(191) NOT NULL,
	"text" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "room_reads" (
	"room_id" varchar(191) NOT NULL,
	"actor_id" varchar(191) NOT NULL,
	"last_read_message_id" varchar(191),
	"last_read_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "room_reads_room_id_actor_id_pk" PRIMARY KEY("room_id","actor_id")
);
--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "is_public" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "public_match_threshold" numeric(3, 2) DEFAULT '0.70';--> statement-breakpoint
CREATE INDEX "public_feed_posts_author_idx" ON "public_feed_posts" USING btree ("author_id");--> statement-breakpoint
CREATE INDEX "public_feed_posts_created_idx" ON "public_feed_posts" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "public_feed_replies_post_idx" ON "public_feed_replies" USING btree ("post_id");--> statement-breakpoint
CREATE INDEX "public_feed_replies_author_idx" ON "public_feed_replies" USING btree ("author_id");--> statement-breakpoint
CREATE INDEX "public_feed_replies_created_idx" ON "public_feed_replies" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "room_reads_updated_idx" ON "room_reads" USING btree ("updated_at");