import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

import type {
  CreateShareRequest,
  SearchRunState,
  ShareSnapshot
} from '@/lib/acuity/search/contracts'
import {
  deleteRun as pgDeleteRun,
  isPgStoreEnabled,
  loadRecentRuns,
  loadShares,
  upsertRun,
  upsertShare
} from '@/lib/acuity/store-pg'

interface StoredShareRecord {
  tokenHash: string
  snapshot: ShareSnapshot
}

interface PersistedAcuityStore {
  version: number
  updatedAt: string
  runs: SearchRunState[]
  shares: StoredShareRecord[]
}

const runsById = new Map<string, SearchRunState>()
const activeRunAbortControllers = new Map<string, AbortController>()
const sharesById = new Map<string, StoredShareRecord>()
const sharesByTokenHash = new Map<string, StoredShareRecord>()

let diskStoreInitialized = false
let pgHydration: Promise<void> | null = null

const pendingPgWrites = new Set<Promise<void>>()

function persistInBackground(task: () => Promise<void>, label: string): void {
  if (!isPgStoreEnabled()) return
  const write = task()
    .catch(error =>
      console.warn(`[acuity-search] Postgres ${label} failed:`, error)
    )
    .finally(() => pendingPgWrites.delete(write))
  pendingPgWrites.add(write)
}

/** Waits for queued Postgres write-throughs (graceful shutdown and tests). */
export async function flushPendingStoreWrites(): Promise<void> {
  await Promise.all([...pendingPgWrites])
}

/**
 * Loads runs and shares from Postgres once per process (no-op without
 * DATABASE_URL). Await this at the start of any route that reads the store.
 */
export async function ensureStoreReady(): Promise<void> {
  if (!isPgStoreEnabled()) {
    ensureDiskStoreLoaded()
    return
  }
  if (!pgHydration) {
    pgHydration = (async () => {
      const [runs, shares] = await Promise.all([loadRecentRuns(), loadShares()])
      for (const row of runs) {
        const run = row.state as SearchRunState
        if (run?.runId && !runsById.has(run.runId)) runsById.set(run.runId, run)
      }
      for (const row of shares) {
        const snapshot = row.snapshot as ShareSnapshot
        if (snapshot?.id) {
          const record = { tokenHash: row.token_hash, snapshot }
          sharesById.set(snapshot.id, record)
          sharesByTokenHash.set(row.token_hash, record)
        }
      }
      diskStoreInitialized = true
    })().catch(error => {
      pgHydration = null
      throw error
    })
  }
  await pgHydration
}

function isDiskPersistenceEnabled(): boolean {
  return process.env.NODE_ENV !== 'test'
}

function getStoreFilePath(): string {
  const customPath = process.env.ACUITY_SEARCH_LOCAL_STORE_PATH?.trim()
  if (customPath) {
    return path.resolve(process.cwd(), customPath)
  }
  return path.resolve(process.cwd(), '_local', 'acuity-search-store.json')
}

function ensureDiskStoreLoaded(): void {
  if (
    diskStoreInitialized ||
    !isDiskPersistenceEnabled() ||
    isPgStoreEnabled()
  ) {
    return
  }
  diskStoreInitialized = true

  try {
    const filePath = getStoreFilePath()
    if (!fs.existsSync(filePath)) {
      const dir = path.dirname(filePath)
      fs.mkdirSync(dir, { recursive: true })
      const initialPayload: PersistedAcuityStore = {
        version: 1,
        updatedAt: new Date().toISOString(),
        runs: [],
        shares: []
      }
      fs.writeFileSync(
        filePath,
        JSON.stringify(initialPayload, null, 2),
        'utf8'
      )
      return
    }

    const raw = fs.readFileSync(filePath, 'utf8')
    const parsed = JSON.parse(raw) as Partial<PersistedAcuityStore>
    if (Array.isArray(parsed.runs)) {
      for (const run of parsed.runs) {
        if (run && typeof run.runId === 'string') {
          runsById.set(run.runId, run)
        }
      }
    }
    if (Array.isArray(parsed.shares)) {
      for (const rec of parsed.shares) {
        if (rec?.snapshot?.id && rec?.tokenHash) {
          sharesById.set(rec.snapshot.id, rec)
          sharesByTokenHash.set(rec.tokenHash, rec)
        }
      }
    }
  } catch (error) {
    console.warn('Failed to load local Acuity store:', error)
  }
}

