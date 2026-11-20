import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  clearComposioCacheForTests,
  composioAccess,
  composioFailureMessage,
  composioSearch,
  extractResults,
  toComposioArguments
} from '@/lib/acuity/byok/composio'
import { getByokConfig, profileLink } from '@/lib/acuity/byok/config'
import {
  buildByokContext,
  type ByokContext,
  byokPublicStatus,
  runWithByok
} from '@/lib/acuity/byok/context'
import {
  ByokKeyRequiredError,
  describeOpenRouterError
} from '@/lib/acuity/byok/errors'
import { byokLanguageModel } from '@/lib/acuity/byok/openrouter'
import {
  allowByokRun,
  resetByokRateLimitForTests
} from '@/lib/acuity/byok/rate-limit'
import {
  clearByokCache,
  invalidateByok,
  resolveByokCredentials
} from '@/lib/acuity/byok/resolver'
import { providerStatusesFor } from '@/lib/acuity/byok/status'
import { compileScopeFromSelection } from '@/lib/acuity/registry'
import { searchRequestSchema } from '@/lib/acuity/search/contracts'
import { executeBraveSearch } from '@/lib/acuity/search/providers/brave'
import { executeExaSearch } from '@/lib/acuity/search/providers/exa'
import { executeTavilySearch } from '@/lib/acuity/search/providers/tavily'
import { toPublicAttempt } from '@/lib/acuity/search/public-view'

import { byokBannerCopy } from '@/components/acuity/byok-banner'

const ENV_KEYS = [
  'ACUITY_BYOK_MODE',
  'ACUITY_BYOK_URL',
  'ACUITY_BYOK_SERVICE_TOKEN',
  'ACUITY_BYOK_PROFILE_URL',
  'EXA_API_KEY',
  'TAVILY_API_KEY',
  'BRAVE_SEARCH_API_KEY'
] as const
const saved: Record<string, string | undefined> = {}

beforeEach(() => {
  for (const k of ENV_KEYS) saved[k] = process.env[k]
  process.env.ACUITY_BYOK_MODE = 'required'
  process.env.ACUITY_BYOK_URL = 'http://auth.internal:8080'
  process.env.ACUITY_BYOK_SERVICE_TOKEN = 'svc-test-token'
  process.env.ACUITY_BYOK_PROFILE_URL = 'https://auth.example/account'
  // Deployment keys present: BYOK mode must never use them.
  process.env.EXA_API_KEY = 'acuity-paid-exa'
  process.env.TAVILY_API_KEY = 'acuity-paid-tavily'
  process.env.BRAVE_SEARCH_API_KEY = 'acuity-paid-brave'
  clearByokCache()
  clearComposioCacheForTests()
  resetByokRateLimitForTests()
})
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
})

function ctx(over: Partial<ByokContext['credentials']> = {}): ByokContext {
  return {
    required: true,
    identity: { email: 'member@example.com' },
    credentials: { openrouter: null, composio: null, ...over },
    resolverUnavailable: false,
    profileUrl: 'https://auth.example/account#ai-keys'
  }
}

function searchInput(fetchImpl: typeof fetch, includeDomains: string[] = []) {
  return {
    attemptId: 'a1',
    variantId: 'v1',
    query: 'gnostic gospels',
    request: searchRequestSchema.parse({
      query: 'gnostic gospels',
      mode: 'general',
      depth: 'quick'
    }),
    scope: compileScopeFromSelection({ policy: 'open', includeDomains }),
    maxResults: 5,
    fetchImpl
  } as any
}

describe('config', () => {
  it('defaults to required and builds a profile link with a return address', () => {
    expect(getByokConfig({}).mode).toBe('required')
    expect(getByokConfig({ ACUITY_BYOK_MODE: 'off' }).mode).toBe('off')
    const link = new URL(
      profileLink('https://search.example/', {
        ACUITY_BYOK_PROFILE_URL: 'https://auth.example/account'
      })
    )
    expect(link.searchParams.get('return')).toBe('https://search.example/')
    expect(link.hash).toBe('#ai-keys')
  })
})

