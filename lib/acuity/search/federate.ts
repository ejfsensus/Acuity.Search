import { getProviderStatuses } from '@/lib/acuity/config'
import { generateAcuityAnswerVersion } from '@/lib/acuity/prompts'
import { compileScopeFromSelection } from '@/lib/acuity/registry'
import {
  FederationConcurrencyPool,
  RunBudgetTracker
} from '@/lib/acuity/search/budget'
import type {
  CompiledScope,
  CoverageCell,
  EvidenceRecord,
  ProviderAttempt,
  ProviderId,
  ScopePolicy,
  SearchRequest,
  SearchRunState,
  SearchStreamEvent,
  SourceResult
} from '@/lib/acuity/search/contracts'
import { searchRequestSchema } from '@/lib/acuity/search/contracts'
import {
  createEvidenceRecordFromExtraction,
  createSnippetEvidenceRecord
} from '@/lib/acuity/search/evidence'
import { extractSourceEvidence } from '@/lib/acuity/search/extract'
import { buildQueryPlan } from '@/lib/acuity/search/planner'
import {
  executeProviderAdapter,
  type ProviderExecutionInput
} from '@/lib/acuity/search/providers'
import {
  mergeAndRankCandidates,
  type RawProviderCandidate
} from '@/lib/acuity/search/rank'
import { validateStrictScopeReadiness } from '@/lib/acuity/search/scope'

export interface FederationExecutionOptions {
  runId?: string
  userId?: string
  isGuest?: boolean
  signal?: AbortSignal
  onEvent?: (event: SearchStreamEvent) => void
  fetchImpl?: typeof fetch
  adapterOverrides?: Partial<
    Record<
      ProviderId,
      (input: ProviderExecutionInput) => Promise<{
        attempt: ProviderAttempt
        candidates: RawProviderCandidate[]
      }>
    >
  >
}

function resolveDefaultScopePolicy(request: SearchRequest): ScopePolicy {
  if (request.scopePolicy) return request.scopePolicy
  if (request.mode === 'collections') return 'strict'
  if (
    request.collectionGroupIds.length > 0 ||
    request.entryIds.length > 0 ||
    request.includeDomains.length > 0
  ) {
    return request.mode === 'literature' ? 'collection-and-web-lanes' : 'strict'
  }
  return 'open'
}

export class StrictScopeValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'StrictScopeValidationError'
  }
}

