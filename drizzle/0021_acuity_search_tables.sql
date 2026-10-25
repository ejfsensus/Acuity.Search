-- Acuity.Search Persistence & Multi-User Isolation Migration
-- Adds runs, provider attempts, source results, evidence ledger, answer versions,
-- saved research, unlisted selected-output shares, registry revisions, and usage reservations.

CREATE TABLE IF NOT EXISTS "acuity_runs" (
  "id" varchar(191) PRIMARY KEY NOT NULL,
  "user_id" varchar(255) NOT NULL,
  "query" text NOT NULL,
  "mode" varchar(256) NOT NULL,
  "depth" varchar(256) NOT NULL,
  "status" varchar(256) NOT NULL,
  "request_json" jsonb NOT NULL,
  "scope_json" jsonb NOT NULL,
  "plan_json" jsonb NOT NULL,
  "budget_json" jsonb NOT NULL,
  "coverage_json" jsonb NOT NULL,
  "next_continuation_cursor" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

ALTER TABLE "acuity_runs" ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS "acuity_runs_user_created_idx" ON "acuity_runs" ("user_id", "created_at");

CREATE POLICY "users_manage_own_acuity_runs" ON "acuity_runs"
  AS PERMISSIVE FOR ALL TO public
  USING (user_id = (select current_setting('app.current_user_id', true)))
  WITH CHECK (user_id = (select current_setting('app.current_user_id', true)));

CREATE TABLE IF NOT EXISTS "acuity_provider_attempts" (
  "id" varchar(191) PRIMARY KEY NOT NULL,
  "run_id" varchar(191) NOT NULL REFERENCES "acuity_runs"("id") ON DELETE CASCADE,
  "user_id" varchar(255) NOT NULL,
  "provider" varchar(64) NOT NULL,
  "variant_id" varchar(128) NOT NULL,
  "executed_query" text NOT NULL,
  "status" varchar(64) NOT NULL,
  "http_status" integer,
  "latency_ms" integer DEFAULT 0 NOT NULL,
  "raw_result_count" integer DEFAULT 0 NOT NULL,
  "accepted_result_count" integer DEFAULT 0 NOT NULL,
  "filtered_out_count" integer DEFAULT 0 NOT NULL,
  "details_json" jsonb NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);

ALTER TABLE "acuity_provider_attempts" ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS "acuity_provider_attempts_run_idx" ON "acuity_provider_attempts" ("run_id");

CREATE POLICY "users_manage_own_acuity_provider_attempts" ON "acuity_provider_attempts"
  AS PERMISSIVE FOR ALL TO public
  USING (user_id = (select current_setting('app.current_user_id', true)))
  WITH CHECK (user_id = (select current_setting('app.current_user_id', true)));

CREATE TABLE IF NOT EXISTS "acuity_source_results" (
  "id" varchar(191) PRIMARY KEY NOT NULL,
  "run_id" varchar(191) NOT NULL REFERENCES "acuity_runs"("id") ON DELETE CASCADE,
  "user_id" varchar(255) NOT NULL,
  "citation_label" varchar(32) NOT NULL,
  "url" text NOT NULL,
  "normalized_url" text NOT NULL,
  "title" text NOT NULL,
  "snippet" text NOT NULL,
  "hostname" varchar(255) NOT NULL,
  "content_state" varchar(64) NOT NULL,
  "access_status" varchar(64) NOT NULL,
  "source_json" jsonb NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);

ALTER TABLE "acuity_source_results" ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS "acuity_source_results_run_idx" ON "acuity_source_results" ("run_id");

CREATE POLICY "users_manage_own_acuity_source_results" ON "acuity_source_results"
  AS PERMISSIVE FOR ALL TO public
  USING (user_id = (select current_setting('app.current_user_id', true)))
  WITH CHECK (user_id = (select current_setting('app.current_user_id', true)));

CREATE TABLE IF NOT EXISTS "acuity_evidence" (
  "id" varchar(191) PRIMARY KEY NOT NULL,
  "run_id" varchar(191) NOT NULL REFERENCES "acuity_runs"("id") ON DELETE CASCADE,
  "user_id" varchar(255) NOT NULL,
  "source_id" varchar(191) NOT NULL,
  "citation_label" varchar(32) NOT NULL,
  "source_url" text NOT NULL,
  "verbatim_text" text NOT NULL,
  "sha256" varchar(64) NOT NULL,
  "content_state" varchar(64) NOT NULL,
  "locator_json" jsonb NOT NULL,
  "extracted_at" timestamp DEFAULT now() NOT NULL
);

ALTER TABLE "acuity_evidence" ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS "acuity_evidence_run_idx" ON "acuity_evidence" ("run_id");

CREATE POLICY "users_manage_own_acuity_evidence" ON "acuity_evidence"
  AS PERMISSIVE FOR ALL TO public
  USING (user_id = (select current_setting('app.current_user_id', true)))
  WITH CHECK (user_id = (select current_setting('app.current_user_id', true)));

CREATE TABLE IF NOT EXISTS "acuity_answer_versions" (
  "id" varchar(191) PRIMARY KEY NOT NULL,
  "run_id" varchar(191) NOT NULL REFERENCES "acuity_runs"("id") ON DELETE CASCADE,
  "user_id" varchar(255) NOT NULL,
  "version_number" integer NOT NULL,
  "model_id" varchar(191),
  "mode" varchar(64) NOT NULL,
  "markdown" text NOT NULL,
  "citations_json" jsonb NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);

ALTER TABLE "acuity_answer_versions" ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS "acuity_answer_versions_run_idx" ON "acuity_answer_versions" ("run_id");

CREATE POLICY "users_manage_own_acuity_answer_versions" ON "acuity_answer_versions"
  AS PERMISSIVE FOR ALL TO public
  USING (user_id = (select current_setting('app.current_user_id', true)))
  WITH CHECK (user_id = (select current_setting('app.current_user_id', true)));

CREATE TABLE IF NOT EXISTS "acuity_saved_research" (
  "id" varchar(191) PRIMARY KEY NOT NULL,
  "user_id" varchar(255) NOT NULL,
  "run_id" varchar(191) NOT NULL REFERENCES "acuity_runs"("id") ON DELETE CASCADE,
  "title" varchar(256) NOT NULL,
  "notes" text,
  "tags_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);

ALTER TABLE "acuity_saved_research" ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS "acuity_saved_research_user_idx" ON "acuity_saved_research" ("user_id", "created_at");

CREATE POLICY "users_manage_own_acuity_saved_research" ON "acuity_saved_research"
  AS PERMISSIVE FOR ALL TO public
  USING (user_id = (select current_setting('app.current_user_id', true)))
  WITH CHECK (user_id = (select current_setting('app.current_user_id', true)));

CREATE TABLE IF NOT EXISTS "acuity_shares" (
  "id" varchar(191) PRIMARY KEY NOT NULL,
  "owner_id" varchar(255) NOT NULL,
  "run_id" varchar(191) NOT NULL,
  "token_hash" varchar(64) NOT NULL,
  "title" varchar(256) NOT NULL,
  "snapshot_json" jsonb NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "expires_at" timestamp,
  "revoked_at" timestamp
);

ALTER TABLE "acuity_shares" ENABLE ROW LEVEL SECURITY;

CREATE UNIQUE INDEX IF NOT EXISTS "acuity_shares_token_hash_idx" ON "acuity_shares" ("token_hash");
CREATE INDEX IF NOT EXISTS "acuity_shares_owner_idx" ON "acuity_shares" ("owner_id", "created_at");

CREATE POLICY "owners_manage_own_acuity_shares" ON "acuity_shares"
  AS PERMISSIVE FOR ALL TO public
  USING (owner_id = (select current_setting('app.current_user_id', true)))
  WITH CHECK (owner_id = (select current_setting('app.current_user_id', true)));

CREATE TABLE IF NOT EXISTS "acuity_registry_revisions" (
  "id" varchar(191) PRIMARY KEY NOT NULL,
  "schema_version" varchar(64) NOT NULL,
  "curation_state" varchar(64) NOT NULL,
  "summary_json" jsonb NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "acuity_usage_reservations" (
  "id" varchar(191) PRIMARY KEY NOT NULL,
  "user_id" varchar(255) NOT NULL,
  "run_id" varchar(191) NOT NULL,
  "reserved_requests" integer NOT NULL,
  "settled_requests" integer,
  "status" varchar(64) NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

ALTER TABLE "acuity_usage_reservations" ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS "acuity_usage_reservations_user_idx" ON "acuity_usage_reservations" ("user_id", "created_at");

CREATE POLICY "users_manage_own_acuity_usage_reservations" ON "acuity_usage_reservations"
  AS PERMISSIVE FOR ALL TO public
  USING (user_id = (select current_setting('app.current_user_id', true)))
  WITH CHECK (user_id = (select current_setting('app.current_user_id', true)));