function flushStoreToDisk(): void {
  if (!isDiskPersistenceEnabled() || isPgStoreEnabled()) {
    return
  }
  try {
    const filePath = getStoreFilePath()
    const dir = path.dirname(filePath)
    fs.mkdirSync(dir, { recursive: true })

    // Keep most recent 200 runs on disk to bound file size
    const sortedRuns = Array.from(runsById.values())
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
      .slice(0, 200)

    const payload: PersistedAcuityStore = {
      version: 1,
      updatedAt: new Date().toISOString(),
      runs: sortedRuns,
      shares: Array.from(sharesById.values())
    }
    const tmpPath = `${filePath}.tmp`
    fs.writeFileSync(tmpPath, JSON.stringify(payload, null, 2), 'utf8')
    fs.renameSync(tmpPath, filePath)
  } catch (error) {
    console.warn('Failed to persist local Acuity store:', error)
  }
}

export function hashShareToken(rawToken: string): string {
  return crypto
    .createHash('sha256')
    .update(`acuity-share:${rawToken}`, 'utf8')
    .digest('hex')
}

export function registerRunAbortController(
  runId: string,
  controller: AbortController
): void {
  activeRunAbortControllers.set(runId, controller)
}

export function unregisterRunAbortController(runId: string): void {
  activeRunAbortControllers.delete(runId)
}

export function saveSearchRun(run: SearchRunState): void {
  ensureDiskStoreLoaded()
  runsById.set(run.runId, structuredClone(run))
  flushStoreToDisk()
  const copy = structuredClone(run)
  persistInBackground(
    () => upsertRun(copy.runId, copy.userId, copy),
    'save run'
  )
}

export function getSearchRunForActor(
  runId: string,
  actorId: string
): SearchRunState | null {
  ensureDiskStoreLoaded()
  const run = runsById.get(runId)
  if (!run) return null
  if (run.userId !== actorId) {
    return null
  }
  return structuredClone(run)
}

export function listSearchRunsForActor(actorId: string): SearchRunState[] {
  ensureDiskStoreLoaded()
  const results: SearchRunState[] = []
  for (const run of runsById.values()) {
    if (run.userId === actorId) {
      results.push(structuredClone(run))
    }
  }
  return results.sort(
    (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)
  )
}

export function deleteSearchRunForActor(
  runId: string,
  actorId: string
): boolean {
  ensureDiskStoreLoaded()
  const run = runsById.get(runId)
  if (!run || run.userId !== actorId) {
    return false
  }
  runsById.delete(runId)
  flushStoreToDisk()
  persistInBackground(() => pgDeleteRun(runId), 'delete run')
  return true
}

export function cancelSearchRunForActor(
  runId: string,
  actorId: string
): { ok: boolean; status: 'cancelled' | 'not-found' | 'forbidden' } {
  ensureDiskStoreLoaded()
  const run = runsById.get(runId)
  if (!run) {
    return { ok: false, status: 'not-found' }
  }
  if (run.userId !== actorId) {
    return { ok: false, status: 'forbidden' }
  }

  const controller = activeRunAbortControllers.get(runId)
  if (controller) {
    controller.abort()
    activeRunAbortControllers.delete(runId)
  }

  run.status = 'cancelled'
  run.updatedAt = new Date().toISOString()
  runsById.set(runId, structuredClone(run))
  flushStoreToDisk()
  const cancelled = structuredClone(run)
  persistInBackground(
    () => upsertRun(cancelled.runId, cancelled.userId, cancelled),
    'cancel run'
  )
  return { ok: true, status: 'cancelled' }
}

/**
 * Creates a selected-output, immutable share snapshot from a user's run.
 * - Never exposes the user's private conversation history or unselected runs.
 * - Stores only the SHA-256 hash of the unlisted token.
 */
