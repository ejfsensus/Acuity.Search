/**
 * Postgres run-store integration test. Runs only when ACUITY_SEARCH_PG_TEST_URL
 * points at a disposable database with drizzle migrations applied
 * (DATABASE_URL=... bun run migrate).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import type { SearchRunState } from '@/lib/acuity/search/contracts'

const url = process.env.ACUITY_SEARCH_PG_TEST_URL

describe.skipIf(!url)('Postgres run store', () => {
  beforeAll(() => {
    vi.stubEnv('DATABASE_URL', url!)
    vi.stubEnv('ACUITY_SEARCH_PG_TEST', 'true')
  })
  afterAll(async () => {
    const { closePgForTests, pg } = await import('../store-pg')
    await pg()`DELETE FROM acuity_search_run_state WHERE run_id LIKE 'pgtest-%'`
    await pg()`DELETE FROM acuity_embed_launch WHERE jti LIKE 'pgtest-%'`
    await closePgForTests()
    vi.unstubAllEnvs()
  })

  it('writes runs through and rehydrates them after a restart', async () => {
    const store = await import('../store')
    const runId = `pgtest-${Date.now()}`
    store.saveSearchRun({
      runId,
      userId: 'codex:u1',
      isGuest: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      status: 'completed',
      results: [],
      evidence: [],
      answers: []
    } as unknown as SearchRunState)
    await store.flushPendingStoreWrites()

    store.clearAcuityStoreForTests() // simulate a fresh process
    expect(store.getSearchRunForActor(runId, 'codex:u1')).toBeNull()
    await store.ensureStoreReady()
    expect(store.getSearchRunForActor(runId, 'codex:u1')?.runId).toBe(runId)
    // ownership isolation survives persistence
    expect(store.getSearchRunForActor(runId, 'codex:other')).toBeNull()

    store.deleteSearchRunForActor(runId, 'codex:u1')
    await store.flushPendingStoreWrites()
    store.clearAcuityStoreForTests()
    await store.ensureStoreReady()
    expect(store.getSearchRunForActor(runId, 'codex:u1')).toBeNull()
  })

  it('claims a launch jti exactly once', async () => {
    const { claimLaunchJti } = await import('../store-pg')
    const jti = `pgtest-${Math.random()}`
    const exp = new Date(Date.now() + 60_000)
    expect(await claimLaunchJti(jti, exp)).toBe(true)
    expect(await claimLaunchJti(jti, exp)).toBe(false)
  })
})
