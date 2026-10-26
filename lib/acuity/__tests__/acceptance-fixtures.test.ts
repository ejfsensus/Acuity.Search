import fs from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  exportRunToMarkdown,
  exportRunToResearchBundle,
  validateResearchBundleForImport
} from '@/lib/acuity/export'
import { ACUITY_SYSTEM_PROMPT } from '@/lib/acuity/prompts'
import { compileScopeFromSelection } from '@/lib/acuity/registry'
import { searchRequestSchema } from '@/lib/acuity/search/contracts'
import { resetProviderCircuits } from '@/lib/acuity/search/provider-health'
import {
  computeVerbatimSha256,
  createSnippetEvidenceRecord,
  verifyAnswerCitations
} from '@/lib/acuity/search/evidence'
import { extractSourceEvidence } from '@/lib/acuity/search/extract'
import {
  continueFederatedSearchRun,
  executeFederatedSearchRun,
  StrictScopeValidationError
} from '@/lib/acuity/search/federate'
import { buildQueryPlan, suggestTopicGroups } from '@/lib/acuity/search/planner'
import { executeSearxngSearch } from '@/lib/acuity/search/providers/searxng'
import {
  inferLiteratureMetadata,
  mergeAndRankCandidates
} from '@/lib/acuity/search/rank'
import {
  evaluateUrlScope,
  validateStrictScopeReadiness
} from '@/lib/acuity/search/scope'
import {
  clearAcuityStoreForTests,
  createSelectedOutputShare,
  getSearchRunForActor,
  resolveShareByRawToken,
  revokeShareForActor,
  saveSearchRun
} from '@/lib/acuity/store'

const fixturesPath = path.join(
  process.cwd(),
  'config',
  'acuity',
  'acceptance-fixtures.json'
)
const exampleBundlePath = path.join(
  process.cwd(),
  'config',
  'acuity',
  'codex-bundle.example.json'
)

const acceptanceSpec = JSON.parse(fs.readFileSync(fixturesPath, 'utf-8')) as {
  schemaVersion: string
  fixtures: Array<Record<string, any>>
}

