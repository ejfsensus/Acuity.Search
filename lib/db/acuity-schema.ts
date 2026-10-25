import { createId } from '@paralleldrive/cuid2'
import { type InferSelectModel, sql } from 'drizzle-orm'
import {
  index,
  integer,
  jsonb,
  pgPolicy,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  varchar
} from 'drizzle-orm/pg-core'

const ID_LENGTH = 191
const USER_ID_LENGTH = 255
const VARCHAR_LENGTH = 256

export const acuityRuns = pgTable(
  'acuity_runs',
  {
    id: varchar('id', { length: ID_LENGTH })
      .primaryKey()
      .$defaultFn(() => createId()),
    userId: varchar('user_id', { length: USER_ID_LENGTH }).notNull(),
    query: text('query').notNull(),
    mode: varchar('mode', {
      length: VARCHAR_LENGTH,
      enum: ['general', 'literature', 'collections']
    }).notNull(),
    depth: varchar('depth', {
      length: VARCHAR_LENGTH,
      enum: ['quick', 'research']
    }).notNull(),
    status: varchar('status', {
      length: VARCHAR_LENGTH,
      enum: ['running', 'completed', 'partial', 'cancelled', 'failed']
    }).notNull(),
    requestJson: jsonb('request_json').notNull(),
    scopeJson: jsonb('scope_json').notNull(),
    planJson: jsonb('plan_json').notNull(),
    budgetJson: jsonb('budget_json').notNull(),
    coverageJson: jsonb('coverage_json').notNull(),
    nextContinuationCursor: integer('next_continuation_cursor')
      .notNull()
      .default(0),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow()
  },
  table => [
    index('acuity_runs_user_created_idx').on(table.userId, table.createdAt),
    pgPolicy('users_manage_own_acuity_runs', {
      as: 'permissive',
      for: 'all',
      to: 'public',
      using: sql`user_id = (select current_setting('app.current_user_id', true))`,
      withCheck: sql`user_id = (select current_setting('app.current_user_id', true))`
    })
  ]
).enableRLS()

export type AcuityRunRow = InferSelectModel<typeof acuityRuns>

export const acuityProviderAttempts = pgTable(
  'acuity_provider_attempts',
  {
    id: varchar('id', { length: ID_LENGTH })
      .primaryKey()
      .$defaultFn(() => createId()),
    runId: varchar('run_id', { length: ID_LENGTH })
      .notNull()
      .references(() => acuityRuns.id, { onDelete: 'cascade' }),
    userId: varchar('user_id', { length: USER_ID_LENGTH }).notNull(),
    provider: varchar('provider', { length: 64 }).notNull(),
    variantId: varchar('variant_id', { length: 128 }).notNull(),
    executedQuery: text('executed_query').notNull(),
    status: varchar('status', { length: 64 }).notNull(),
    httpStatus: integer('http_status'),
    latencyMs: integer('latency_ms').notNull().default(0),
    rawResultCount: integer('raw_result_count').notNull().default(0),
    acceptedResultCount: integer('accepted_result_count').notNull().default(0),
    filteredOutCount: integer('filtered_out_count').notNull().default(0),
    detailsJson: jsonb('details_json').notNull(),
    createdAt: timestamp('created_at').notNull().defaultNow()
  },
  table => [
    index('acuity_provider_attempts_run_idx').on(table.runId),
    pgPolicy('users_manage_own_acuity_provider_attempts', {
      as: 'permissive',
      for: 'all',
      to: 'public',
      using: sql`user_id = (select current_setting('app.current_user_id', true))`,
      withCheck: sql`user_id = (select current_setting('app.current_user_id', true))`
    })
  ]
).enableRLS()

export const acuitySourceResults = pgTable(
  'acuity_source_results',
  {
    id: varchar('id', { length: ID_LENGTH })
      .primaryKey()
      .$defaultFn(() => createId()),
    runId: varchar('run_id', { length: ID_LENGTH })
      .notNull()
      .references(() => acuityRuns.id, { onDelete: 'cascade' }),
    userId: varchar('user_id', { length: USER_ID_LENGTH }).notNull(),
    citationLabel: varchar('citation_label', { length: 32 }).notNull(),
    url: text('url').notNull(),
    normalizedUrl: text('normalized_url').notNull(),
    title: text('title').notNull(),
    snippet: text('snippet').notNull(),
    hostname: varchar('hostname', { length: 255 }).notNull(),
    contentState: varchar('content_state', { length: 64 }).notNull(),
    accessStatus: varchar('access_status', { length: 64 }).notNull(),
    sourceJson: jsonb('source_json').notNull(),
    createdAt: timestamp('created_at').notNull().defaultNow()
  },
  table => [
    index('acuity_source_results_run_idx').on(table.runId),
    pgPolicy('users_manage_own_acuity_source_results', {
      as: 'permissive',
      for: 'all',
      to: 'public',
      using: sql`user_id = (select current_setting('app.current_user_id', true))`,
      withCheck: sql`user_id = (select current_setting('app.current_user_id', true))`
    })
  ]
).enableRLS()

