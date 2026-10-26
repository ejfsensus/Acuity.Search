import type {
  AnswerVersion,
  BudgetSnapshot,
  EvidenceRecord,
  ProviderAttempt,
  SearchRunState,
  SearchStreamEvent,
  SourceResult
} from '@/lib/acuity/search/contracts'

/**
 * Browser-facing projection of a run. The full `SearchRunState` (model id,
 * provider error strings, budgets, full extracted page text, timings) stays
 * server-side in the store for diagnostics/exports; responses and SSE events
 * only carry what the UI renders.
 */
export const PUBLIC_SNIPPET_CHARS = 400
export const PUBLIC_EVIDENCE_CHARS = 1200

const FRIENDLY_ERRORS: Record<string, string> = {
  SEARXNG_JSON_DISABLED_OR_FORBIDDEN: 'Engine unavailable right now.',
  SEARXNG_NON_JSON_CHALLENGE: 'Engine unavailable right now.',
  SEARXNG_CIRCUIT_OPEN: 'Temporarily paused after repeated failures.',
  SEARXNG_ENGINES_UNRESPONSIVE: 'Upstream engines did not respond.',
  BUDGET_EXHAUSTED: 'Skipped to stay within this depth’s search budget.',
  DEADLINE_SKIPPED: 'Not awaited, to keep the enquiry quick.',
  CANCELLED: 'Cancelled.'
}

function friendlyError(code?: string): string | undefined {
  if (!code) return undefined
  if (FRIENDLY_ERRORS[code]) return FRIENDLY_ERRORS[code]
  if (code.startsWith('SEARXNG_HTML_FALLBACK')) return undefined
  if (/UNCONFIGURED|NOT_CONFIGURED|MISSING_KEY/i.test(code)) {
    return 'Not configured.'
  }
  if (/TIMEOUT/i.test(code)) return 'Timed out.'
  return 'Engine returned an error.'
}

function clip(text: string | undefined, max: number): string {
  if (!text) return ''
  return text.length > max ? `${text.slice(0, max).trimEnd()}…` : text
}

export function toPublicAttempt(a: ProviderAttempt): ProviderAttempt {
  return {
    attemptId: a.attemptId,
    provider: a.provider,
    variantId: a.variantId,
    executedQuery: a.executedQuery,
    targetId: a.targetId,
    status: a.status,
    latencyMs: a.latencyMs,
    rawResultCount: a.rawResultCount,
    acceptedResultCount: a.acceptedResultCount,
    filteredOutCount: a.filteredOutCount,
    errorMessage: friendlyError(a.errorCode),
    startedAt: a.startedAt,
    completedAt: a.completedAt
  }
}

export function toPublicSource(s: SourceResult): SourceResult {
  return { ...s, snippet: clip(s.snippet, PUBLIC_SNIPPET_CHARS) }
}

export function toPublicEvidence(e: EvidenceRecord): EvidenceRecord {
  return {
    ...e,
    verbatimText: clip(e.verbatimText, PUBLIC_EVIDENCE_CHARS),
    redirectChain: []
  }
}

export function toPublicAnswer(a: AnswerVersion): AnswerVersion {
  let disclosureNote = a.disclosureNote
  if (
    disclosureNote &&
    /could not be completed|ACUITY_SEARCH_LLM_MODE/i.test(disclosureNote)
  ) {
    disclosureNote =
      a.mode === 'fallback-results-only' &&
      /could not be completed/i.test(disclosureNote)
        ? 'The narrative could not be composed this time. The sources and their evidence are listed below.'
        : 'Narrative synthesis is not enabled here. The sources and their evidence are listed below.'
  }
  return { ...a, modelId: null, disclosureNote }
}

function toPublicBudget(b: BudgetSnapshot): BudgetSnapshot {
  return {
    depth: b.depth,
    maxSearchRequests: b.maxSearchRequests,
    usedSearchRequests: b.usedSearchRequests,
    maxVariants: b.maxVariants,
    usedVariants: b.usedVariants,
    maxExtractions: b.maxExtractions,
    usedExtractions: b.usedExtractions,
    initialLatencyBudgetMs: 0,
    totalLatencyBudgetMs: 0,
    elapsedMs: b.elapsedMs,
    maxSynthesisTokens: 0
  }
}

function toPublicWarning(w: string): string | null {
  // Provider configuration messages (e.g. "TAVILY: TAVILY_API_KEY is not set")
  // are operator diagnostics, not reader-facing.
  if (
    /^[A-Z]+:\s/.test(w) &&
    /(API_KEY|_URL|not set|configure|HTTP \d{3})/i.test(w)
  ) {
    return null
  }
  return w
}

function toPublicCoverageReason(reason?: string): string | undefined {
  if (!reason) return undefined
  if (/^Queued for next Continue Research pass$/.test(reason)) return reason
  if (/API_KEY|not configured|not set|unconfigured/i.test(reason)) {
    return 'Not configured.'
  }
  if (/budget/i.test(reason)) return 'Skipped to stay within the search budget.'
  return 'Engine unavailable for this target.'
}

export function toPublicRun(run: SearchRunState): SearchRunState {
  const cited = new Set(
    run.answers.flatMap(a => a.citations?.resolvedLabels ?? [])
  )
  return {
    runId: run.runId,
    userId: '',
    isGuest: run.isGuest,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
    status: run.status,
    request: run.request,
    scope: run.scope,
    plan: run.plan,
    budget: toPublicBudget(run.budget),
    providerAttempts: run.providerAttempts.map(toPublicAttempt),
    results: run.results.map(toPublicSource),
    // Keep evidence for every source (Ledger renders it), trimmed; cited
    // passages keep a little more context.
    evidence: run.evidence.map(e =>
      cited.has(e.citationLabel)
        ? {
            ...e,
            verbatimText: clip(e.verbatimText, PUBLIC_EVIDENCE_CHARS * 2),
            redirectChain: []
          }
        : toPublicEvidence(e)
    ),
    answers: run.answers.map(toPublicAnswer),
    coverage: run.coverage.map(c => ({
      ...c,
      reason: toPublicCoverageReason(c.reason)
    })),
    nextContinuationCursor: run.nextContinuationCursor,
    warnings: run.warnings
      .map(toPublicWarning)
      .filter((w): w is string => Boolean(w)),
    evidenceStrength: run.evidenceStrength
  }
}

export function toPublicEvent(event: SearchStreamEvent): SearchStreamEvent {
  switch (event.type) {
    case 'provider.Completed':
      return { ...event, attempt: toPublicAttempt(event.attempt) }
    case 'results.Updated':
      return { ...event, results: event.results.map(toPublicSource) }
    case 'extraction.Completed':
      return { ...event, evidence: toPublicEvidence(event.evidence) }
    case 'answer.Completed':
      return { ...event, answer: toPublicAnswer(event.answer) }
    case 'run.Completed':
      return { ...event, run: toPublicRun(event.run) }
    default:
      return event
  }
}
