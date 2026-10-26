import { describe, expect, it } from 'vitest'

import type { SearchRunState } from '@/lib/acuity/search/contracts'
import {
  PUBLIC_EVIDENCE_CHARS,
  toPublicEvent,
  toPublicRun
} from '@/lib/acuity/search/public-view'

const big = 'x'.repeat(50_000)

const run = {
  runId: 'run-1',
  userId: 'guest-abc',
  isGuest: true,
  createdAt: 'a',
  updatedAt: 'b',
  status: 'partial',
  request: { query: 'q' },
  scope: { targets: [] },
  plan: { variants: [] },
  budget: {
    depth: 'quick',
    maxSearchRequests: 8,
    usedSearchRequests: 4,
    maxVariants: 2,
    usedVariants: 2,
    maxExtractions: 4,
    usedExtractions: 4,
    initialLatencyBudgetMs: 12000,
    totalLatencyBudgetMs: 60000,
    elapsedMs: 9000,
    maxSynthesisTokens: 2000
  },
  providerAttempts: [
    {
      attemptId: 'a',
      provider: 'searxng',
      variantId: 'v',
      executedQuery: 'q',
      status: 'failed',
      httpStatus: 403,
      latencyMs: 10,
      rawResultCount: 0,
      acceptedResultCount: 0,
      filteredOutCount: 0,
      errorCode: 'SEARXNG_JSON_DISABLED_OR_FORBIDDEN',
      errorMessage: 'External SearXNG returned HTTP 403. Verify settings.yml',
      startedAt: '',
      completedAt: ''
    }
  ],
  results: [{ id: 's1', citationLabel: 'S1', snippet: big }],
  evidence: [
    {
      id: 'e1',
      citationLabel: 'S1',
      verbatimText: big,
      redirectChain: ['http://a']
    },
    { id: 'e2', citationLabel: 'S2', verbatimText: big, redirectChain: [] }
  ],
  answers: [
    {
      id: 'ans',
      versionNumber: 1,
      createdAt: '',
      modelId: 'openai:gpt-secret',
      mode: 'fallback-results-only',
      markdown: 'm',
      citations: {
        valid: true,
        citedLabels: ['S1'],
        resolvedLabels: ['S1'],
        unresolvedLabels: []
      },
      disclosureNote:
        'Model synthesis could not be completed (401 invalid api key sk-...).'
    }
  ],
  coverage: [],
  nextContinuationCursor: 0,
  warnings: [
    'TAVILY: TAVILY_API_KEY is not set',
    'Some slower search engines were not awaited.'
  ],
  timings: { totalMs: 9000 }
} as unknown as SearchRunState

describe('toPublicRun', () => {
  const pub = toPublicRun(run)
  const json = JSON.stringify(pub)

  it('removes model id, provider error strings, http status and timings', () => {
    expect(json).not.toContain('gpt-secret')
    expect(json).not.toContain('settings.yml')
    expect(json).not.toContain('SEARXNG_JSON_DISABLED')
    expect(json).not.toContain('sk-')
    expect(json).not.toContain('TAVILY_API_KEY')
    expect(pub.providerAttempts[0].httpStatus).toBeUndefined()
    expect(pub.providerAttempts[0].errorMessage).toBe(
      'Engine unavailable right now.'
    )
    expect((pub as unknown as { timings?: unknown }).timings).toBeUndefined()
    expect(pub.userId).toBe('')
    expect(pub.budget.totalLatencyBudgetMs).toBe(0)
  })

  it('caps snippets and evidence text, with more room for cited passages', () => {
    expect(pub.results[0].snippet.length).toBeLessThanOrEqual(401)
    expect(pub.evidence[0].verbatimText.length).toBeLessThanOrEqual(
      PUBLIC_EVIDENCE_CHARS * 2 + 1
    )
    expect(pub.evidence[1].verbatimText.length).toBeLessThanOrEqual(
      PUBLIC_EVIDENCE_CHARS + 1
    )
    expect(pub.evidence[0].redirectChain).toEqual([])
    expect(json.length).toBeLessThan(8_000)
  })

  it('keeps reader-facing warnings', () => {
    expect(pub.warnings).toEqual([
      'Some slower search engines were not awaited.'
    ])
  })

  it('sanitises streamed events', () => {
    const ev = toPublicEvent({
      type: 'provider.Completed',
      runId: 'r',
      attempt: run.providerAttempts[0]
    })
    expect(JSON.stringify(ev)).not.toContain('settings.yml')
    const done = toPublicEvent({ type: 'run.Completed', runId: 'r', run })
    expect(JSON.stringify(done)).not.toContain('gpt-secret')
  })
})
