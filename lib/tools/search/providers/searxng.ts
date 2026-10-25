import { matchesHostScope, normalizeHostname } from '@/lib/acuity/search/scope'
import {
  SearchResultItem,
  SearchResults,
  SearXNGResponse,
  SearXNGResult
} from '@/lib/types'

import { BaseSearchProvider } from './base'

export class SearXNGSearchProvider extends BaseSearchProvider {
  async search(
    query: string,
    maxResults: number = 10,
    _searchDepth: 'basic' | 'advanced' = 'basic',
    includeDomains: string[] = [],
    excludeDomains: string[] = []
  ): Promise<SearchResults> {
    const apiUrl = process.env.SEARXNG_API_URL
    this.validateApiUrl(apiUrl, 'SEARXNG')

    try {
      const normalizedIncludes = includeDomains
        .map(d => normalizeHostname(d))
        .filter((d): d is string => Boolean(d))
      const normalizedExcludes = excludeDomains
        .map(d => normalizeHostname(d))
        .filter((d): d is string => Boolean(d))

      const queryParts = [query.trim()]
      if (normalizedIncludes.length === 1) {
        queryParts.push(`site:${normalizedIncludes[0]}`)
      } else if (normalizedIncludes.length > 1) {
        queryParts.push(
          `(${normalizedIncludes.map(h => `site:${h}`).join(' OR ')})`
        )
      }
      for (const ex of normalizedExcludes) {
        queryParts.push(`-site:${ex}`)
      }

      const compiledQuery = queryParts.filter(Boolean).join(' ')

      // Construct the URL with query parameters without hard-coded Google/Bing or 1-year restrictions
      const url = new URL(`${(apiUrl || '').replace(/\/+$/, '')}/search`)
      url.searchParams.append('q', compiledQuery)
      url.searchParams.append('format', 'json')
      url.searchParams.append(
        'categories',
        process.env.SEARXNG_CATEGORIES || 'general'
      )
      url.searchParams.append(
        'safesearch',
        process.env.SEARXNG_DEFAULT_SAFESEARCH || '0'
      )

      const configuredEngines = process.env.SEARXNG_ENGINES?.trim()
      if (configuredEngines) {
        url.searchParams.append('engines', configuredEngines)
      }

      const headers: Record<string, string> = {
        Accept: 'application/json'
      }
      const authHeaderName = process.env.SEARXNG_AUTH_HEADER_NAME?.trim()
      const authHeaderValue = process.env.SEARXNG_AUTH_HEADER_VALUE?.trim()
      if (authHeaderName && authHeaderValue) {
        headers[authHeaderName] = authHeaderValue
      }

      // Fetch results from SearXNG
      const response = await fetch(url.toString(), {
        method: 'GET',
        headers
      })

      if (!response.ok) {
        const errorText = await response.text()
        console.error(`SearXNG API error (${response.status}):`, errorText)
        throw this.createHttpError(response, 'SearXNG')
      }

      const data: SearXNGResponse = await response.json()

      const filterByDomainScope = (candidateUrl: string): boolean => {
        try {
          const host = normalizeHostname(new URL(candidateUrl).hostname)
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
      }

      // Separate general results and image results, enforce domain scope locally, and limit to maxResults
      const generalResults = (data.results || [])
        .filter(result => !result.img_src && filterByDomainScope(result.url))
        .slice(0, maxResults)
      const imageResults = (data.results || [])
        .filter(result => result.img_src && filterByDomainScope(result.url))
        .slice(0, maxResults)

      // Format the results to match the expected SearchResults structure
      return {
        results: generalResults.map(
          (result: SearXNGResult): SearchResultItem => ({
            title: result.title,
            url: result.url,
            content: result.content
          })
        ),
        query: data.query || query,
        images: imageResults
          .map(result => {
            const imgSrc = result.img_src || ''
            return imgSrc.startsWith('http') ? imgSrc : `${apiUrl}${imgSrc}`
          })
          .filter(Boolean),
        number_of_results: generalResults.length
      }
    } catch (error) {
      console.error('SearXNG API error:', error)
      throw error
    }
  }
}
