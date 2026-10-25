import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  resolveRequestActor,
  signGuestSessionToken,
  validateMultiUserReadiness,
  verifyGuestSessionToken
} from '@/lib/acuity/auth'
import {
  getAcuityConfig,
  getProviderStatuses,
  isPlaceholderValue,
  validateSearxngUrl
} from '@/lib/acuity/config'
import {
  compileScopeFromSelection,
  filterRegistryEntries,
  getRegistryGroupSummaries,
  loadDomainRegistry,
  validateRegistryIntegrity
} from '@/lib/acuity/registry'
import {
  DEPTH_BUDGETS,
  FederationConcurrencyPool,
  RunBudgetTracker
} from '@/lib/acuity/search/budget'
import { searchRequestSchema } from '@/lib/acuity/search/contracts'
import {
  buildScopedSearchCacheKey,
  normalizeResultUrl
} from '@/lib/acuity/search/normalize'
import { executeBraveSearch } from '@/lib/acuity/search/providers/brave'
import { executeExaSearch } from '@/lib/acuity/search/providers/exa'
import { executeTavilySearch } from '@/lib/acuity/search/providers/tavily'
import {
  computeRrfContribution,
  mergeAndRankCandidates,
  sortSourceResults
} from '@/lib/acuity/search/rank'