export async function executeFederatedSearchRun(
  rawInput: unknown,
  options: FederationExecutionOptions = {}
): Promise<SearchRunState> {
  const request = searchRequestSchema.parse(rawInput)
  const runId =
    options.runId ||
    `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const userId = options.userId || 'guest-isolated'
  const isGuest = options.isGuest ?? true
  const nowIso = new Date().toISOString()

  const policy = resolveDefaultScopePolicy(request)
  const hadRequestedInclusions =
    request.collectionGroupIds.length > 0 ||
    request.entryIds.length > 0 ||
    request.tags.length > 0 ||
    request.starterPriorityOnly ||
    request.includeDomains.length > 0

  const scope: CompiledScope = compileScopeFromSelection({
    policy,
    collectionGroupIds: request.collectionGroupIds,
    entryIds: request.entryIds,
    tags: request.tags,
    starterPriorityOnly: request.starterPriorityOnly,
    includeDomains: request.includeDomains,
    excludeDomains: request.excludeDomains
  })

  const readiness = validateStrictScopeReadiness(scope, hadRequestedInclusions)
  if (!readiness.valid) {
    throw new StrictScopeValidationError(
      readiness.error || 'Invalid strict collection scope'
    )
  }

  options.onEvent?.({
    type: 'run.Accepted',
    runId,
    request,
    scope
  })

  const plan = buildQueryPlan(request, scope)
  options.onEvent?.({
    type: 'plan.Created',
    runId,
    plan
  })

  const warnings: string[] = []
  if (plan.scopeConflictWarning) {
    warnings.push(plan.scopeConflictWarning)
  }

  const providerStatuses = getProviderStatuses()
  for (const prov of request.providers) {
    const st = providerStatuses[prov]
    if (!st.configured) {
      warnings.push(`${prov.toUpperCase()}: ${st.message}`)
    }
  }

  const budget = new RunBudgetTracker(request.depth)
  budget.recordVariantUsed(plan.variants.length)

  const pool = new FederationConcurrencyPool()
  const providerAttempts: ProviderAttempt[] = []
  const allCandidates: RawProviderCandidate[] = []
  const coverage: CoverageCell[] = []

  // Initialize coverage matrix for targets in collection/strict scope
  const targetList =
    scope.targets.length > 0
      ? scope.targets
      : [
          {
            targetId: 'open-web',
            label: 'Open Web Discovery',
            hostname: '*',
            includeWwwAlias: true,
            allowedPathPrefixes: ['/']
          }
        ]

  // Build execution tasks across variants and requested providers
  const tasks: Array<() => Promise<void>> = []
  let attemptSeq = 0

  for (const variant of plan.variants) {
    for (const provider of request.providers) {
      attemptSeq += 1
      const attemptId = `${runId}-att-${attemptSeq}`
      const matchingTarget = variant.targetHostname
        ? scope.targets.find(t => t.hostname === variant.targetHostname)
        : undefined

      tasks.push(async () => {
        if (options.signal?.aborted) {
          providerAttempts.push({
            attemptId,
            provider,
            variantId: variant.id,
            executedQuery: variant.query,
            targetId: matchingTarget?.targetId,
            status: 'cancelled',
            latencyMs: 0,
            rawResultCount: 0,
            acceptedResultCount: 0,
            filteredOutCount: 0,
            errorCode: 'CANCELLED',
            errorMessage: 'Search run cancelled by caller',
            startedAt: new Date().toISOString(),
            completedAt: new Date().toISOString()
          })
          return
        }

        if (!budget.trySpendSearchRequest()) {
          providerAttempts.push({
            attemptId,
            provider,
            variantId: variant.id,
            executedQuery: variant.query,
            targetId: matchingTarget?.targetId,
            status: 'skipped-budget',
            latencyMs: 0,
            rawResultCount: 0,
            acceptedResultCount: 0,
            filteredOutCount: 0,
            errorCode: 'BUDGET_EXHAUSTED',
            errorMessage: `Maximum search request budget (${budget.snapshot().maxSearchRequests}) reached for ${request.depth} depth`,
            startedAt: new Date().toISOString(),
            completedAt: new Date().toISOString()
          })
          return
        }

        options.onEvent?.({
          type: 'provider.Started',
          runId,
          provider,
          query: variant.query
        })

        const customAdapter = options.adapterOverrides?.[provider]
        const execFn = customAdapter
          ? () =>
              customAdapter({
                attemptId,
                variantId: variant.id,
                query: variant.query,
                targetId: matchingTarget?.targetId,
                targetHostname: variant.targetHostname,
                request,
                scope,
                signal: options.signal,
                fetchImpl: options.fetchImpl
              })
          : () =>
              executeProviderAdapter(provider, {
                attemptId,
                variantId: variant.id,
                query: variant.query,
                targetId: matchingTarget?.targetId,
                targetHostname: variant.targetHostname,
                request,
                scope,
                signal: options.signal,
                fetchImpl: options.fetchImpl
              })

        const output = await pool.runProviderCall(
          provider,
          execFn,
          options.signal
        )
        providerAttempts.push(output.attempt)
        allCandidates.push(...output.candidates)

        options.onEvent?.({
          type: 'provider.Completed',
          runId,
          attempt: output.attempt
        })
      })
    }
  }

  await Promise.allSettled(tasks.map(t => t()))

  // Merge and rank candidates
  const results: SourceResult[] = mergeAndRankCandidates({
    candidates: allCandidates,
    sortOrder: request.sortOrder,
    includeLiteratureMetadata: request.mode === 'literature'
  })

  options.onEvent?.({
    type: 'results.Updated',
    runId,
    results
  })

  // Record coverage matrix across targets
  const searchedHostSet = new Set(
    plan.variants.map(v => v.targetHostname).filter(Boolean) as string[]
  )

  for (const target of targetList) {
    for (const provider of request.providers) {
      const matchingAttempts = providerAttempts.filter(
        a =>
          a.provider === provider &&
          (target.targetId === 'open-web' ||
            a.targetId === target.targetId ||
            !a.targetId)
      )
      const targetResultCount = results.filter(
        r =>
          (target.targetId === 'open-web' ||
            r.matchedEntryId === target.entryId ||
            r.hostname === target.hostname ||
            r.hostname === `www.${target.hostname}`) &&
          r.provenance.some(p => p.provider === provider)
      ).length

      let status: CoverageCell['status'] = 'unsearched'
      let reason: string | undefined

      if (
        matchingAttempts.some(
          a => a.status === 'succeeded' || a.status === 'partial'
        )
      ) {
        status = 'succeeded'
      } else if (matchingAttempts.some(a => a.status === 'failed')) {
        status = 'failed'
        reason = matchingAttempts.find(a => a.status === 'failed')?.errorMessage
      } else if (
        matchingAttempts.some(
          a =>
            a.status === 'skipped-unconfigured' || a.status === 'skipped-budget'
        )
      ) {
        status = 'unsearched'
        reason = matchingAttempts[0]?.errorMessage
      } else if (
        target.targetId !== 'open-web' &&
        scope.targets.length > plan.variants.length &&
        !searchedHostSet.has(target.hostname)
      ) {
        status = 'unsearched'
        reason = 'Queued for next Continue Research pass'
      }

      coverage.push({
        targetId: target.targetId,
        targetLabel: target.label,
        hostname: target.hostname,
        variantId: plan.variants[0]?.id || 'v1-literal',
        provider,
        status,
        resultCount: targetResultCount,
        reason
      })
    }
  }

  // Bounded extraction into immutable Evidence Ledger
  const evidence: EvidenceRecord[] = []
  let evidenceSeq = 0

  if (request.extractTopSources && results.length > 0) {
    const maxToExtract =
      request.depth === 'research'
        ? Math.min(12, results.length)
        : Math.min(4, results.length)
    const candidatesForExtraction = results.slice(0, maxToExtract)

    await Promise.allSettled(
      candidatesForExtraction.map(async src => {
        if (!budget.trySpendExtraction()) return
        let origin = src.hostname
        try {
          origin = new URL(src.url).origin
        } catch {}

        await pool.runOriginExtraction(
          origin,
          async () => {
            const extracted = await extractSourceEvidence({
              url: src.url,
              scope,
              fallbackTitle: src.title,
              fallbackSnippet: src.snippet,
              signal: options.signal,
              fetchImpl: options.fetchImpl
            })

            evidenceSeq += 1
            const evId = `${runId}-ev-${evidenceSeq}`
            const record = extracted.ok
              ? createEvidenceRecordFromExtraction({
                  evidenceId: evId,
                  source: src,
                  extraction: extracted
                })
              : createSnippetEvidenceRecord({
                  evidenceId: evId,
                  source: src
                })

            src.contentState = record.contentState
            src.accessStatus = extracted.accessStatus
            if (extracted.canonicalUrl) {
              src.canonicalUrl = extracted.canonicalUrl
            }
            if (src.literature) {
              src.literature.accessStatus = extracted.accessStatus
              if (record.contentState === 'scan-no-text') {
                src.literature.format = 'Scan'
              } else if (record.contentState === 'catalogue-metadata') {
                src.literature.format = 'Catalogue'
              }
            }
            src.evidenceIds.push(record.id)
            evidence.push(record)

            options.onEvent?.({
              type: 'extraction.Completed',
              runId,
              evidence: record
            })
          },
          options.signal
        )
      })
    )
  }

  // Ensure every result has at least a snippet-backed evidence entry if not extracted
  for (const src of results) {
    if (src.evidenceIds.length === 0) {
      evidenceSeq += 1
      const evId = `${runId}-ev-${evidenceSeq}`
      const snippetRecord = createSnippetEvidenceRecord({
        evidenceId: evId,
        source: src
      })
      src.evidenceIds.push(snippetRecord.id)
      evidence.push(snippetRecord)
    }
  }

  // Synthesize answer or produce results-only overview
  const answer = await generateAcuityAnswerVersion({
    versionNumber: 1,
    request,
    scope,
    sources: results,
    evidence,
    signal: options.signal
  })

  options.onEvent?.({
    type: 'answer.Completed',
    runId,
    answer
  })

  const anySucceeded = providerAttempts.some(
    a => a.status === 'succeeded' || a.status === 'partial'
  )
  const allCancelled =
    providerAttempts.length > 0 &&
    providerAttempts.every(a => a.status === 'cancelled')

  const runStatus: SearchRunState['status'] = allCancelled
    ? 'cancelled'
    : results.length > 0 || anySucceeded
      ? providerAttempts.some(a => a.status === 'failed')
        ? 'partial'
        : 'completed'
      : 'failed'

  const nextContinuationCursor = Math.min(
    scope.targets.length,
    plan.variants.filter(v => v.kind === 'scoped-site').length
  )

  const finalState: SearchRunState = {
    runId,
    userId,
    isGuest,
    createdAt: nowIso,
    updatedAt: new Date().toISOString(),
    status: runStatus,
    request,
    scope,
    plan,
    budget: budget.snapshot(),
    providerAttempts,
    results,
    evidence,
    answers: [answer],
    coverage,
    nextContinuationCursor,
    warnings
  }

  options.onEvent?.({
    type: 'run.Completed',
    runId,
    run: finalState
  })

  return finalState
}

/**
 * Continues an existing search run across remaining unsearched collection targets
 * using deterministic round-robin target rotation, preserving existing citation
 * labels (`S1`, `S2`, ...) so prior citations never renumber.
 */
export async function continueFederatedSearchRun(
  existingRun: SearchRunState,
  options: FederationExecutionOptions = {}
): Promise<SearchRunState> {
  const { request, scope } = existingRun
  const batchSize = request.depth === 'research' ? 5 : 2
  const remainingTargets = scope.targets.slice(
    existingRun.nextContinuationCursor,
    existingRun.nextContinuationCursor + batchSize
  )

  if (remainingTargets.length === 0) {
    return existingRun
  }

  const budget = new RunBudgetTracker(request.depth)
  const pool = new FederationConcurrencyPool()
  const newAttempts: ProviderAttempt[] = []
  const newCandidates: RawProviderCandidate[] = []
  let attemptSeq = existingRun.providerAttempts.length

  const tasks: Array<() => Promise<void>> = []

  for (const target of remainingTargets) {
    const variantId = `cont-site-${target.hostname.replace(/[^a-z0-9]/g, '-')}`
    const siteQuery =
      `site:${target.hostname} ${existingRun.plan.cleanedQuery}`.trim()

    for (const provider of request.providers) {
      attemptSeq += 1
      const attemptId = `${existingRun.runId}-att-${attemptSeq}`

      tasks.push(async () => {
        if (!budget.trySpendSearchRequest()) return

        const customAdapter = options.adapterOverrides?.[provider]
        const execFn = customAdapter
          ? () =>
              customAdapter({
                attemptId,
                variantId,
                query: siteQuery,
                targetId: target.targetId,
                targetHostname: target.hostname,
                request,
                scope,
                signal: options.signal,
                fetchImpl: options.fetchImpl
              })
          : () =>
              executeProviderAdapter(provider, {
                attemptId,
                variantId,
                query: siteQuery,
                targetId: target.targetId,
                targetHostname: target.hostname,
                request,
                scope,
                signal: options.signal,
                fetchImpl: options.fetchImpl
              })

        const out = await pool.runProviderCall(provider, execFn, options.signal)
        newAttempts.push(out.attempt)
        newCandidates.push(...out.candidates)
      })
    }
  }

  await Promise.allSettled(tasks.map(t => t()))

  const mergedResults = mergeAndRankCandidates({
    candidates: newCandidates,
    existingResults: existingRun.results,
    sortOrder: request.sortOrder,
    includeLiteratureMetadata: request.mode === 'literature'
  })

  const updatedEvidence = [...existingRun.evidence]
  let evidenceSeq = updatedEvidence.length
  for (const src of mergedResults) {
    if (src.evidenceIds.length === 0) {
      evidenceSeq += 1
      const evId = `${existingRun.runId}-ev-${evidenceSeq}`
      const rec = createSnippetEvidenceRecord({
        evidenceId: evId,
        source: src
      })
      src.evidenceIds.push(rec.id)
      updatedEvidence.push(rec)
    }
  }

  const nextAnswer = await generateAcuityAnswerVersion({
    versionNumber: existingRun.answers.length + 1,
    request,
    scope,
    sources: mergedResults,
    evidence: updatedEvidence,
    signal: options.signal
  })

  const newlySearchedIds = new Set(remainingTargets.map(t => t.targetId))
  const updatedCoverage = existingRun.coverage.map(cell => {
    if (!newlySearchedIds.has(cell.targetId)) return cell
    const attempts = newAttempts.filter(
      a => a.targetId === cell.targetId && a.provider === cell.provider
    )
    if (
      attempts.some(a => a.status === 'succeeded' || a.status === 'partial')
    ) {
      return {
        ...cell,
        status: 'succeeded' as const,
        reason: undefined
      }
    }
    if (attempts.some(a => a.status === 'failed')) {
      return {
        ...cell,
        status: 'failed' as const,
        reason: attempts.find(a => a.status === 'failed')?.errorMessage
      }
    }
    return cell
  })

  return {
    ...existingRun,
    updatedAt: new Date().toISOString(),
    providerAttempts: [...existingRun.providerAttempts, ...newAttempts],
    results: mergedResults,
    evidence: updatedEvidence,
    answers: [...existingRun.answers, nextAnswer],
    coverage: updatedCoverage,
    nextContinuationCursor:
      existingRun.nextContinuationCursor + remainingTargets.length
  }
}