export function createSelectedOutputShare(options: {
  actorId: string
  request: CreateShareRequest
}): {
  shareId: string
  rawToken: string
  shareUrlPath: string
  snapshot: ShareSnapshot
} {
  ensureDiskStoreLoaded()
  const run = getSearchRunForActor(options.request.runId, options.actorId)
  if (!run) {
    throw new Error('Run not found or access denied')
  }

  const selectedSourceSet = new Set(options.request.selectedSourceIds)
  const selectedSources = run.results.filter(s => selectedSourceSet.has(s.id))
  if (selectedSources.length === 0) {
    throw new Error('At least one valid source from the run must be selected')
  }

  const selectedEvidenceSet = new Set(options.request.selectedEvidenceIds)
  const selectedEvidence = run.evidence.filter(
    e =>
      selectedEvidenceSet.has(e.id) ||
      selectedSources.some(s => s.id === e.sourceId)
  )

  const chosenAnswer = options.request.includeAnswerVersionId
    ? run.answers.find(a => a.id === options.request.includeAnswerVersionId)
    : run.answers[run.answers.length - 1]

  const shareId = `shr-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`
  const rawToken = crypto.randomBytes(24).toString('base64url')
  const tokenHash = hashShareToken(rawToken)
  const now = new Date()
  const expiresAt =
    options.request.expiresInDays !== null
      ? new Date(
          now.getTime() + options.request.expiresInDays * 24 * 60 * 60 * 1000
        ).toISOString()
      : null

  const snapshot: ShareSnapshot = {
    id: shareId,
    runId: run.runId,
    ownerId: options.actorId,
    title: options.request.title,
    createdAt: now.toISOString(),
    expiresAt,
    revokedAt: null,
    snapshot: {
      ...(options.request.includeQuery ? { query: run.request.query } : {}),
      mode: run.request.mode,
      depth: run.request.depth,
      createdAt: run.createdAt,
      ...(chosenAnswer
        ? {
            answer: {
              markdown: chosenAnswer.markdown,
              modelId: chosenAnswer.modelId,
              createdAt: chosenAnswer.createdAt
            }
          }
        : {}),
      sources: selectedSources,
      evidence: selectedEvidence
    }
  }

  const record: StoredShareRecord = {
    tokenHash,
    snapshot
  }

  sharesById.set(shareId, record)
  sharesByTokenHash.set(tokenHash, record)
  flushStoreToDisk()
  persistInBackground(
    () => upsertShare(shareId, options.actorId, tokenHash, snapshot),
    'save share'
  )

  return {
    shareId,
    rawToken,
    shareUrlPath: `/share/${rawToken}`,
    snapshot: structuredClone(snapshot)
  }
}

export function resolveShareByRawToken(rawToken: string): {
  status: 'active' | 'revoked' | 'expired' | 'not-found'
  snapshot?: ShareSnapshot
} {
  ensureDiskStoreLoaded()
  if (!rawToken || typeof rawToken !== 'string') {
    return { status: 'not-found' }
  }
  const tokenHash = hashShareToken(rawToken)
  const record = sharesByTokenHash.get(tokenHash)
  if (!record) {
    return { status: 'not-found' }
  }

  if (record.snapshot.revokedAt) {
    return { status: 'revoked' }
  }

  if (
    record.snapshot.expiresAt &&
    Date.parse(record.snapshot.expiresAt) <= Date.now()
  ) {
    return { status: 'expired' }
  }

  return {
    status: 'active',
    snapshot: structuredClone(record.snapshot)
  }
}

export function revokeShareForActor(
  shareId: string,
  actorId: string
): { ok: boolean; status: 'revoked' | 'not-found' | 'forbidden' } {
  ensureDiskStoreLoaded()
  const record = sharesById.get(shareId)
  if (!record) {
    return { ok: false, status: 'not-found' }
  }
  if (record.snapshot.ownerId !== actorId) {
    return { ok: false, status: 'forbidden' }
  }

  record.snapshot.revokedAt = new Date().toISOString()
  flushStoreToDisk()
  persistInBackground(
    () =>
      upsertShare(
        record.snapshot.id,
        record.snapshot.ownerId,
        record.tokenHash,
        record.snapshot
      ),
    'revoke share'
  )
  return { ok: true, status: 'revoked' }
}

export function clearAcuityStoreForTests(): void {
  runsById.clear()
  activeRunAbortControllers.clear()
  sharesById.clear()
  sharesByTokenHash.clear()
  pgHydration = null
}
