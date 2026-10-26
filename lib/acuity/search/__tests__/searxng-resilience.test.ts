import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { compileScopeFromSelection } from '@/lib/acuity/registry'
import { searchRequestSchema } from '@/lib/acuity/search/contracts'
import {
  FAILURE_THRESHOLD,
  getCircuitSnapshot,
  isCircuitOpen,
  OPEN_MS,
  recordProviderFailure,
  recordProviderSuccess,
  resetProviderCircuits
} from '@/lib/acuity/search/provider-health'
import { executeSearxngSearch } from '@/lib/acuity/search/providers/searxng'
import {
  decodeEntities,
  parseSearxngHtmlResults
} from '@/lib/acuity/search/providers/searxng-html'

const HTML_PAGE = `<!DOCTYPE html><html><body class="results_endpoint">
<div id="urls">
<article class="result result-default category-general">
  <a href="https://plato.stanford.edu/entries/gnosticism/" class="url_header" rel="noreferrer"><span class="url_wrapper">plato.stanford.edu</span></a>
  <h3><a href="https://plato.stanford.edu/entries/gnosticism/" rel="noreferrer">Gnosticism &amp; the <span class="highlight">Pleroma</span></a></h3>
  <p class="content">The Gnostics held that a divine spark&#39;s return…</p>
  <div class="engines"><span>brave</span><span>duckduckgo</span></div>
</article>
<article class="result result-default category-general">
  <h3><a href="https://www.sacred-texts.com/chr/gno/index.htm">Gnostic texts</a></h3>
  <p class="content">Nag Hammadi library</p>
</article>
<article class="result"><h3><a href="/relative">ignored</a></h3></article>
</div></body></html>`

function buildInput(fetchImpl: typeof fetch) {
  const request = searchRequestSchema.parse({ query: 'gnosticism' })
  const scope = compileScopeFromSelection({
    policy: 'open',
    collectionGroupIds: [],
    entryIds: [],
    tags: [],
    starterPriorityOnly: false,
    includeDomains: [],
    excludeDomains: []
  })
  return {
    attemptId: 'a1',
    variantId: 'v1',
    query: 'gnosticism',
    request,
    scope,
    fetchImpl
  }
}

describe('SearXNG HTML fallback parser', () => {
  it('parses simple-theme result articles and ignores relative links', () => {
    const results = parseSearxngHtmlResults(HTML_PAGE)
    expect(results).toHaveLength(2)
    expect(results[0]).toEqual({
      url: 'https://plato.stanford.edu/entries/gnosticism/',
      title: 'Gnosticism & the Pleroma',
      content: "The Gnostics held that a divine spark's return…",
      engines: ['brave', 'duckduckgo']
    })
    expect(results[1].engines).toEqual([])
  })

  it('returns nothing for a results page with no articles', () => {
    expect(parseSearxngHtmlResults('<html><body>no results</body></html>')).toEqual([])
  })

  it('decodes numeric and named entities', () => {
    expect(decodeEntities('a &amp; b &#x27;c&#39; &lt;d&gt;')).toBe("a & b 'c' <d>")
  })
})

describe('provider circuit breaker', () => {
  beforeEach(() => resetProviderCircuits())

  it('opens after the failure threshold and half-opens after the window', () => {
    const t0 = 1_000_000
    for (let i = 0; i < FAILURE_THRESHOLD; i++) {
      recordProviderFailure('searxng', 'X', t0)
    }
    expect(isCircuitOpen('searxng', t0 + 1)).toBe(true)
    expect(isCircuitOpen('searxng', t0 + OPEN_MS + 1)).toBe(false)
    // one more failure in half-open re-opens straight away
    recordProviderFailure('searxng', 'X', t0 + OPEN_MS + 2)
    expect(isCircuitOpen('searxng', t0 + OPEN_MS + 3)).toBe(true)
  })

  it('closes on success', () => {
    recordProviderFailure('searxng', 'X')
    recordProviderSuccess('searxng')
    expect(getCircuitSnapshot('searxng').consecutiveFailures).toBe(0)
  })
})

describe('executeSearxngSearch resilience', () => {
  beforeEach(() => {
    resetProviderCircuits()
    vi.stubEnv('SEARXNG_API_URL', '')
    vi.stubEnv('SEARXNG_URL', 'https://searxng-production-3588.up.railway.app')
  })
  afterEach(() => {
    vi.unstubAllEnvs()
    resetProviderCircuits()
  })

  it('accepts SEARXNG_URL as an alias and falls back to HTML on 403', async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      if (init?.method === 'POST') {
        return new Response(HTML_PAGE, {
          status: 200,
          headers: { 'content-type': 'text/html' }
        })
      }
      return new Response('Forbidden', { status: 403 })
    }) as unknown as typeof fetch

    const out = await executeSearxngSearch(buildInput(fetchImpl))
    expect(out.attempt.status).toBe('succeeded')
    expect(out.attempt.errorCode).toBe('SEARXNG_HTML_FALLBACK_AFTER_JSON_FORBIDDEN')
    expect(out.candidates.map(c => c.url)).toContain(
      'https://www.sacred-texts.com/chr/gno/index.htm'
    )
  })

  it('reports a typed error and opens the circuit when JSON and HTML both fail', async () => {
    const fetchImpl = vi.fn(async (_u: string | URL | Request, init?: RequestInit) =>
      init?.method === 'POST'
        ? new Response('<html><body>no results</body></html>', { status: 200 })
        : new Response('Forbidden', { status: 403 })
    ) as unknown as typeof fetch

    const first = await executeSearxngSearch(buildInput(fetchImpl))
    expect(first.attempt.status).toBe('failed')
    expect(first.attempt.errorCode).toBe('SEARXNG_JSON_DISABLED_OR_FORBIDDEN')
    await executeSearxngSearch(buildInput(fetchImpl))

    const calls = (fetchImpl as unknown as { mock: { calls: unknown[] } }).mock.calls.length
    const third = await executeSearxngSearch(buildInput(fetchImpl))
    expect(third.attempt.status).toBe('skipped-disabled')
    expect(third.attempt.errorCode).toBe('SEARXNG_CIRCUIT_OPEN')
    expect((fetchImpl as unknown as { mock: { calls: unknown[] } }).mock.calls.length).toBe(calls)
  })
})