describe('Acuity Domain Registry & Provider Adapters', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('validates the full 110-entry seed catalogue across 10 topic groups and 117 normalized hostnames', () => {
    const registry = loadDomainRegistry()
    const validation = validateRegistryIntegrity(registry)

    expect(validation.valid).toBe(true)
    expect(validation.errors).toEqual([])
    expect(validation.stats.groupCount).toBe(10)
    expect(validation.stats.entryCount).toBe(110)
    expect(validation.stats.urlCount).toBe(146)
    expect(validation.stats.uniqueHosts).toBe(117)
    expect(validation.stats.starterPriorityCount).toBeGreaterThanOrEqual(20)

    const summaries = getRegistryGroupSummaries(registry)
    expect(summaries).toHaveLength(10)

    const gnosticEntries = filterRegistryEntries({
      groupIds: ['gnostic-hermetic'],
      starterPriorityOnly: true
    })
    expect(gnosticEntries.length).toBeGreaterThan(0)
    expect(
      gnosticEntries.some(e => e.suppliedName.includes('Gnostic Society'))
    ).toBe(true)
  })

  it('detects placeholder environment values and validates SearXNG instance URLs', () => {
    expect(isPlaceholderValue('YOUR_API_KEY')).toBe(true)
    expect(isPlaceholderValue('http://localhost:8080')).toBe(false)
    expect(validateSearxngUrl(undefined).valid).toBe(false)
    expect(validateSearxngUrl('https://searxng.example.com').valid).toBe(false)
    expect(validateSearxngUrl('https://search.acuity.institute').valid).toBe(
      true
    )

    vi.stubEnv('ACUITY_SEARCH_LLM_MODE', 'unconfigured')
    expect(getAcuityConfig().llm.configured).toBe(false)
    expect(Object.keys(getProviderStatuses())).toEqual([
      'searxng',
      'brave',
      'tavily',
      'exa'
    ])
  })

  it('caps Brave requests at 20 results, compiles -site: exclusions, and enforces local scope', async () => {
    vi.stubEnv('BRAVE_SEARCH_API_KEY', 'brave-key')
    let requestedUrl = ''

    const request = searchRequestSchema.parse({
      query: 'Valentinus',
      mode: 'collections',
      depth: 'research',
      includeDomains: ['gnosis.org'],
      excludeDomains: ['excluded.org']
    })
    const scope = compileScopeFromSelection({
      policy: 'strict',
      includeDomains: ['gnosis.org'],
      excludeDomains: ['excluded.org']
    })

    const res = await executeBraveSearch({
      attemptId: 'att-brave-1',
      variantId: 'v1',
      query: 'Valentinus',
      request,
      scope,
      maxResults: 50,
      fetchImpl: (async (input: RequestInfo | URL) => {
        requestedUrl = input.toString()
        return Response.json({
          web: {
            results: [
              {
                title: 'Allowed Gnosis Result',
                url: 'https://gnosis.org/library.html',
                description: 'Nag Hammadi library.'
              },
              {
                title: 'Excluded Result',
                url: 'https://excluded.org/spam',
                description: 'Should be filtered out locally.'
              }
            ]
          }
        })
      }) as typeof fetch
    })

    const parsed = new URL(requestedUrl)
    expect(parsed.searchParams.get('count')).toBe('20')
    expect(parsed.searchParams.get('q')).toContain('site:gnosis.org')
    expect(parsed.searchParams.get('q')).toContain('-site:excluded.org')
    expect(res.candidates).toHaveLength(1)
    expect(res.candidates[0].url).toBe('https://gnosis.org/library.html')
  })

  it('sends include_answers: false and include_images: false to Tavily without hidden instagram.com exclusions', async () => {
    vi.stubEnv('TAVILY_API_KEY', 'tavily-key')
    let postedBody: Record<string, any> = {}

    const request = searchRequestSchema.parse({
      query: 'Hermeticism',
      mode: 'general',
      depth: 'quick'
    })
    const scope = compileScopeFromSelection({ policy: 'open' })

    const res = await executeTavilySearch({
      attemptId: 'att-tavily-1',
      variantId: 'v1',
      query: 'Hermeticism',
      request,
      scope,
      maxResults: 10,
      fetchImpl: (async (_input: RequestInfo | URL, init?: RequestInit) => {
        postedBody = JSON.parse(String(init?.body || '{}'))
        return Response.json({
          answer: 'Vendor generated answer that must never be used',
          results: [
            {
              title: 'Hermetic Philosophy Library',
              url: 'https://hermetics.org/library.html',
              content: 'Primary texts on Hermeticism.'
            }
          ]
        })
      }) as typeof fetch
    })

    expect(postedBody.include_answers).toBe(false)
    expect(postedBody.include_images).toBe(false)
    expect(postedBody.exclude_domains || []).not.toContain('instagram.com')
    expect(res.candidates).toHaveLength(1)
  })

  it('maps Exa highlights arrays and enforces local path-prefix scope', async () => {
    vi.stubEnv('EXA_API_KEY', 'exa-key')

    const request = searchRequestSchema.parse({
      query: 'Stargate remote viewing',
      mode: 'collections',
      depth: 'quick',
      includeDomains: ['https://www.cia.gov/readingroom']
    })
    const scope = compileScopeFromSelection({
      policy: 'strict',
      includeDomains: ['https://www.cia.gov/readingroom']
    })

    const res = await executeExaSearch({
      attemptId: 'att-exa-1',
      variantId: 'v1',
      query: 'Stargate remote viewing',
      request,
      scope,
      maxResults: 10,
      fetchImpl: (async () =>
        Response.json({
          results: [
            {
              title: 'CIA FOIA Stargate File',
              url: 'https://www.cia.gov/readingroom/docs/stargate-01.pdf',
              highlights: [
                'First highlight passage.',
                'Second highlight passage.'
              ]
            },
            {
              title: 'CIA Careers Page (Off Path Scope)',
              url: 'https://www.cia.gov/careers/opportunities',
              highlights: ['Off-scope path on same domain.']
            }
          ]
        })) as typeof fetch
    })

    expect(res.candidates).toHaveLength(1)
    expect(res.candidates[0].url).toBe(
      'https://www.cia.gov/readingroom/docs/stargate-01.pdf'
    )
    expect(res.candidates[0].snippet).toBe(
      'First highlight passage. … Second highlight passage.'
    )
  })

  it('normalizes URLs conservatively, computes RRF scores accurately, and builds collision-free scoped cache keys', () => {
    expect(
      normalizeResultUrl(
        'HTTPS://WWW.Gnosis.org/naghamm/nhl.html?utm_source=twitter&id=42#fragment'
      )
    ).toBe('https://www.gnosis.org/naghamm/nhl.html?id=42')

    expect(computeRrfContribution(1)).toBeCloseTo(1 / 61, 6)
    expect(computeRrfContribution(2)).toBeCloseTo(1 / 62, 6)

    const reqStrict = searchRequestSchema.parse({
      query: 'hermeticism',
      mode: 'collections'
    })
    const scopeStrict = compileScopeFromSelection({
      policy: 'strict',
      includeDomains: ['gnosis.org']
    })
    const reqOpen = searchRequestSchema.parse({
      query: 'hermeticism',
      mode: 'general'
    })
    const scopeOpen = compileScopeFromSelection({ policy: 'open' })

    const keyStrict = buildScopedSearchCacheKey({
      request: reqStrict,
      scope: scopeStrict
    })
    const keyOpen = buildScopedSearchCacheKey({
      request: reqOpen,
      scope: scopeOpen
    })
    expect(keyStrict).not.toBe(keyOpen)

    const merged = mergeAndRankCandidates({
      sortOrder: 'combined-relevance',
      candidates: [
        {
          provider: 'searxng',
          providerRank: 2,
          variantId: 'v1',
          executedQuery: 'hermeticism',
          url: 'https://gnosis.org/doc-a',
          title: 'Doc A',
          snippet: 'Snippet A',
          publishedDate: '2020-01-01T00:00:00Z',
          lane: 'collection'
        },
        {
          provider: 'brave',
          providerRank: 1,
          variantId: 'v1',
          executedQuery: 'hermeticism',
          url: 'https://gnosis.org/doc-a?utm_medium=referral',
          title: 'Doc A',
          snippet: 'Longer Snippet A from Brave',
          publishedDate: '2020-01-01T00:00:00Z',
          lane: 'collection'
        },
        {
          provider: 'exa',
          providerRank: 1,
          variantId: 'v1',
          executedQuery: 'hermeticism',
          url: 'https://sacred-texts.com/doc-b',
          title: 'Doc B',
          snippet: 'Snippet B',
          publishedDate: '2024-06-01T00:00:00Z',
          lane: 'wider-web'
        }
      ]
    })

    // Doc A is deduplicated across SearXNG + Brave and receives combined RRF
    expect(merged).toHaveLength(2)
    expect(merged[0].url).toBe('https://gnosis.org/doc-a')
    expect(merged[0].provenance).toHaveLength(2)

    const newestSorted = sortSourceResults(merged, 'newest')
    expect(newestSorted[0].url).toBe('https://sacred-texts.com/doc-b')
  })

  it('enforces Quick/Research budgets, concurrency limits, and multi-user guest session isolation', async () => {
    expect(DEPTH_BUDGETS.quick.maxSearchRequests).toBe(8)
    expect(DEPTH_BUDGETS.research.maxSearchRequests).toBe(24)

    const tracker = new RunBudgetTracker('quick')
    for (let i = 0; i < 8; i++) {
      expect(tracker.trySpendSearchRequest()).toBe(true)
    }
    expect(tracker.trySpendSearchRequest()).toBe(false)

    const pool = new FederationConcurrencyPool()
    const res = await pool.runProviderCall('brave', async () => 'done')
    expect(res).toBe('done')

    // Signed guest session tokens cannot be forged
    const secret = 'test-guest-secret-key'
    const token = signGuestSessionToken('guest12345678', secret)
    expect(verifyGuestSessionToken(token, secret)).toBe('guest:guest12345678')
    expect(verifyGuestSessionToken(`${token}tampered`, secret)).toBeNull()

    const actor1 = await resolveRequestActor(new Request('https://acuity.test'))
    const actor2 = await resolveRequestActor(new Request('https://acuity.test'))
    expect(actor1.actorId).not.toBe(actor2.actorId)

    vi.stubEnv('ACUITY_SEARCH_PUBLIC_MULTI_USER', 'true')
    vi.stubEnv('ENABLE_AUTH', 'false')
    expect(validateMultiUserReadiness().ready).toBe(false)
  })
})
