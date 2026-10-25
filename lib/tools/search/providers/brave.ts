import { matchesHostScope, normalizeHostname } from '@/lib/acuity/search/scope'
import {
  SearchImageItem,
  SearchResults,
  SerperSearchResultItem
} from '@/lib/types'

import { BaseSearchProvider } from './base'

interface BraveWebResult {
  title?: string
  description?: string
  url: string
}

interface BraveVideoResult {
  title?: string
  description?: string
  url?: string
  thumbnail?: {
    src?: string
  }
  video?: {
    duration?: string
  }
  duration?: string
  date?: string
  publisher?: string
}

interface BraveImageResult {
  title?: string
  source?: string
  url?: string
  thumbnail?: {
    src?: string
  }
  properties?: {
    thumbnail?: string
    width?: number
    height?: number
  }
  width?: number
  height?: number
}

export class BraveSearchProvider extends BaseSearchProvider {
  private apiKey: string | undefined

  constructor() {
    super()
    this.apiKey = process.env.BRAVE_SEARCH_API_KEY
  }

  private getImageThumbnailUrl(result: BraveImageResult): string {
    return (
      result.thumbnail?.src ?? result.properties?.thumbnail ?? result.url ?? ''
    )
  }

  async search(
    query: string,
    maxResults: number = 10,
    searchDepth?: 'basic' | 'advanced',
    includeDomains?: string[],
    excludeDomains?: string[],
    options?: {
      type?: 'general' | 'optimized'
      content_types?: Array<'web' | 'video' | 'image' | 'news'>
    }
  ): Promise<SearchResults> {
    if (!this.apiKey) {
      throw new Error('Brave Search API key not configured')
    }

    const contentTypes = options?.content_types || ['web']
    const results: SearchResults = {
      results: [],
      images: [],
      videos: [],
      query,
      number_of_results: 0
    }

    // Execute searches in parallel for each content type
    const promises: Promise<void>[] = []

    if (contentTypes.includes('web')) {
      promises.push(
        this.searchWeb(
          query,
          maxResults,
          results,
          includeDomains,
          excludeDomains
        )
      )
    }

    if (contentTypes.includes('video')) {
      promises.push(this.searchVideos(query, maxResults, results))
    }

    if (contentTypes.includes('image')) {
      promises.push(this.searchImages(query, maxResults, results))
    }

    const settledSearches = await Promise.allSettled(promises)
    const failedSearches = settledSearches.filter(
      (result): result is PromiseRejectedResult => result.status === 'rejected'
    )

    if (
      failedSearches.length > 0 &&
      failedSearches.length === settledSearches.length
    ) {
      throw failedSearches[0].reason
    }

    // Update total count
    results.number_of_results = results.results.length

    return results
  }

  private async searchWeb(
    query: string,
    maxResults: number,
    results: SearchResults,
    includeDomains: string[] = [],
    excludeDomains: string[] = []
  ): Promise<void> {
    try {
      const normalizedIncludes = includeDomains
        .map(d => normalizeHostname(d))
        .filter((d): d is string => Boolean(d))
      const normalizedExcludes = excludeDomains
        .map(d => normalizeHostname(d))
        .filter((d): d is string => Boolean(d))

      const queryParts = [query]
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
      const effectiveQuery = queryParts.join(' ')
      const cappedCount = Math.min(Math.max(maxResults, 1), 20)

      const response = await fetch(
        `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(
          effectiveQuery
        )}&count=${cappedCount}`,
        {
          headers: {
            Accept: 'application/json',
            'Accept-Encoding': 'gzip',
            'X-Subscription-Token': this.apiKey!
          }
        }
      )

      if (!response.ok) {
        console.error(`Brave web search failed: ${response.statusText}`)
        throw this.createHttpError(response, 'Brave web')
      }

      const data = await response.json()
      const rawResults: BraveWebResult[] = data.web?.results || []
      const filteredResults = rawResults.filter(item => {
        if (
          normalizedIncludes.length === 0 &&
          normalizedExcludes.length === 0
        ) {
          return true
        }
        try {
          const host = normalizeHostname(new URL(item.url).hostname)
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

      results.results = filteredResults
        .slice(0, cappedCount)
        .map((result: BraveWebResult) => ({
          title: result.title || 'No title',
          content: result.description || 'No description available',
          url: result.url
        }))
    } catch (error) {
      console.error('Brave web search error:', error)
      throw error
    }
  }

  private async searchVideos(
    query: string,
    maxResults: number,
    results: SearchResults
  ): Promise<void> {
    try {
      const response = await fetch(
        `https://api.search.brave.com/res/v1/videos/search?q=${encodeURIComponent(
          query
        )}&count=${maxResults}`,
        {
          headers: {
            Accept: 'application/json',
            'Accept-Encoding': 'gzip',
            'X-Subscription-Token': this.apiKey!
          }
        }
      )

      if (!response.ok) {
        console.error(`Brave video search failed: ${response.statusText}`)
        throw this.createHttpError(response, 'Brave video')
      }

      const data = await response.json()

      // Convert to SerperSearchResultItem format for compatibility
      results.videos = (data.results || []).slice(0, maxResults).map(
        (result: BraveVideoResult, index: number) =>
          ({
            title: result.title ?? 'No title',
            link: result.url ?? '',
            snippet: result.description ?? 'No description available',
            imageUrl: result.thumbnail?.src ?? '',
            duration: result.video?.duration ?? result.duration ?? '',
            source: result.publisher ?? '',
            channel: result.publisher ?? '',
            date: result.date ?? '',
            position: index
          }) as SerperSearchResultItem
      )
    } catch (error) {
      console.error('Brave video search error:', error)
      throw error
    }
  }

  private async searchImages(
    query: string,
    maxResults: number,
    results: SearchResults
  ): Promise<void> {
    try {
      const response = await fetch(
        `https://api.search.brave.com/res/v1/images/search?q=${encodeURIComponent(
          query
        )}&count=${maxResults}`,
        {
          headers: {
            Accept: 'application/json',
            'Accept-Encoding': 'gzip',
            'X-Subscription-Token': this.apiKey!
          }
        }
      )

      if (!response.ok) {
        console.error(`Brave image search failed: ${response.statusText}`)
        throw this.createHttpError(response, 'Brave image')
      }

      const data = await response.json()
      results.images = (data.results || []).slice(0, maxResults).map(
        (result: BraveImageResult) =>
          ({
            title: result.title || 'No title',
            link: result.url || result.source || '',
            thumbnailUrl: this.getImageThumbnailUrl(result)
          }) as SearchImageItem
      )
    } catch (error) {
      console.error('Brave image search error:', error)
      throw error
    }
  }
}
