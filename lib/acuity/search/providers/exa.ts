import { isPlaceholderValue } from '@/lib/acuity/config'
import type { DateRangeFilter } from '@/lib/acuity/search/contracts'
import type {
  ProviderExecutionInput,
  ProviderExecutionOutput
} from '@/lib/acuity/search/providers/searxng'
import type { RawProviderCandidate } from '@/lib/acuity/search/rank'
import { evaluateUrlScope } from '@/lib/acuity/search/scope'

interface ExaRawResult {
  title?: string | null
  url?: string
  id?: string
  score?: number
  publishedDate?: string
  author?: string | null
  highlights?: string[]
  highlight?: string
  text?: string
}

interface ExaSearchResponse {
  results?: ExaRawResult[]
}

function computeStartPublishedDate(range: DateRangeFilter): string | undefined {
  const now = Date.now()
  const dayMs = 24 * 60 * 60 * 1000
  switch (range) {
    case 'day':
      return new Date(now - dayMs).toISOString()
    case 'week':
      return new Date(now - 7 * dayMs).toISOString()
    case 'month':
      return new Date(now - 30 * dayMs).toISOString()
    case 'year':
      return new Date(now - 365 * dayMs).toISOString()
    default:
      return undefined
  }
}

export function extractExaSnippet(item: ExaRawResult): string {
  if (Array.isArray(item.highlights) && item.highlights.length > 0) {
    const joined = item.highlights
      .map(h => (typeof h === 'string' ? h.trim() : ''))
      .filter(Boolean)
      .join(' … ')
    if (joined) return joined.slice(0, 1200)
  }
  if (typeof item.highlight === 'string' && item.highlight.trim()) {
    return item.highlight.trim().slice(0, 1200)
  }
  if (typeof item.text === 'string' && item.text.trim()) {
    return item.text.trim().slice(0, 1200)
  }
  return ''
}

export async function executeExaSearch(
  input: ProviderExecutionInput
): Promise<ProviderExecutionOutput> {
  const startedAtDate = new Date()
  const startPerf = performance.now()
  const apiKey = process.env.EXA_API_KEY?.trim()

  const executedQuery = input.query

  if (isPlaceholderValue(apiKey)) {
    return {
      attempt: {
        attemptId: input.attemptId,
        provider: 'exa',
        variantId: input.variantId,
        executedQuery,
        targetId: input.targetId,
        status: apiKey ? 'failed' : 'skipped-unconfigured',
        latencyMs: Math.round(performance.now() - startPerf),
        rawResultCount: 0,
        acceptedResultCount: 0,
        filteredOutCount: 0,
        errorCode: apiKey ? 'EXA_INVALID_KEY' : 'EXA_UNCONFIGURED',
        errorMessage: 'EXA_API_KEY is not configured.',
        startedAt: startedAtDate.toISOString(),
        completedAt: new Date().toISOString()
      },
      candidates: []
    }
  }

  const numResults = Math.min(20, Math.max(1, input.maxResults ?? 15))
  const includeDomains = input.targetHostname
    ? [input.targetHostname]
    : input.scope.policy === 'strict'
      ? input.scope.includeDomains
      : []
  const excludeDomains = input.scope.excludeDomains
  const startPublishedDate = computeStartPublishedDate(input.request.dateRange)

  const fetchFn = input.fetchImpl ?? fetch
  const timeoutSignal = AbortSignal.timeout(10000)
  const combinedSignal = input.signal
    ? AbortSignal.any([input.signal, timeoutSignal])
    : timeoutSignal

  try {
    const response = await fetchFn('https://api.exa.ai/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey!
      },
      body: JSON.stringify({
        query: executedQuery,
        numResults,
        type: 'auto',
        contents: {
          highlights: {
            numSentences: 3,
            highlightsPerUrl: 2
          },
          text: {
            maxCharacters: 1200
          }
        },
        ...(includeDomains.length > 0 ? { includeDomains } : {}),
        ...(excludeDomains.length > 0 ? { excludeDomains } : {}),
        ...(startPublishedDate ? { startPublishedDate } : {})
      }),
      signal: combinedSignal
    })

    if (!response.ok) {
      return {
        attempt: {
          attemptId: input.attemptId,
          provider: 'exa',
          variantId: input.variantId,
          executedQuery,
          targetId: input.targetId,
          status: 'failed',
          httpStatus: response.status,
          latencyMs: Math.round(performance.now() - startPerf),
          rawResultCount: 0,
          acceptedResultCount: 0,
          filteredOutCount: 0,
          errorCode: `EXA_HTTP_${response.status}`,
          errorMessage: `Exa returned HTTP ${response.status} ${response.statusText}`,
          startedAt: startedAtDate.toISOString(),
          completedAt: new Date().toISOString()
        },
        candidates: []
      }
    }

    const payload = (await response.json()) as ExaSearchResponse
    const rawItems = Array.isArray(payload.results) ? payload.results : []
    const candidates: RawProviderCandidate[] = []
    let filteredOutCount = 0

    for (const item of rawItems) {
      if (!item.url) continue
      // Always enforce local host and path scope verification
      const scopeEval = evaluateUrlScope(item.url, input.scope)
      if (!scopeEval.allowed) {
        filteredOutCount += 1
        continue
      }

      const snippet = extractExaSnippet(item)

      if (candidates.length < numResults) {
        candidates.push({
          provider: 'exa',
          providerRank: candidates.length + 1,
          variantId: input.variantId,
          executedQuery,
          url: item.url,
          title: item.title?.trim() || item.url,
          snippet,
          publishedDate: item.publishedDate,
          author: item.author ?? undefined,
          lane: scopeEval.lane,
          matchedEntryId: scopeEval.matchedTarget?.entryId,
          matchedGroupId: scopeEval.matchedTarget?.groupId,
          holdingLabel: scopeEval.matchedTarget?.label
        })
      }
    }

    return {
      attempt: {
        attemptId: input.attemptId,
        provider: 'exa',
        variantId: input.variantId,
        executedQuery,
        targetId: input.targetId,
        status: 'succeeded',
        httpStatus: response.status,
        latencyMs: Math.round(performance.now() - startPerf),
        rawResultCount: rawItems.length,
        acceptedResultCount: candidates.length,
        filteredOutCount,
        startedAt: startedAtDate.toISOString(),
        completedAt: new Date().toISOString()
      },
      candidates
    }
  } catch (error) {
    const isCancelled =
      input.signal?.aborted ||
      (error instanceof Error && error.name === 'AbortError')
    return {
      attempt: {
        attemptId: input.attemptId,
        provider: 'exa',
        variantId: input.variantId,
        executedQuery,
        targetId: input.targetId,
        status: isCancelled ? 'cancelled' : 'failed',
        latencyMs: Math.round(performance.now() - startPerf),
        rawResultCount: 0,
        acceptedResultCount: 0,
        filteredOutCount: 0,
        errorCode: isCancelled ? 'CANCELLED' : 'EXA_NETWORK_ERROR',
        errorMessage:
          error instanceof Error ? error.message : 'Exa request failed',
        startedAt: startedAtDate.toISOString(),
        completedAt: new Date().toISOString()
      },
      candidates: []
    }
  }
}
