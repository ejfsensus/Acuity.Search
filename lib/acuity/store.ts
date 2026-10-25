import crypto from 'node:crypto'

import type {
  CreateShareRequest,
  SearchRunState,
  ShareSnapshot
} from '@/lib/acuity/search/contracts'

interface StoredShareRecord {
  tokenHash: string
  snapshot: ShareSnapshot
}

const runsById = new Map<string, SearchRunState>()
const activeRunAbortControllers = new Map<string, AbortController>()
const sharesById = new Map<string, StoredShareRecord>()
const sharesByTokenHash = new Map<string, StoredShareRecord>()

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
  runsById.set(run.runId, structuredClone(run))
}

export function getSearchRunForActor(
  runId: string,
  actorId: string
): SearchRunState | null {
  const run = runsById.get(runId)
  if (!run) return null
  if (run.userId !== actorId) {
    return null
  }
  return structuredClone(run)
}

export function listSearchRunsForActor(actorId: string): SearchRunState[] {
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

export function cancelSearchRunForActor(
  runId: string,
  actorId: string
): { ok: boolean; status: 'cancelled' | 'not-found' | 'forbidden' } {
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
  const record = sharesById.get(shareId)
  if (!record) {
    return { ok: false, status: 'not-found' }
  }
  if (record.snapshot.ownerId !== actorId) {
    return { ok: false, status: 'forbidden' }
  }

  record.snapshot.revokedAt = new Date().toISOString()
  return { ok: true, status: 'revoked' }
}

export function clearAcuityStoreForTests(): void {
  runsById.clear()
  activeRunAbortControllers.clear()
  sharesById.clear()
  sharesByTokenHash.clear()
}
