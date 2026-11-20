-- Acuity.Search run/share persistence (whole-state JSON), embed launch replay
-- protection and Codex handoff audit. Application-level isolation by actor id.
CREATE TABLE IF NOT EXISTS "acuity_search_run_state" (
  "run_id" varchar(191) PRIMARY KEY NOT NULL,
  "actor_id" varchar(255) NOT NULL,
  "state" jsonb NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "acuity_search_run_state_actor_idx" ON "acuity_search_run_state" ("actor_id", "updated_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "acuity_search_share_state" (
  "share_id" varchar(191) PRIMARY KEY NOT NULL,
  "owner_id" varchar(255) NOT NULL,
  "token_hash" varchar(64) NOT NULL,
  "snapshot" jsonb NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "acuity_search_share_state_token_idx" ON "acuity_search_share_state" ("token_hash");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "acuity_embed_launch" (
  "jti" varchar(128) PRIMARY KEY NOT NULL,
  "expires_at" timestamp NOT NULL,
  "used_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "acuity_handoff" (
  "id" varchar(191) PRIMARY KEY NOT NULL,
  "run_id" varchar(191) NOT NULL,
  "actor_id" varchar(255) NOT NULL,
  "codex_import_id" varchar(191),
  "status" varchar(64) NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);