describe('resolver', () => {
  it('posts the identity with the service token, caches, and can be invalidated', async () => {
    const fetchImpl = vi.fn(async (_url: any, init: any) => {
      expect(init.headers.authorization).toBe('Bearer svc-test-token')
      expect(JSON.parse(init.body)).toEqual({ email: 'member@example.com' })
      return Response.json({
        found: true,
        openrouter: { apiKey: 'sk-or-member', llmModel: 'x/y:free' },
        composio: null
      })
    }) as any
    const id = { email: 'member@example.com' }
    const a = await resolveByokCredentials(id, { fetchImpl })
    expect(a).toEqual({
      status: 'ok',
      credentials: {
        openrouter: { apiKey: 'sk-or-member', llmModel: 'x/y:free' },
        composio: null
      }
    })
    await resolveByokCredentials(id, { fetchImpl })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    invalidateByok(id)
    await resolveByokCredentials(id, { fetchImpl })
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(String(fetchImpl.mock.calls[0][0])).toBe(
      'http://auth.internal:8080/internal/byok/resolve'
    )
  })

  it('reports unavailable (never throws) when acuity-auth fails', async () => {
    const boom = (async () => {
      throw new Error('ECONNREFUSED')
    }) as any
    expect(
      await resolveByokCredentials({ email: 'm@example.com' }, { fetchImpl: boom })
    ).toEqual({ status: 'unavailable' })
    const ctx = await buildByokContext(
      { email: 'm@example.com' },
      { fetchImpl: boom }
    )
    expect(ctx.resolverUnavailable).toBe(true)
    expect(ctx.credentials).toEqual({ openrouter: null, composio: null })
  })

  it('gives guests no keys without calling the resolver', async () => {
    const ctx = await buildByokContext(null)
    expect(ctx.required).toBe(true)
    expect(ctx.identity).toBeNull()
    expect(byokPublicStatus(ctx)).toMatchObject({
      required: true,
      signedIn: false,
      llm: false,
      webSearch: false
    })
  })
})

describe('language model', () => {
  it('throws a friendly key-required error and never falls back', () => {
    expect(() => runWithByok(ctx(), () => byokLanguageModel())).toThrow(
      ByokKeyRequiredError
    )
    expect(() => byokLanguageModel()).toThrow(ByokKeyRequiredError)
  })

  it('uses the member model on OpenRouter', () => {
    const out = runWithByok(
      ctx({ openrouter: { apiKey: 'sk-or-m', llmModel: 'a/b:free' } }),
      () => byokLanguageModel()
    )
    expect(out?.modelId).toBe('openrouter:a/b:free')
  })

  it('maps OpenRouter 401/402/429 to clear messages', () => {
    expect(describeOpenRouterError({ statusCode: 401 }).message).toMatch(
      /did not accept your key/
    )
    expect(describeOpenRouterError({ status: 402 }).message).toMatch(
      /out of credit/
    )
    expect(
      describeOpenRouterError({ lastError: { statusCode: 429 } }).message
    ).toMatch(/rate-limiting/)
  })
})

describe('rate limit', () => {
  it('allows N runs per minute per member', () => {
    for (let i = 0; i < 3; i++) expect(allowByokRun('m', 3, 1000)).toBe(true)
    expect(allowByokRun('m', 3, 1000)).toBe(false)
    expect(allowByokRun('other', 3, 1000)).toBe(true)
    expect(allowByokRun('m', 3, 62_000)).toBe(true)
  })
})

