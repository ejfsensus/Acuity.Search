import { isPlaceholderValue } from '@/lib/acuity/config'
import type {
  CompiledScope,
  DateRangeFilter,
  SafeSearchLevel
} from '@/lib/acuity/search/contracts'
import type {
  ProviderExecutionInput,
  ProviderExecutionOutput
} from '@/lib/acuity/search/providers/searxng'
import type { RawProviderCandidate } from '@/lib/acuity/search/rank'
import { evaluateUrlScope } from '@/lib/acuity/search/scope'

interface BraveWebResultItem {
  title?: string
  url?: string
  description?: string
  age?: string
  page_age?: string
}

interface BraveWebSearchResponse {
  web?: {
    results?: BraveWebResultItem[]
  }
}

function mapBraveFreshness(range: DateRangeFilter): string | undefined {
  switch (range) {
    case 'day':
      return 'pd'
    case 'week':
      return 'pw'
    case 'month':
      return 'pm'
    case 'year':
      return 'py'
    default:
      return undefined
  }
}

function mapBraveSafeSearch(
  level: SafeSearchLevel
): 'off' | 'moderate' | 'strict' {
  if (level === 2) return 'strict'
  if (level === 1) return 'moderate'
  return 'off'
}

export function buildBraveScopedQuery(
  baseQuery: string,
  scope: CompiledScope,
  targetHostname?: string
): string {
  let query = baseQuery.trim()

  if (!/\bsite:[^\s]+/i.test(query)) {
    if (targetHostname) {
      query = `site:${targetHostname} ${query}`.trim()
    } else if (
      scope.policy === 'strict' &&
      scope.includeDomains.length > 0 &&
      scope.includeDomains.length <= 4
    ) {
      const siteClause =
        scope.includeDomains.length === 1
          ? `site:${scope.includeDomains[0]}`
          : `(${scope.includeDomains.map(h => `site:${h}`).join(' OR ')})`
      query = `${siteClause} ${query}`.trim()
    }
  }

  // Append up to 3 -site: exclusions if query length stays under 360 chars
  for (const excluded of scope.excludeDomains.slice(0, 3)) {
    const token = `-site:${excluded}`
    if (query.length + token.length + 1 <= 360 && !query.includes(token)) {
      query = `${query} ${token}`
    }
  }

  return query
}

export async function executeBraveSearch(
  input: ProviderExecutionInput
): Promise<ProviderExecutionOutput> {
  const startedAtDate = new Date()
  const startPerf = performance.now()
  const apiKey = process.env.BRAVE_SEARCH_API_KEY?.trim()

  const executedQuery = buildBraveScopedQuery(
    input.query,
    input.scope,
    input.targetHostname
  )

  if (isPlaceholderValue(apiKey)) {
    return {
      attempt: {
        attemptId: input.attemptId,
        provider: 'brave',
        variantId: input.variantId,
        executedQuery,
        targetId: input.targetId,
        status: apiKey ? 'failed' : 'skipped-unconfigured',
        latencyMs: Math.round(performance.now() - startPerf),
        rawResultCount: 0,
        acceptedResultCount: 0,
        filteredOutCount: 0,
        errorCode: apiKey ? 'BRAVE_INVALID_KEY' : 'BRAVE_UNCONFIGURED',
        errorMessage: 'BRAVE_SEARCH_API_KEY is not configured.',
        startedAt: startedAtDate.toISOString(),
        completedAt: new Date().toISOString()
      },
      candidates: []
    }
  }

  // Brave caps count at 20 and offset at 9
  const count = Math.min(20, Math.max(1, input.maxResults ?? 20))
  const offset = Math.min(9, Math.max(0, input.request.page - 1))

  const endpoint = new URL('https://api.search.brave.com/res/v1/web/search')
  endpoint.searchParams.set('q', executedQuery)
  endpoint.searchParams.set('count', String(count))
  endpoint.searchParams.set('offset', String(offset))
  endpoint.searchParams.set(
    'safesearch',
    mapBraveSafeSearch(input.request.safeSearch)
  )

  const freshness = mapBraveFreshness(input.request.dateRange)
  if (freshness) {
    endpoint.searchParams.set('freshness', freshness)
  }
  if (input.request.language) {
    endpoint.searchParams.set('search_lang', input.request.language)
  }

  const fetchFn = input.fetchImpl ?? fetch
  const timeoutSignal = AbortSignal.timeout(8000)
  const combinedSignal = input.signal
    ? AbortSignal.any([input.signal, timeoutSignal])
    : timeoutSignal

  try {
    const response = await fetchFn(endpoint.toString(), {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'Accept-Encoding': 'gzip',
        'X-Subscription-Token': apiKey!
      },
      signal: combinedSignal
    })

    if (!response.ok) {
      return {
        attempt: {
          attemptId: input.attemptId,
          provider: 'brave',
          variantId: input.variantId,
          executedQuery,
          targetId: input.targetId,
          status: 'failed',
          httpStatus: response.status,
          latencyMs: Math.round(performance.now() - startPerf),
          rawResultCount: 0,
          acceptedResultCount: 0,
          filteredOutCount: 0,
          errorCode: `BRAVE_HTTP_${response.status}`,
          errorMessage: `Brave Search returned HTTP ${response.status} ${response.statusText}`,
          startedAt: startedAtDate.toISOString(),
          completedAt: new Date().toISOString()
        },
        candidates: []
      }
    }

    const data = (await response.json()) as BraveWebSearchResponse
    const rawItems = data.web?.results ?? []
    const candidates: RawProviderCandidate[] = []
    let filteredOutCount = 0

    for (const item of rawItems) {
      if (!item.url) continue
      const scopeEval = evaluateUrlScope(item.url, input.scope)
      if (!scopeEval.allowed) {
        filteredOutCount += 1
        continue
      }

      if (candidates.length < count) {
        candidates.push({
          provider: 'brave',
          providerRank: candidates.length + 1,
          variantId: input.variantId,
          executedQuery,
          url: item.url,
          title: item.title || item.url,
          snippet: item.description || '',
          publishedDate: item.page_age || item.age,
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
        provider: 'brave',
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
        provider: 'brave',
        variantId: input.variantId,
        executedQuery,
        targetId: input.targetId,
        status: isCancelled ? 'cancelled' : 'failed',
        latencyMs: Math.round(performance.now() - startPerf),
        rawResultCount: 0,
        acceptedResultCount: 0,
        filteredOutCount: 0,
        errorCode: isCancelled ? 'CANCELLED' : 'BRAVE_NETWORK_ERROR',
        errorMessage:
          error instanceof Error
            ? error.message
            : 'Brave Search request failed',
        startedAt: startedAtDate.toISOString(),
        completedAt: new Date().toISOString()
      },
      candidates: []
    }
  }
}
