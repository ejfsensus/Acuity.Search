import { isPlaceholderValue } from '@/lib/acuity/config'
import type { DateRangeFilter } from '@/lib/acuity/search/contracts'
import type {
  ProviderExecutionInput,
  ProviderExecutionOutput
} from '@/lib/acuity/search/providers/searxng'
import type { RawProviderCandidate } from '@/lib/acuity/search/rank'
import { evaluateUrlScope } from '@/lib/acuity/search/scope'

interface TavilyResultItem {
  title?: string
  url?: string
  content?: string
  raw_content?: string
  score?: number
  published_date?: string
}

interface TavilySearchResponse {
  results?: TavilyResultItem[]
}

function mapTavilyTimeRange(
  range: DateRangeFilter
): 'day' | 'week' | 'month' | 'year' | undefined {
  if (
    range === 'day' ||
    range === 'week' ||
    range === 'month' ||
    range === 'year'
  ) {
    return range
  }
  return undefined
}

export async function executeTavilySearch(
  input: ProviderExecutionInput
): Promise<ProviderExecutionOutput> {
  const startedAtDate = new Date()
  const startPerf = performance.now()
  const apiKey = process.env.TAVILY_API_KEY?.trim()

  const executedQuery =
    input.query.length < 5 ? input.query.padEnd(5, ' ') : input.query

  if (isPlaceholderValue(apiKey)) {
    return {
      attempt: {
        attemptId: input.attemptId,
        provider: 'tavily',
        variantId: input.variantId,
        executedQuery,
        targetId: input.targetId,
        status: apiKey ? 'failed' : 'skipped-unconfigured',
        latencyMs: Math.round(performance.now() - startPerf),
        rawResultCount: 0,
        acceptedResultCount: 0,
        filteredOutCount: 0,
        errorCode: apiKey ? 'TAVILY_INVALID_KEY' : 'TAVILY_UNCONFIGURED',
        errorMessage: 'TAVILY_API_KEY is not configured.',
        startedAt: startedAtDate.toISOString(),
        completedAt: new Date().toISOString()
      },
      candidates: []
    }
  }

  const maxResults = Math.min(20, Math.max(1, input.maxResults ?? 15))
  const includeDomains = input.targetHostname
    ? [input.targetHostname]
    : input.scope.policy === 'strict'
      ? input.scope.includeDomains
      : []

  // Note: Acuity policy removes upstream's opaque CLOUD_EXCLUDED_DOMAINS (['instagram.com'])
  // and passes only explicit user/collection excludeDomains.
  const excludeDomains = input.scope.excludeDomains
  const timeRange = mapTavilyTimeRange(input.request.dateRange)

  const fetchFn = input.fetchImpl ?? fetch
  const timeoutSignal = AbortSignal.timeout(10000)
  const combinedSignal = input.signal
    ? AbortSignal.any([input.signal, timeoutSignal])
    : timeoutSignal

  try {
    const response = await fetchFn('https://api.tavily.com/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        api_key: apiKey,
        query: executedQuery,
        max_results: maxResults,
        search_depth: input.request.depth === 'research' ? 'advanced' : 'basic',
        // Never use vendor-generated answers as evidence; only request images if explicitly asked
        include_answers: false,
        include_images: Boolean(input.request.includeMultimedia),
        include_raw_content: false,
        ...(includeDomains.length > 0
          ? { include_domains: includeDomains }
          : {}),
        ...(excludeDomains.length > 0
          ? { exclude_domains: excludeDomains }
          : {}),
        ...(timeRange ? { time_range: timeRange } : {})
      }),
      signal: combinedSignal
    })

    if (!response.ok) {
      return {
        attempt: {
          attemptId: input.attemptId,
          provider: 'tavily',
          variantId: input.variantId,
          executedQuery,
          targetId: input.targetId,
          status: 'failed',
          httpStatus: response.status,
          latencyMs: Math.round(performance.now() - startPerf),
          rawResultCount: 0,
          acceptedResultCount: 0,
          filteredOutCount: 0,
          errorCode: `TAVILY_HTTP_${response.status}`,
          errorMessage: `Tavily returned HTTP ${response.status} ${response.statusText}`,
          startedAt: startedAtDate.toISOString(),
          completedAt: new Date().toISOString()
        },
        candidates: []
      }
    }

    const payload = (await response.json()) as TavilySearchResponse
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

      if (candidates.length < maxResults) {
        candidates.push({
          provider: 'tavily',
          providerRank: candidates.length + 1,
          variantId: input.variantId,
          executedQuery,
          url: item.url,
          title: item.title || item.url,
          snippet: item.content || item.raw_content || '',
          publishedDate: item.published_date,
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
        provider: 'tavily',
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
        provider: 'tavily',
        variantId: input.variantId,
        executedQuery,
        targetId: input.targetId,
        status: isCancelled ? 'cancelled' : 'failed',
        latencyMs: Math.round(performance.now() - startPerf),
        rawResultCount: 0,
        acceptedResultCount: 0,
        filteredOutCount: 0,
        errorCode: isCancelled ? 'CANCELLED' : 'TAVILY_NETWORK_ERROR',
        errorMessage:
          error instanceof Error ? error.message : 'Tavily request failed',
        startedAt: startedAtDate.toISOString(),
        completedAt: new Date().toISOString()
      },
      candidates: []
    }
  }
}