describe('composio', () => {
  it('maps native bodies to tool arguments', () => {
    expect(
      toComposioArguments('exa', {
        query: 'q',
        numResults: 5,
        includeDomains: ['a.org'],
        excludeDomains: ['b.org'],
        bogus: 1
      })
    ).toEqual({ query: 'q', numResults: 5, includeDomains: ['a.org'] })
    expect(
      toComposioArguments('tavily', {
        query: 'q',
        max_results: 3,
        include_answers: false,
        include_domains: []
      })
    ).toEqual({ query: 'q', max_results: 3 })
  })

  it('extracts results from nested tool payloads', () => {
    expect(
      extractResults({ data: { response_data: { results: [{ url: 'u' }] } } })
    ).toEqual([{ url: 'u' }])
    expect(extractResults('{"results":[{"url":"v"}]}')).toEqual([{ url: 'v' }])
  })

  it('skips paid engines without a Composio key', () => {
    runWithByok(ctx(), () => {
      expect(composioAccess('exa')).toMatchObject({
        kind: 'skip',
        code: 'EXA_BYOK_MISSING'
      })
    })
  })

  it('returns 424 when the toolkit is not connected and instant is off', async () => {
    const fetchImpl = (async () => Response.json({ items: [] })) as any
    const res = await composioSearch(
      'exa',
      { kind: 'composio', apiKey: 'ck', allowInstant: false },
      { query: 'q' },
      undefined,
      fetchImpl
    )
    expect(res.status).toBe(424)
    expect(composioFailureMessage('exa', 424)).toMatch(/not connected/)
  })
})

describe('provider adapters in the open edition', () => {
  it('never spends deployment keys: Exa/Tavily skip and Brave is off without member keys', async () => {
    const fetchImpl = vi.fn() as any
    await runWithByok(ctx(), async () => {
      const exa = await executeExaSearch(searchInput(fetchImpl))
      const tav = await executeTavilySearch(searchInput(fetchImpl))
      const brave = await executeBraveSearch(searchInput(fetchImpl))
      expect(exa.attempt.status).toBe('skipped-unconfigured')
      expect(tav.attempt.errorCode).toBe('TAVILY_BYOK_MISSING')
      expect(brave.attempt.status).toBe('skipped-unconfigured')
      expect(toPublicAttempt(exa.attempt).errorMessage).toMatch(/Composio key/)
    })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('runs Exa through the member Composio project', async () => {
    const calls: Array<{ url: string; init: any }> = []
    const fetchImpl = (async (url: any, init: any) => {
      calls.push({ url: String(url), init })
      if (String(url).includes('/connected_accounts'))
        return Response.json({ items: [{ id: 'ca_1' }] })
      return Response.json({
        successful: true,
        data: {
          results: [
            {
              title: 'Nag Hammadi Library',
              url: 'https://www.gnosis.org/naghamm/nhl.html',
              highlights: ['The Gospel of Thomas.']
            }
          ]
        }
      })
    }) as any
    const out = await runWithByok(
      ctx({ composio: { apiKey: 'ck-member', allowInstant: false } }),
      () => executeExaSearch(searchInput(fetchImpl))
    )
    expect(out.candidates).toHaveLength(1)
    const exec = calls.find(c => c.url.includes('/tools/execute/EXA_SEARCH'))!
    expect(exec.init.headers['x-api-key']).toBe('ck-member')
    expect(JSON.parse(exec.init.body).connected_account_id).toBe('ca_1')
    expect(calls.some(c => JSON.stringify(c.init).includes('acuity-paid'))).toBe(
      false
    )
  })

  it('reports provider readiness per member', () => {
    const none = providerStatusesFor(ctx())
    expect(none.exa.configured).toBe(false)
    expect(none.brave.enabled).toBe(false)
    const withKey = providerStatusesFor(
      ctx({ composio: { apiKey: 'ck', allowInstant: false } })
    )
    expect(withKey.tavily.configured).toBe(true)
  })
})

describe('banner copy', () => {
  it('asks for what is missing, in order', () => {
    const base = {
      required: true,
      signedIn: true,
      llm: false,
      webSearch: false,
      profileUrl: 'https://auth.example/account#ai-keys'
    }
    expect(byokBannerCopy({ ...base, signedIn: false })?.cta).toMatch(/Sign in/)
    expect(byokBannerCopy(base)?.tone).toBe('needed')
    expect(byokBannerCopy({ ...base, llm: true })?.tone).toBe('optional')
    expect(byokBannerCopy({ ...base, llm: true, webSearch: true })).toBeNull()
    expect(
      byokBannerCopy({ required: false, llm: true, webSearch: true, profileUrl: null })
    ).toBeNull()
  })
})