describe('Acuity.Search Acceptance Fixtures (config/acuity/acceptance-fixtures.json)', () => {
  beforeEach(() => {
    resetProviderCircuits()
    clearAcuityStoreForTests()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('loads all 12 declarative acceptance fixtures from config/acuity/acceptance-fixtures.json', () => {
    expect(acceptanceSpec.schemaVersion).toBe('acuity.search.acceptance.v1')
    expect(acceptanceSpec.fixtures).toHaveLength(12)
    expect(acceptanceSpec.fixtures.map(f => f.id)).toEqual([
      'scope-host-lookalike',
      'scope-path-segment',
      'scope-redirect',
      'searxng-all-time',
      'provider-partial',
      'literature-editions',
      'cross-tradition',
      'records-not-validation',
      'scope-empty-vs-failure',
      'prompt-injection',
      'no-llm',
      'private-share-export'
    ])
  })

  it('Fixture 1: scope-host-lookalike enforces exact host + www alias and blocks lookalike/subdomains', () => {
    const fixture = acceptanceSpec.fixtures.find(
      f => f.id === 'scope-host-lookalike'
    )!
    const target = fixture.selectedTarget
    const scope = {
      policy: 'strict' as const,
      targets: [
        {
          targetId: 't-gnosis',
          label: 'Gnosis Archive',
          hostname: target.hostname,
          includeWwwAlias: target.includeWwwAlias,
          allowedPathPrefixes: [target.pathPrefix]
        }
      ],
      includeDomains: [target.hostname],
      excludeDomains: [],
      excludePathPrefixes: [],
      registryVersion: 'test'
    }

    for (const [candidateUrl, expectedDecision] of Object.entries(
      fixture.candidateUrls as Record<string, 'include' | 'exclude'>
    )) {
      const evaluation = evaluateUrlScope(candidateUrl, scope)
      expect(
        evaluation.allowed,
        `Expected ${candidateUrl} to be ${expectedDecision} (${evaluation.reason})`
      ).toBe(expectedDecision === 'include')
    }
  })

  it('Fixture 2: scope-path-segment enforces segment-boundary path prefix and rejects dot-segment traversal', () => {
    const fixture = acceptanceSpec.fixtures.find(
      f => f.id === 'scope-path-segment'
    )!
    const target = fixture.selectedTarget
    const scope = {
      policy: 'strict' as const,
      targets: [
        {
          targetId: 't-cia',
          label: 'CIA Reading Room',
          hostname: target.hostname,
          includeWwwAlias: target.includeWwwAlias,
          allowedPathPrefixes: [target.pathPrefix]
        }
      ],
      includeDomains: [target.hostname],
      excludeDomains: [],
      excludePathPrefixes: [],
      registryVersion: 'test'
    }

    for (const [candidateUrl, expectedDecision] of Object.entries(
      fixture.candidateUrls as Record<string, 'include' | 'exclude'>
    )) {
      const evaluation = evaluateUrlScope(candidateUrl, scope)
      expect(
        evaluation.allowed,
        `Expected ${candidateUrl} to be ${expectedDecision} (${evaluation.reason})`
      ).toBe(expectedDecision === 'include')
    }
  })

  it('Fixture 3: scope-redirect blocks strict-mode redirect to off-scope host and persists no off-scope evidence', async () => {
    const fixture = acceptanceSpec.fixtures.find(
      f => f.id === 'scope-redirect'
    )!
    const fetchMock = vi.fn(async (url: string) => {
      if (url === fixture.initialUrl) {
        return new Response(null, {
          status: 302,
          headers: {
            location: fixture.redirectUrl
          }
        })
      }
      throw new Error(`Should never fetch off-scope redirect target: ${url}`)
    })

    const extraction = await extractSourceEvidence({
      url: fixture.initialUrl,
      fallbackSnippet: 'Original snippet from search index',
      scope: {
        policy: 'strict',
        targets: [
          {
            targetId: 't-gnosis',
            label: 'Gnosis Archive',
            hostname: 'gnosis.org',
            includeWwwAlias: true,
            allowedPathPrefixes: ['/']
          }
        ],
        includeDomains: ['gnosis.org'],
        excludeDomains: [],
        excludePathPrefixes: [],
        registryVersion: 'test'
      },
      fetchImpl: fetchMock
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(extraction.ok).toBe(false)
    expect(extraction.contentState).toBe('unavailable')
    expect(extraction.verbatimText).toBe('')
    expect(extraction.errorReason).toContain(
      'Redirect destination rejected by scope policy'
    )
    expect(extraction.errorReason).not.toContain('Bearer')
  })

  it('Fixture 4: searxng-all-time sends no default year filter, no hard-coded Google/Bing list, passes server-only gateway header, and distinguishes 403 vs HTML challenge vs engine-partial 200', async () => {
    vi.stubEnv('SEARXNG_API_URL', 'https://searxng.acuity.institute')
    vi.stubEnv('ACUITY_SEARCH_SEARXNG_AUTH_HEADER', 'X-Acuity-Gateway-Token')
    vi.stubEnv('ACUITY_SEARCH_SEARXNG_AUTH_VALUE', 'super-secret-gateway-value')

    const request = searchRequestSchema.parse({
      query: 'Corpus Hermeticum',
      mode: 'general',
      depth: 'quick',
      dateRange: 'all',
      safeSearch: 0
    })
    const scope = compileScopeFromSelection({ policy: 'open' })

    let capturedUrl = ''
    let capturedHeaders: Record<string, string> = {}

    // Case A: HTTP 200 with unresponsive_engines
    const partialRes = await executeSearxngSearch({
      attemptId: 'att-1',
      variantId: 'v1-literal',
      query: 'Corpus Hermeticum',
      request,
      scope,
      fetchImpl: (async (input: RequestInfo | URL, init?: RequestInit) => {
        capturedUrl = input.toString()
        capturedHeaders = (init?.headers as Record<string, string>) || {}
        return new Response(
          JSON.stringify({
            query: 'Corpus Hermeticum',
            results: [
              {
                title: 'Corpus Hermeticum — Sacred Texts',
                url: 'https://sacred-texts.com/chr/herm/index.htm',
                content: 'Hermetic tractates translated by G.R.S. Mead.',
                engines: ['duckduckgo', 'brave']
              }
            ],
            unresponsive_engines: [['qwant', 'timeout']]
          }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' }
          }
        )
      }) as typeof fetch
    })

    const parsedUrl = new URL(capturedUrl)
    expect(parsedUrl.searchParams.has('time_range')).toBe(false)
    expect(parsedUrl.searchParams.has('engines')).toBe(false)
    expect(parsedUrl.searchParams.get('safesearch')).toBe('0')
    expect(capturedHeaders['X-Acuity-Gateway-Token']).toBe(
      'super-secret-gateway-value'
    )
    expect(partialRes.attempt.status).toBe('partial')
    expect(partialRes.attempt.unresponsiveEngines).toEqual([
      { engine: 'qwant', reason: 'timeout' }
    ])
    expect(partialRes.attempt.enginesReporting).toEqual(['duckduckgo', 'brave'])
    expect(JSON.stringify(partialRes.attempt)).not.toContain(
      'super-secret-gateway-value'
    )

    // Case B: HTTP 403 JSON disabled / forbidden
    const forbiddenRes = await executeSearxngSearch({
      attemptId: 'att-2',
      variantId: 'v1-literal',
      query: 'Corpus Hermeticum',
      request,
      scope,
      fetchImpl: (async () =>
        new Response('Forbidden', { status: 403 })) as typeof fetch
    })
    expect(forbiddenRes.attempt.status).toBe('failed')
    expect(forbiddenRes.attempt.errorCode).toBe(
      'SEARXNG_JSON_DISABLED_OR_FORBIDDEN'
    )
    expect(forbiddenRes.attempt.status).not.toBe(partialRes.attempt.status)

    // Case C: HTML challenge page on HTTP 200
    const htmlChallengeRes = await executeSearxngSearch({
      attemptId: 'att-3',
      variantId: 'v1-literal',
      query: 'Corpus Hermeticum',
      request,
      scope,
      fetchImpl: (async () =>
        new Response('<!DOCTYPE html><html><body>Challenge</body></html>', {
          status: 200,
          headers: { 'content-type': 'text/html' }
        })) as typeof fetch
    })
    expect(htmlChallengeRes.attempt.status).toBe('failed')
    expect(htmlChallengeRes.attempt.errorCode).toBe(
      'SEARXNG_NON_JSON_CHALLENGE'
    )
  })

  it('Fixture 5: provider-partial keeps Brave/Exa results visible when SearXNG fails and Tavily is unconfigured, without inventing a fallback provider', async () => {
    vi.stubEnv('SEARXNG_API_URL', 'https://searxng.acuity.institute')
    vi.stubEnv('BRAVE_SEARCH_API_KEY', 'brave-live-test-key')
    vi.stubEnv('TAVILY_API_KEY', '')
    vi.stubEnv('EXA_API_KEY', 'exa-live-test-key')
    vi.stubEnv('ACUITY_SEARCH_LLM_MODE', 'unconfigured')

    const mockFetch = (async (input: RequestInfo | URL) => {
      const url = input.toString()
      if (url.includes('searxng.acuity.institute')) {
        throw new Error('SearXNG upstream timeout')
      }
      if (url.includes('api.search.brave.com')) {
        return Response.json({
          web: {
            results: [
              {
                title: 'Nag Hammadi Library — Gnosis Archive',
                url: 'https://gnosis.org/naghamm/nhl.html',
                description:
                  'Complete texts and introductions from the Nag Hammadi codices.'
              }
            ]
          }
        })
      }
      if (url.includes('api.exa.ai')) {
        return Response.json({
          results: [
            {
              title: 'Gospel of Thomas Translation',
              url: 'https://gnosis.org/naghamm/gosthom.html',
              highlights: [
                'These are the secret sayings which the living Jesus spoke.'
              ]
            }
          ]
        })
      }
      return new Response('<html><body>Excerpt</body></html>', {
        status: 200,
        headers: { 'content-type': 'text/html' }
      })
    }) as typeof fetch

    const run = await executeFederatedSearchRun(
      {
        query: 'Nag Hammadi Gospel of Thomas',
        mode: 'general',
        depth: 'quick',
        answerPreference: 'results-only',
        providers: ['searxng', 'brave', 'tavily', 'exa'],
        extractTopSources: false
      },
      { fetchImpl: mockFetch }
    )

    expect(run.results.length).toBeGreaterThanOrEqual(2)
    const statusesByProvider = new Map<string, string>()
    for (const att of run.providerAttempts) {
      statusesByProvider.set(att.provider, att.status)
    }
    expect(statusesByProvider.get('searxng')).toBe('failed')
    expect(statusesByProvider.get('tavily')).toBe('skipped-unconfigured')
    expect(statusesByProvider.get('brave')).toBe('succeeded')
    expect(statusesByProvider.get('exa')).toBe('succeeded')
  })

  it('Fixture 6: literature-editions keeps different translators distinct, does not mark metadata-only or scan-no-text editions as read, and verifies citations strictly', () => {
    const fixture = acceptanceSpec.fixtures.find(
      f => f.id === 'literature-editions'
    )!
    const suggested = suggestTopicGroups(fixture.query).map(s => s.groupId)
    for (const expectedGroup of fixture.expectedGroups) {
      expect(suggested).toContain(expectedGroup)
    }

    const sources = mergeAndRankCandidates({
      sortOrder: 'combined-relevance',
      includeLiteratureMetadata: true,
      candidates: [
        {
          provider: 'brave',
          providerRank: 1,
          variantId: 'v1',
          executedQuery: fixture.query,
          url: 'https://archive.org/details/corpushermeticum-copenhaver-1992',
          title: 'Corpus Hermeticum — Translated by Brian P. Copenhaver (1992)',
          snippet: 'Poimandres says: I am Poimandres, the Nous of sovereignty.',
          contentState: 'fulltext-excerpt',
          accessStatus: 'open-access',
          lane: 'collection'
        },
        {
          provider: 'exa',
          providerRank: 1,
          variantId: 'v1',
          executedQuery: fixture.query,
          url: 'https://sacred-texts.com/chr/herm/hermetic-mead-1906.htm',
          title:
            'Thrice-Greatest Hermes (Corpus Hermeticum) — Translated by G.R.S. Mead (1906)',
          snippet: 'I am Poemandres, the Mind (Nous) of All-masterhood.',
          contentState: 'fulltext-excerpt',
          accessStatus: 'open-access',
          lane: 'collection'
        },
        {
          provider: 'searxng',
          providerRank: 2,
          variantId: 'v1',
          executedQuery: fixture.query,
          url: 'https://worldcat.org/title/corpus-hermeticum-nock-festugiere',
          title: 'Corpus Hermeticum — Catalogue Record (Nock & Festugière)',
          snippet: 'OCLC catalogue listing; no full text attached.',
          contentState: 'catalogue-metadata',
          accessStatus: 'metadata-only',
          lane: 'wider-web'
        }
      ]
    })

    expect(sources).toHaveLength(3)
    const copenhaver = sources.find(s => s.url.includes('copenhaver'))!
    const mead = sources.find(s => s.url.includes('mead'))!
    const worldcat = sources.find(s => s.url.includes('worldcat'))!

    expect(copenhaver.literature?.translator).toContain('Copenhaver')
    expect(mead.literature?.translator).toContain('G.R.S. Mead')
    expect(copenhaver.id).not.toBe(mead.id)
    expect(worldcat.contentState).toBe('catalogue-metadata')
    expect(worldcat.literature?.accessStatus).toBe('metadata-only')

    const ev1 = createSnippetEvidenceRecord({
      evidenceId: 'ev-1',
      source: copenhaver
    })
    const ev2 = createSnippetEvidenceRecord({
      evidenceId: 'ev-2',
      source: mead
    })

    const validVerification = verifyAnswerCitations(
      `Copenhaver renders Poimandres as "the Nous of sovereignty" [${copenhaver.citationLabel}], whereas Mead renders it as "the Mind (Nous) of All-masterhood" [${mead.citationLabel}].`,
      [copenhaver, mead],
      [ev1, ev2]
    )
    expect(validVerification.valid).toBe(true)

    const invalidVerification = verifyAnswerCitations(
      `Comparison citing a non-existent passage [S99].`,
      [copenhaver, mead],
      [ev1, ev2]
    )
    expect(invalidVerification.valid).toBe(false)
    expect(invalidVerification.unresolvedLabels).toContain('S99')
  })

  it('Fixture 7: cross-tradition expands wahdat al-wujud transliterations and selects contemplative-traditions sources', () => {
    const fixture = acceptanceSpec.fixtures.find(
      f => f.id === 'cross-tradition'
    )!
    const groups = suggestTopicGroups(fixture.query).map(g => g.groupId)
    expect(groups).toContain('contemplative-traditions')

    const req = searchRequestSchema.parse({
      query: fixture.query,
      mode: 'general',
      depth: 'research'
    })
    const scope = compileScopeFromSelection({ policy: 'open' })
    const plan = buildQueryPlan(req, scope)

    expect(
      plan.variants.some(
        v =>
          v.query.includes('Ibn Arabi') || v.query.includes('oneness of being')
      )
    ).toBe(true)
    expect(ACUITY_SYSTEM_PROMPT).toContain(
      'Never use shared vocabulary across traditions as proof of historical transmission'
    )
  })

  it('Fixture 8: records-not-validation maps FOIA/Gateway query to records-foia + consciousness and enforces archival epistemic distinction', () => {
    const fixture = acceptanceSpec.fixtures.find(
      f => f.id === 'records-not-validation'
    )!
    const groups = suggestTopicGroups(fixture.query).map(g => g.groupId)
    for (const expectedGroup of fixture.expectedGroups) {
      expect(groups).toContain(expectedGroup)
    }

    expect(ACUITY_SYSTEM_PROMPT).toContain(
      'Distinguish clearly between what a historical or archival record establishes (e.g., that an agency studied or filed a report on a topic) and whether the underlying phenomenon or claim is scientifically validated.'
    )
  })

  it('Fixture 9: scope-empty-vs-failure prevents empty strict scopes from widening to the open web and rotates unsearched targets on continuation', async () => {
    const conflictedScope = compileScopeFromSelection({
      policy: 'strict',
      includeDomains: ['gnosis.org'],
      excludeDomains: ['gnosis.org']
    })

    const readiness = validateStrictScopeReadiness(conflictedScope, true)
    expect(readiness.valid).toBe(false)

    await expect(
      executeFederatedSearchRun({
        query: 'Gnostic texts',
        mode: 'collections',
        includeDomains: ['gnosis.org'],
        excludeDomains: ['gnosis.org']
      })
    ).rejects.toBeInstanceOf(StrictScopeValidationError)

    vi.stubEnv('BRAVE_SEARCH_API_KEY', 'brave-test-key')
    vi.stubEnv('ACUITY_SEARCH_LLM_MODE', 'unconfigured')

    const mockFetch = (async (input: RequestInfo | URL) => {
      const url = decodeURIComponent(input.toString())
      if (url.includes('gnosis.org')) {
        return Response.json({
          web: {
            results: [
              {
                title: 'Gnosis Archive — Nag Hammadi',
                url: 'https://gnosis.org/naghamm/nhl.html',
                description: 'Gnostic texts from Nag Hammadi.'
              }
            ]
          }
        })
      }
      return Response.json({
        web: {
          results: [
            {
              title: 'Twilit Grotto — Esoteric Archives',
              url: 'https://www.esotericarchives.com/hermetic/index.htm',
              description: 'Hermetic library texts.'
            }
          ]
        }
      })
    }) as typeof fetch

    const initialRun = await executeFederatedSearchRun(
      {
        query: 'Hermeticism',
        mode: 'collections',
        depth: 'quick',
        answerPreference: 'results-only',
        providers: ['brave'],
        collectionGroupIds: ['gnostic-hermetic'],
        extractTopSources: false
      },
      { fetchImpl: mockFetch }
    )

    expect(initialRun.results[0]?.citationLabel).toBe('S1')
    const initialCursor = initialRun.nextContinuationCursor

    const continuedRun = await continueFederatedSearchRun(initialRun, {
      fetchImpl: mockFetch
    })

    expect(continuedRun.results[0]?.citationLabel).toBe('S1')
    expect(continuedRun.nextContinuationCursor).toBeGreaterThan(initialCursor)
  })

  it('Fixture 10: prompt-injection isolates adversarial instructions in retrieved text without altering scope, budget, or exposing secrets', async () => {
    const fixture = acceptanceSpec.fixtures.find(
      f => f.id === 'prompt-injection'
    )!
    vi.stubEnv('BRAVE_SEARCH_API_KEY', 'super-secret-brave-token')
    vi.stubEnv('ACUITY_SEARCH_LLM_MODE', 'unconfigured')

    const requestedUrls: string[] = []
    const mockFetch = (async (input: RequestInfo | URL) => {
      const url = input.toString()
      requestedUrls.push(url)
      return Response.json({
        web: {
          results: [
            {
              title: 'Untrusted Document with Prompt Injection',
              url: 'https://gnosis.org/injected.html',
              description: fixture.retrievedText
            },
            {
              title: 'Off-Scope Link Mentioned by Injection',
              url: 'https://example.invalid/steal',
              description: 'Should be rejected by strict scope.'
            }
          ]
        }
      })
    }) as typeof fetch

    const run = await executeFederatedSearchRun(
      {
        query: 'Gnosis archive overview',
        mode: 'collections',
        depth: 'quick',
        answerPreference: 'answer-with-sources',
        providers: ['brave'],
        includeDomains: ['gnosis.org'],
        extractTopSources: false
      },
      { fetchImpl: mockFetch }
    )

    expect(run.results.map(s => s.url)).toEqual([
      'https://gnosis.org/injected.html'
    ])
    expect(requestedUrls.some(u => u.includes('example.invalid'))).toBe(false)
    expect(JSON.stringify(run)).not.toContain('super-secret-brave-token')
  })

  it('Fixture 11: no-llm returns real provider results, truthful fallback-results-only notice, and working Markdown + JSON exports when no model is configured', async () => {
    vi.stubEnv('BRAVE_SEARCH_API_KEY', 'brave-test-key')
    vi.stubEnv('ACUITY_SEARCH_LLM_MODE', 'unconfigured')

    const mockFetch = (async () =>
      Response.json({
        web: {
          results: [
            {
              title: 'Stanford Encyclopedia of Philosophy — Neoplatonism',
              url: 'https://plato.stanford.edu/entries/neoplatonism/',
              description:
                'Neoplatonism is a modern term used to designate the period of Platonic philosophy beginning with Plotinus.'
            }
          ]
        }
      })) as typeof fetch

    const run = await executeFederatedSearchRun(
      {
        query: 'Plotinus Enneads The One',
        mode: 'general',
        depth: 'quick',
        answerPreference: 'answer-with-sources',
        providers: ['brave'],
        extractTopSources: false
      },
      { fetchImpl: mockFetch }
    )

    expect(run.results).toHaveLength(1)
    expect(run.answers).toHaveLength(1)
    expect(run.answers[0].mode).toBe('fallback-results-only')
    expect(run.answers[0].modelId).toBeNull()
    expect(run.answers[0].markdown).toContain('[S1]')

    const markdown = exportRunToMarkdown(run)
    expect(markdown).toContain('# Acuity.Search Research Export')
    expect(markdown).toContain(
      'https://plato.stanford.edu/entries/neoplatonism/'
    )

    const bundle = exportRunToResearchBundle(run)
    expect(bundle.schemaVersion).toBe('acuity.research-bundle.v1')
    expect(bundle.exampleOnly).toBe(false)
    expect(bundle.evidence[0].sha256).toBe(
      computeVerbatimSha256(run.evidence[0].verbatimText)
    )

    const validation = validateResearchBundleForImport(bundle)
    expect(validation.valid).toBe(true)
  })

  it('Fixture 12: private-share-export enforces actor ownership, selected-output snapshots, expiry/revocation, and rejects exampleOnly bundles on import', async () => {
    vi.stubEnv('BRAVE_SEARCH_API_KEY', 'brave-test-key')
    vi.stubEnv('ACUITY_SEARCH_LLM_MODE', 'unconfigured')

    const mockFetch = (async () =>
      Response.json({
        web: {
          results: [
            {
              title: 'Source Alpha',
              url: 'https://gnosis.org/alpha',
              description: 'Alpha excerpt text.'
            },
            {
              title: 'Source Beta (Private Unselected)',
              url: 'https://gnosis.org/beta',
              description: 'Beta excerpt text that should not be shared.'
            }
          ]
        }
      })) as typeof fetch

    const run = await executeFederatedSearchRun(
      {
        query: 'Gnostic cosmology',
        mode: 'general',
        depth: 'quick',
        answerPreference: 'results-only',
        providers: ['brave'],
        extractTopSources: false
      },
      {
        userId: 'user:account-a',
        isGuest: false,
        fetchImpl: mockFetch
      }
    )

    saveSearchRun(run)

    // Account B cannot read or share Account A's run
    expect(getSearchRunForActor(run.runId, 'user:account-b')).toBeNull()
    expect(() =>
      createSelectedOutputShare({
        actorId: 'user:account-b',
        request: {
          runId: run.runId,
          title: 'Unauthorized Share',
          includeQuery: true,
          selectedSourceIds: [run.results[0].id],
          selectedEvidenceIds: [run.evidence[0].id],
          expiresInDays: 7
        }
      })
    ).toThrow('Run not found or access denied')

    // Account A creates a selected-output share with only Source Alpha
    const createdShare = createSelectedOutputShare({
      actorId: 'user:account-a',
      request: {
        runId: run.runId,
        title: 'Selected Alpha Snapshot',
        includeQuery: true,
        selectedSourceIds: [run.results[0].id],
        selectedEvidenceIds: [run.evidence[0].id],
        expiresInDays: 7
      }
    })

    expect(createdShare.snapshot.snapshot.sources).toHaveLength(1)
    expect(createdShare.snapshot.snapshot.sources[0].url).toBe(
      'https://gnosis.org/alpha'
    )

    const loadedShare = resolveShareByRawToken(createdShare.rawToken)
    expect(loadedShare.status).toBe('active')
    expect(loadedShare.snapshot?.snapshot.sources).toEqual(
      createdShare.snapshot.snapshot.sources
    )

    // Revoking the share causes subsequent token resolution to fail with 'revoked'
    const revoked = revokeShareForActor(createdShare.shareId, 'user:account-a')
    expect(revoked.ok).toBe(true)
    const afterRevoke = resolveShareByRawToken(createdShare.rawToken)
    expect(afterRevoke.status).toBe('revoked')

    // Example bundle (exampleOnly: true) is rejected by validateResearchBundleForImport
    const exampleBundleRaw = JSON.parse(
      fs.readFileSync(exampleBundlePath, 'utf-8')
    )
    const importCheck = validateResearchBundleForImport(exampleBundleRaw)
    expect(importCheck.valid).toBe(false)
    expect(importCheck.errors.join(' ')).toContain('exampleOnly: true')
  })
})
