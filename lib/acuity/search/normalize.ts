import crypto from 'node:crypto'

import type {
  CompiledScope,
  SearchRequest
} from '@/lib/acuity/search/contracts'
import { normalizeHostname } from '@/lib/acuity/search/scope'

const TRACKING_PARAMS = new Set([
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'utm_id',
  'fbclid',
  'gclid',
  'dclid',
  'msclkid',
  'mc_cid',
  'mc_eid',
  'igshid',
  'ref_src',
  'ref_url',
  '_hsenc',
  '_hsmi',
  'vero_id'
])

/**
 * Conservatively normalizes a result URL for deduplication:
 * - Lowercases scheme and IDNA hostname
 * - Strips default ports (:80 for http, :443 for https)
 * - Strips URL fragments (#...)
 * - Removes known marketing/tracking parameters while preserving all meaningful
 *   document/query parameters (e.g. `?id=123`, `?page=4`, `?edition=copenhaver`)
 * - Preserves path case (since archival servers are often case-sensitive)
 */
export function normalizeResultUrl(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl.trim())
    const host =
      normalizeHostname(parsed.hostname) ?? parsed.hostname.toLowerCase()
    parsed.hostname = host
    parsed.hash = ''

    if (
      (parsed.protocol === 'http:' && parsed.port === '80') ||
      (parsed.protocol === 'https:' && parsed.port === '443')
    ) {
      parsed.port = ''
    }

    const keysToDelete: string[] = []
    parsed.searchParams.forEach((_val, key) => {
      const lowerKey = key.toLowerCase()
      if (TRACKING_PARAMS.has(lowerKey) || lowerKey.startsWith('utm_')) {
        keysToDelete.push(key)
      }
    })
    for (const key of keysToDelete) {
      parsed.searchParams.delete(key)
    }

    // Sort remaining query parameters for canonical deduplication
    parsed.searchParams.sort()

    // Collapse trailing slash on root only; preserve path trailing slash semantics elsewhere
    let result = parsed.toString()
    if (parsed.pathname === '/' && !parsed.search && result.endsWith('/')) {
      result = result.slice(0, -1)
    }
    return result
  } catch {
    return rawUrl.trim()
  }
}

/**
 * Builds a deterministic, collision-resistant cache key for a federated search
 * or provider query that incorporates every scope, filter, and policy dimension
 * so narrow collection searches can never poison open-web searches or vice versa.
 */
export function buildScopedSearchCacheKey(params: {
  request: SearchRequest
  scope: CompiledScope
  extractionPolicy?: string
}): string {
  const canonicalPayload = {
    v: 'acuity.cache.v1',
    query: params.request.query.trim(),
    mode: params.request.mode,
    depth: params.request.depth,
    answerPreference: params.request.answerPreference,
    providers: [...params.request.providers].sort(),
    sortOrder: params.request.sortOrder,
    scopePolicy: params.scope.policy,
    registryVersion: params.scope.registryVersion,
    targets: params.scope.targets
      .map(t => `${t.hostname}:${t.allowedPathPrefixes.join(',')}`)
      .sort(),
    excludeDomains: [...params.scope.excludeDomains].sort(),
    excludePaths: params.scope.excludePathPrefixes
      .map(p => `${p.hostname}:${p.pathPrefix}`)
      .sort(),
    dateRange: params.request.dateRange,
    language: params.request.language || '',
    fileType: params.request.fileType,
    safeSearch: params.request.safeSearch,
    page: params.request.page,
    extractionPolicy: params.extractionPolicy || 'default'
  }

  const hash = crypto
    .createHash('sha256')
    .update(JSON.stringify(canonicalPayload))
    .digest('hex')

  return `acuity:search:v1:${hash}`
}
