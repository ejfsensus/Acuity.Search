import { getAcuityConfig, validateSearxngUrl } from '@/lib/acuity/config'
import type {
  CompiledScope,
  DateRangeFilter,
  ProviderAttempt,
  SearchRequest
} from '@/lib/acuity/search/contracts'
import type { RawProviderCandidate } from '@/lib/acuity/search/rank'
import { evaluateUrlScope } from '@/lib/acuity/search/scope'

export interface ProviderExecutionInput {
  attemptId: string
  variantId: string
  query: string
  targetId?: string
  targetHostname?: string
  request: SearchRequest
  scope: CompiledScope
  maxResults?: number
  signal?: AbortSignal
  fetchImpl?: typeof fetch
}

export interface ProviderExecutionOutput {
  attempt: ProviderAttempt
  candidates: RawProviderCandidate[]
}

interface SearxngRawResult {
  title?: string
  url?: string
  content?: string
  engine?: string
  engines?: string[]
  publishedDate?: string
  pubdate?: string
  author?: string
}

interface SearxngRawPayload {
  query?: string
  number_of_results?: number
  results?: SearxngRawResult[]
  unresponsive_engines?: Array<
    [string, string] | { engine?: string; error?: string }
  >
}

function mapSearxngTimeRange(range: DateRangeFilter): string | undefined {
  switch (range) {
    case 'day':
      return 'day'
    case 'week':
      return 'week'
    case 'month':
      return 'month'
    case 'year':
      return 'year'
    default:
      return undefined
  }
}

export function buildSearxngScopedQuery(
  baseQuery: string,
  scope: CompiledScope,
  targetHostname?: string
): string {
  // If already contains explicit site: operator, keep as-is
  if (/\bsite:[^\s]+/i.test(baseQuery)) {
    return baseQuery
  }

  if (targetHostname) {
    return `site:${targetHostname} ${baseQuery}`.trim()
  }

  // If strict scope has a single host, compile single-host site: operand
  if (scope.policy === 'strict' && scope.includeDomains.length === 1) {
    return `site:${scope.includeDomains[0]} ${baseQuery}`.trim()
  }

  return baseQuery
}

function parseUnresponsiveEngines(
  raw: SearxngRawPayload['unresponsive_engines']
): Array<{ engine: string; reason: string }> {
  if (!Array.isArray(raw)) return []
  const list: Array<{ engine: string; reason: string }> = []
  for (const item of raw) {
    if (Array.isArray(item) && item.length >= 2) {
      list.push({
        engine: String(item[0]),
        reason: String(item[1])
      })
    } else if (item && typeof item === 'object' && !Array.isArray(item)) {
      const obj = item as { engine?: string; error?: string }
      list.push({
        engine: String(obj.engine || 'unknown'),
        reason: String(obj.error || 'unresponsive')
      })
    }
  }
  return list
}