export const acuityEvidence = pgTable(
  'acuity_evidence',
  {
    id: varchar('id', { length: ID_LENGTH })
      .primaryKey()
      .$defaultFn(() => createId()),
    runId: varchar('run_id', { length: ID_LENGTH })
      .notNull()
      .references(() => acuityRuns.id, { onDelete: 'cascade' }),
    userId: varchar('user_id', { length: USER_ID_LENGTH }).notNull(),
    sourceId: varchar('source_id', { length: ID_LENGTH }).notNull(),
    citationLabel: varchar('citation_label', { length: 32 }).notNull(),
    sourceUrl: text('source_url').notNull(),
    verbatimText: text('verbatim_text').notNull(),
    sha256: varchar('sha256', { length: 64 }).notNull(),
    contentState: varchar('content_state', { length: 64 }).notNull(),
    locatorJson: jsonb('locator_json').notNull(),
    extractedAt: timestamp('extracted_at').notNull().defaultNow()
  },
  table => [
    index('acuity_evidence_run_idx').on(table.runId),
    pgPolicy('users_manage_own_acuity_evidence', {
      as: 'permissive',
      for: 'all',
      to: 'public',
      using: sql`user_id = (select current_setting('app.current_user_id', true))`,
      withCheck: sql`user_id = (select current_setting('app.current_user_id', true))`
    })
  ]
).enableRLS()

export const acuityAnswerVersions = pgTable(
  'acuity_answer_versions',
  {
    id: varchar('id', { length: ID_LENGTH })
      .primaryKey()
      .$defaultFn(() => createId()),
    runId: varchar('run_id', { length: ID_LENGTH })
      .notNull()
      .references(() => acuityRuns.id, { onDelete: 'cascade' }),
    userId: varchar('user_id', { length: USER_ID_LENGTH }).notNull(),
    versionNumber: integer('version_number').notNull(),
    modelId: varchar('model_id', { length: 191 }),
    mode: varchar('mode', { length: 64 }).notNull(),
    markdown: text('markdown').notNull(),
    citationsJson: jsonb('citations_json').notNull(),
    createdAt: timestamp('created_at').notNull().defaultNow()
  },
  table => [
    index('acuity_answer_versions_run_idx').on(table.runId),
    pgPolicy('users_manage_own_acuity_answer_versions', {
      as: 'permissive',
      for: 'all',
      to: 'public',
      using: sql`user_id = (select current_setting('app.current_user_id', true))`,
      withCheck: sql`user_id = (select current_setting('app.current_user_id', true))`
    })
  ]
).enableRLS()

export const acuitySavedResearch = pgTable(
  'acuity_saved_research',
  {
    id: varchar('id', { length: ID_LENGTH })
      .primaryKey()
      .$defaultFn(() => createId()),
    userId: varchar('user_id', { length: USER_ID_LENGTH }).notNull(),
    runId: varchar('run_id', { length: ID_LENGTH })
      .notNull()
      .references(() => acuityRuns.id, { onDelete: 'cascade' }),
    title: varchar('title', { length: 256 }).notNull(),
    notes: text('notes'),
    tagsJson: jsonb('tags_json').notNull().default([]),
    createdAt: timestamp('created_at').notNull().defaultNow()
  },
  table => [
    index('acuity_saved_research_user_idx').on(table.userId, table.createdAt),
    pgPolicy('users_manage_own_acuity_saved_research', {
      as: 'permissive',
      for: 'all',
      to: 'public',
      using: sql`user_id = (select current_setting('app.current_user_id', true))`,
      withCheck: sql`user_id = (select current_setting('app.current_user_id', true))`
    })
  ]
).enableRLS()

export const acuityShares = pgTable(
  'acuity_shares',
  {
    id: varchar('id', { length: ID_LENGTH })
      .primaryKey()
      .$defaultFn(() => createId()),
    ownerId: varchar('owner_id', { length: USER_ID_LENGTH }).notNull(),
    runId: varchar('run_id', { length: ID_LENGTH }).notNull(),
    tokenHash: varchar('token_hash', { length: 64 }).notNull(),
    title: varchar('title', { length: 256 }).notNull(),
    snapshotJson: jsonb('snapshot_json').notNull(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    expiresAt: timestamp('expires_at'),
    revokedAt: timestamp('revoked_at')
  },
  table => [
    uniqueIndex('acuity_shares_token_hash_idx').on(table.tokenHash),
    index('acuity_shares_owner_idx').on(table.ownerId, table.createdAt),
    pgPolicy('owners_manage_own_acuity_shares', {
      as: 'permissive',
      for: 'all',
      to: 'public',
      using: sql`owner_id = (select current_setting('app.current_user_id', true))`,
      withCheck: sql`owner_id = (select current_setting('app.current_user_id', true))`
    })
  ]
).enableRLS()

export const acuityRegistryRevisions = pgTable('acuity_registry_revisions', {
  id: varchar('id', { length: ID_LENGTH })
    .primaryKey()
    .$defaultFn(() => createId()),
  schemaVersion: varchar('schema_version', { length: 64 }).notNull(),
  curationState: varchar('curation_state', { length: 64 }).notNull(),
  summaryJson: jsonb('summary_json').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow()
})

export const acuityUsageReservations = pgTable(
  'acuity_usage_reservations',
  {
    id: varchar('id', { length: ID_LENGTH })
      .primaryKey()
      .$defaultFn(() => createId()),
    userId: varchar('user_id', { length: USER_ID_LENGTH }).notNull(),
    runId: varchar('run_id', { length: ID_LENGTH }).notNull(),
    reservedRequests: integer('reserved_requests').notNull(),
    settledRequests: integer('settled_requests'),
    status: varchar('status', {
      length: 64,
      enum: ['reserved', 'settled', 'released']
    }).notNull(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow()
  },
  table => [
    index('acuity_usage_reservations_user_idx').on(
      table.userId,
      table.createdAt
    ),
    pgPolicy('users_manage_own_acuity_usage_reservations', {
      as: 'permissive',
      for: 'all',
      to: 'public',
      using: sql`user_id = (select current_setting('app.current_user_id', true))`,
      withCheck: sql`user_id = (select current_setting('app.current_user_id', true))`
    })
  ]
).enableRLS()
