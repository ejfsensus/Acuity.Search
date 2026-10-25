import Exa from 'exa-js'

import { matchesHostScope, normalizeHostname } from '@/lib/acuity/search/scope'
import { SearchResults } from '@/lib/types'

import { BaseSearchProvider } from './base'

export class ExaSearchProvider extends BaseSearchProvider {
  async search(
    query: string,
    maxResults: number = 10,
    _searchDepth: 'basic' | 'advanced' = 'basic',
    includeDomains: string[] = [],
    excludeDomains: string[] = []
  ): Promise<SearchResults> {
    const apiKey = process.env.EXA_API_KEY
    this.validateApiKey(apiKey, 'EXA')

    const normalizedIncludes = includeDomains
      .map(d => normalizeHostname(d))
      .filter((d): d is string => Boolean(d))
    const normalizedExcludes = excludeDomains
      .map(d => normalizeHostname(d))
      .filter((d): d is string => Boolean(d))

    const exa = new Exa(apiKey)
    const exaResults = await exa.searchAndContents(query, {
      highlights: true,
      numResults: maxResults,
      ...(normalizedIncludes.length > 0
        ? { includeDomains: normalizedIncludes }
        : {}),
      ...(normalizedExcludes.length > 0
        ? { excludeDomains: normalizedExcludes }
        : {})
    })

    const filteredResults = (exaResults.results || []).filter((result: any) => {
      if (normalizedIncludes.length === 0 && normalizedExcludes.length === 0) {
        return true
      }
      try {
        const host = normalizeHostname(new URL(result.url).hostname)
        if (!host) return false
        if (normalizedExcludes.some(ex => matchesHostScope(host, ex, true))) {
          return false
        }
        if (
          normalizedIncludes.length > 0 &&
          !normalizedIncludes.some(inc => matchesHostScope(host, inc, true))
        ) {
          return false
        }
        return true
      } catch {
        return false
      }
    })

    return {
      results: filteredResults.map((result: any) => ({
        title: result.title || result.url,
        url: result.url,
        content:
          (Array.isArray(result.highlights) && result.highlights.length > 0
            ? result.highlights.join(' … ')
            : undefined) ||
          result.highlight ||
          result.text ||
          ''
      })),
      query,
      images: [],
      number_of_results: filteredResults.length
    }
  }
}
