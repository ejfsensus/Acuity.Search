import { NextResponse } from 'next/server'

import { resolveRequestActor } from '@/lib/acuity/auth'
import {
  executeFederatedSearchRun,
  StrictScopeValidationError
} from '@/lib/acuity/search/federate'
import { buildScopedSearchCacheKey } from '@/lib/acuity/search/normalize'
import { SearchResults } from '@/lib/types'

/**
 * Consolidated `/api/advanced-search` endpoint.
 * All requests route through the Acuity federation, scope, SSRF, and budget engine
 * so no alternate endpoint can bypass strict collection scopes or leak unscoped cache entries.
 */
export async function POST(request: Request) {
  try {
    const actor = await resolveRequestActor(request)
    const body = await request.json()
    const {
      query,
      maxResults = 10,
      searchDepth = 'basic',
      includeDomains = [],
      excludeDomains = []
    } = body

    if (!query || typeof query !== 'string' || !query.trim()) {
      return NextResponse.json(
        {
          error: 'Query is required',
          results: [],
          images: [],
          number_of_results: 0
        },
        { status: 400 }
      )
    }

    const run = await executeFederatedSearchRun(
      {
        query: query.trim(),
        mode: includeDomains.length > 0 ? 'collections' : 'general',
        depth: searchDepth === 'advanced' ? 'research' : 'quick',
        answerPreference: 'results-only',
        providers: ['searxng'],
        includeDomains,
        excludeDomains,
        extractTopSources: searchDepth === 'advanced'
      },
      {
        userId: actor.actorId,
        isGuest: actor.isGuest,
        signal: request.signal
      }
    )

    const cacheKey = buildScopedSearchCacheKey({
      request: run.request,
      scope: run.scope,
      extractionPolicy: searchDepth
    })

    const sliced = run.results.slice(0, maxResults)
    const legacyPayload: SearchResults & { cacheKey?: string } = {
      results: sliced.map(r => ({
        title: r.title,
        url: r.url,
        content: r.snippet
      })),
      query: run.request.query,
      images: [],
      number_of_results: sliced.length,
      cacheKey
    }

    return NextResponse.json(legacyPayload)
  } catch (error) {
    if (error instanceof StrictScopeValidationError) {
      return NextResponse.json(
        {
          error: error.message,
          results: [],
          images: [],
          number_of_results: 0
        },
        { status: 400 }
      )
    }
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Internal server error',
        results: [],
        images: [],
        number_of_results: 0
      },
      { status: 500 }
    )
  }
}
