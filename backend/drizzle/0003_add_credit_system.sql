-- Credit System Tables

-- Wallets table
CREATE TABLE IF NOT EXISTS "wallets" (
  "id" varchar(191) PRIMARY KEY NOT NULL,
  "owner_id" varchar(191) NOT NULL,
  "owner_type" varchar(20) NOT NULL,
  "balance" numeric(10, 2) DEFAULT '0.00' NOT NULL,
  "lifetime_earned" numeric(12, 2) DEFAULT '0.00' NOT NULL,
  "lifetime_spent" numeric(12, 2) DEFAULT '0.00' NOT NULL,
  "status" varchar(20) DEFAULT 'ACTIVE' NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "wallets_owner_idx" ON "wallets" ("owner_id", "owner_type");
CREATE INDEX IF NOT EXISTS "wallets_status_idx" ON "wallets" ("status");

-- Transactions table
CREATE TABLE IF NOT EXISTS "transactions" (
  "id" varchar(191) PRIMARY KEY NOT NULL,
  "from_wallet_id" varchar(191),
  "to_wallet_id" varchar(191),
  "amount" numeric(10, 2) NOT NULL,
  "transaction_type" varchar(20) NOT NULL,
  "status" varchar(20) DEFAULT 'COMPLETED' NOT NULL,
  "reason" text,
  "metadata" jsonb,
  "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "transactions_from_idx" ON "transactions" ("from_wallet_id");
CREATE INDEX IF NOT EXISTS "transactions_to_idx" ON "transactions" ("to_wallet_id");
CREATE INDEX IF NOT EXISTS "transactions_created_idx" ON "transactions" ("created_at");
CREATE INDEX IF NOT EXISTS "transactions_type_idx" ON "transactions" ("transaction_type");

-- Credit Requests table
CREATE TABLE IF NOT EXISTS "credit_requests" (
  "id" varchar(191) PRIMARY KEY NOT NULL,
  "agent_id" varchar(191) NOT NULL,
  "user_id" varchar(191) NOT NULL,
  "amount_requested" numeric(10, 2) NOT NULL,
  "status" varchar(20) DEFAULT 'PENDING' NOT NULL,
  "reason" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "resolved_at" timestamp
);

CREATE INDEX IF NOT EXISTS "credit_requests_agent_idx" ON "credit_requests" ("agent_id");
CREATE INDEX IF NOT EXISTS "credit_requests_user_idx" ON "credit_requests" ("user_id");
CREATE INDEX IF NOT EXISTS "credit_requests_status_idx" ON "credit_requests" ("status");

