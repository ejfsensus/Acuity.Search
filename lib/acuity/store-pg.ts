/**
 * Postgres persistence for Acuity.Search runs and shares.
 *
 * The in-memory maps in store.ts remain the synchronous read path; this module
 * hydrates them once per process from Postgres and writes changes through, so
 * runs survive redeploys. Enabled when DATABASE_URL is set (and not under
 * tests) unless ACUITY_SEARCH_RUN_STORE=file.
 */
import postgres from 'postgres'

type Sql = ReturnType<typeof postgres>

let client: Sql | null = null

export function isPgStoreEnabled(
  env: Record<string, string | undefined> = process.env
): boolean {
  if (env.NODE_ENV === 'test' && env.ACUITY_SEARCH_PG_TEST !== 'true')
    return false
  if ((env.ACUITY_SEARCH_RUN_STORE || '').toLowerCase() === 'file') return false
  return Boolean(env.DATABASE_URL?.trim())
}

export function pg(): Sql {
  if (!client) {
    const url = process.env.DATABASE_URL!.trim()
    const ssl =
      process.env.DATABASE_SSL_DISABLED === 'true'
        ? false
        : process.env.NODE_ENV === 'production'
          ? { rejectUnauthorized: false }
          : false
    client = postgres(url, { ssl, prepare: false, max: 5 })
  }
  return client
}

export async function closePgForTests(): Promise<void> {
  if (client) await client.end({ timeout: 1 })
  client = null
}

export interface RunRow {
  run_id: string
  actor_id: string
  state: unknown
}

export async function loadRecentRuns(limit = 2000): Promise<RunRow[]> {
  return (await pg()`
    SELECT run_id, actor_id, state FROM acuity_search_run_state
    ORDER BY updated_at DESC LIMIT ${limit}`) as unknown as RunRow[]
}

export async function upsertRun(
  runId: string,
  actorId: string,
  state: unknown
): Promise<void> {
  await pg()`
    INSERT INTO acuity_search_run_state (run_id, actor_id, state, created_at, updated_at)
    VALUES (${runId}, ${actorId}, ${pg().json(state as never)}, now(), now())
    ON CONFLICT (run_id) DO UPDATE SET state = EXCLUDED.state, updated_at = now()`
}

export async function deleteRun(runId: string): Promise<void> {
  await pg()`DELETE FROM acuity_search_run_state WHERE run_id = ${runId}`
}

export async function loadShares(): Promise<
  Array<{ token_hash: string; snapshot: unknown }>
> {
  return (await pg()`
    SELECT token_hash, snapshot FROM acuity_search_share_state`) as unknown as Array<{
    token_hash: string
    snapshot: unknown
  }>
}

export async function upsertShare(
  shareId: string,
  ownerId: string,
  tokenHash: string,
  snapshot: unknown
): Promise<void> {
  await pg()`
    INSERT INTO acuity_search_share_state (share_id, owner_id, token_hash, snapshot, created_at)
    VALUES (${shareId}, ${ownerId}, ${tokenHash}, ${pg().json(snapshot as never)}, now())
    ON CONFLICT (share_id) DO UPDATE SET snapshot = EXCLUDED.snapshot`
}

/** Records a launch-token id; returns false if it was already used (replay). */
export async function claimLaunchJti(
  jti: string,
  expiresAt: Date
): Promise<boolean> {
  const rows = await pg()`
    INSERT INTO acuity_embed_launch (jti, expires_at) VALUES (${jti}, ${expiresAt})
    ON CONFLICT (jti) DO NOTHING RETURNING jti`
  await pg()`DELETE FROM acuity_embed_launch WHERE expires_at < now() - interval '1 day'`
  return rows.length === 1
}

export async function recordHandoff(row: {
  id: string
  runId: string
  actorId: string
  codexImportId: string | null
  status: string
}): Promise<void> {
  await pg()`
    INSERT INTO acuity_handoff (id, run_id, actor_id, codex_import_id, status, created_at)
    VALUES (${row.id}, ${row.runId}, ${row.actorId}, ${row.codexImportId}, ${row.status}, now())
    ON CONFLICT (id) DO UPDATE SET codex_import_id = EXCLUDED.codex_import_id, status = EXCLUDED.status`
}