export async function executeSearxngSearch(
  input: ProviderExecutionInput
): Promise<ProviderExecutionOutput> {
  const startedAtDate = new Date()
  const startPerf = performance.now()
  const config = getAcuityConfig()
  const urlValidation = validateSearxngUrl(process.env.SEARXNG_API_URL)

  const executedQuery = buildSearxngScopedQuery(
    input.query,
    input.scope,
    input.targetHostname
  )

  if (!urlValidation.valid || !urlValidation.normalizedUrl) {
    const isInvalid = Boolean(process.env.SEARXNG_API_URL?.trim())
    return {
      attempt: {
        attemptId: input.attemptId,
        provider: 'searxng',
        variantId: input.variantId,
        executedQuery,
        targetId: input.targetId,
        status: isInvalid ? 'failed' : 'skipped-unconfigured',
        latencyMs: Math.round(performance.now() - startPerf),
        rawResultCount: 0,
        acceptedResultCount: 0,
        filteredOutCount: 0,
        errorCode: isInvalid ? 'SEARXNG_INVALID_URL' : 'SEARXNG_UNCONFIGURED',
        errorMessage: urlValidation.reason,
        startedAt: startedAtDate.toISOString(),
        completedAt: new Date().toISOString()
      },
      candidates: []
    }
  }

  const endpoint = new URL(`${urlValidation.normalizedUrl}/search`)
  endpoint.searchParams.set('q', executedQuery)
  endpoint.searchParams.set('format', 'json')
  endpoint.searchParams.set('categories', 'general')
  endpoint.searchParams.set(
    'safesearch',
    String(input.request.safeSearch ?? config.searxng.safeSearch)
  )
  endpoint.searchParams.set('pageno', String(Math.max(1, input.request.page)))

  const timeRange = mapSearxngTimeRange(input.request.dateRange)
  if (timeRange) {
    endpoint.searchParams.set('time_range', timeRange)
  }

  if (input.request.language) {
    endpoint.searchParams.set('language', input.request.language)
  }

  if (config.searxng.engines.length > 0) {
    endpoint.searchParams.set('engines', config.searxng.engines.join(','))
  }

  const headers: Record<string, string> = {
    Accept: 'application/json',
    'User-Agent': 'Acuity.Search/1.0 (+https://acuity.institute)'
  }

  if (config.searxng.authHeader && config.searxng.authValue) {
    headers[config.searxng.authHeader] = config.searxng.authValue
  }

  const fetchFn = input.fetchImpl ?? fetch
  const timeoutSignal = AbortSignal.timeout(config.searxng.timeoutMs)
  const combinedSignal = input.signal
    ? AbortSignal.any([input.signal, timeoutSignal])
    : timeoutSignal

  try {
    const response = await fetchFn(endpoint.toString(), {
      method: 'GET',
      headers,
      signal: combinedSignal
    })

    const contentType = (
      response.headers.get('content-type') || ''
    ).toLowerCase()

    if (response.status === 401 || response.status === 403) {
      return {
        attempt: {
          attemptId: input.attemptId,
          provider: 'searxng',
          variantId: input.variantId,
          executedQuery,
          targetId: input.targetId,
          status: 'failed',
          httpStatus: response.status,
          latencyMs: Math.round(performance.now() - startPerf),
          rawResultCount: 0,
          acceptedResultCount: 0,
          filteredOutCount: 0,
          errorCode: 'SEARXNG_JSON_DISABLED_OR_FORBIDDEN',
          errorMessage: `External SearXNG returned HTTP ${response.status}. Verify that JSON format is enabled in SearXNG settings.yml and gateway authentication headers match.`,
          startedAt: startedAtDate.toISOString(),
          completedAt: new Date().toISOString()
        },
        candidates: []
      }
    }

    if (!response.ok) {
      return {
        attempt: {
          attemptId: input.attemptId,
          provider: 'searxng',
          variantId: input.variantId,
          executedQuery,
          targetId: input.targetId,
          status: 'failed',
          httpStatus: response.status,
          latencyMs: Math.round(performance.now() - startPerf),
          rawResultCount: 0,
          acceptedResultCount: 0,
          filteredOutCount: 0,
          errorCode: `SEARXNG_HTTP_${response.status}`,
          errorMessage: `External SearXNG returned HTTP ${response.status} ${response.statusText}`,
          startedAt: startedAtDate.toISOString(),
          completedAt: new Date().toISOString()
        },
        candidates: []
      }
    }

    const bodyText = await response.text()
    if (
      contentType.includes('text/html') ||
      bodyText.trimStart().startsWith('<!DOCTYPE') ||
      bodyText.trimStart().startsWith('<html')
    ) {
      return {
        attempt: {
          attemptId: input.attemptId,
          provider: 'searxng',
          variantId: input.variantId,
          executedQuery,
          targetId: input.targetId,
          status: 'failed',
          httpStatus: response.status,
          latencyMs: Math.round(performance.now() - startPerf),
          rawResultCount: 0,
          acceptedResultCount: 0,
          filteredOutCount: 0,
          errorCode: 'SEARXNG_NON_JSON_CHALLENGE',
          errorMessage:
            'External SearXNG returned an HTML/challenge page instead of JSON. Check reverse-proxy protection or format=json support.',
          startedAt: startedAtDate.toISOString(),
          completedAt: new Date().toISOString()
        },
        candidates: []
      }
    }

    let payload: SearxngRawPayload
    try {
      payload = JSON.parse(bodyText) as SearxngRawPayload
    } catch {
      return {
        attempt: {
          attemptId: input.attemptId,
          provider: 'searxng',
          variantId: input.variantId,
          executedQuery,
          targetId: input.targetId,
          status: 'failed',
          httpStatus: response.status,
          latencyMs: Math.round(performance.now() - startPerf),
          rawResultCount: 0,
          acceptedResultCount: 0,
          filteredOutCount: 0,
          errorCode: 'SEARXNG_MALFORMED_JSON',
          errorMessage: 'External SearXNG returned malformed JSON.',
          startedAt: startedAtDate.toISOString(),
          completedAt: new Date().toISOString()
        },
        candidates: []
      }
    }

    const rawResults = Array.isArray(payload.results) ? payload.results : []
    const unresponsive = parseUnresponsiveEngines(payload.unresponsive_engines)
    const enginesReportingSet = new Set<string>()
    const candidates: RawProviderCandidate[] = []
    let filteredOutCount = 0
    const cap = input.maxResults ?? 20

    for (const raw of rawResults) {
      if (!raw.url || typeof raw.url !== 'string') continue
      const resolvedUrl = raw.url.startsWith('http')
        ? raw.url
        : `${urlValidation.normalizedUrl}${raw.url.startsWith('/') ? '' : '/'}${raw.url}`

      const scopeEval = evaluateUrlScope(resolvedUrl, input.scope)
      if (!scopeEval.allowed) {
        filteredOutCount += 1
        continue
      }

      const engines = Array.from(
        new Set([
          ...(Array.isArray(raw.engines) ? raw.engines : []),
          ...(raw.engine ? [raw.engine] : [])
        ])
      )
      for (const eng of engines) enginesReportingSet.add(eng)

      if (candidates.length < cap) {
        candidates.push({
          provider: 'searxng',
          providerRank: candidates.length + 1,
          variantId: input.variantId,
          executedQuery,
          url: resolvedUrl,
          title: raw.title || resolvedUrl,
          snippet: raw.content || '',
          publishedDate: raw.publishedDate || raw.pubdate,
          author: raw.author,
          engines,
          lane: scopeEval.lane,
          matchedEntryId: scopeEval.matchedTarget?.entryId,
          matchedGroupId: scopeEval.matchedTarget?.groupId,
          holdingLabel: scopeEval.matchedTarget?.label
        })
      }
    }

    // If SearXNG returned 0 results while upstream engines reported unresponsive,
    // surface this honestly rather than pretending the search succeeded with 0 matches.
    const allEnginesFailed = rawResults.length === 0 && unresponsive.length > 0

    return {
      attempt: {
        attemptId: input.attemptId,
        provider: 'searxng',
        variantId: input.variantId,
        executedQuery,
        targetId: input.targetId,
        status: allEnginesFailed
          ? 'failed'
          : unresponsive.length > 0
            ? 'partial'
            : 'succeeded',
        httpStatus: response.status,
        latencyMs: Math.round(performance.now() - startPerf),
        rawResultCount: rawResults.length,
        acceptedResultCount: candidates.length,
        filteredOutCount,
        enginesReporting: Array.from(enginesReportingSet),
        unresponsiveEngines: unresponsive,
        errorCode: allEnginesFailed
          ? 'SEARXNG_ENGINES_UNRESPONSIVE'
          : undefined,
        errorMessage: allEnginesFailed
          ? `SearXNG returned 0 results because upstream engines were unresponsive: ${unresponsive
              .map(u => `${u.engine} (${u.reason})`)
              .join(', ')}`
          : undefined,
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
        provider: 'searxng',
        variantId: input.variantId,
        executedQuery,
        targetId: input.targetId,
        status: isCancelled ? 'cancelled' : 'failed',
        latencyMs: Math.round(performance.now() - startPerf),
        rawResultCount: 0,
        acceptedResultCount: 0,
        filteredOutCount: 0,
        errorCode: isCancelled ? 'CANCELLED' : 'SEARXNG_NETWORK_ERROR',
        errorMessage:
          error instanceof Error ? error.message : 'SearXNG request failed',
        startedAt: startedAtDate.toISOString(),
        completedAt: new Date().toISOString()
      },
      candidates: []
    }
  }
}
