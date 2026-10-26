import { NextResponse } from 'next/server'

import { validateMultiUserReadiness } from '@/lib/acuity/auth'
import {
  getAcuityConfig,
  getProviderStatuses,
  resolveSearxngUrlEnv,
  validateSearxngUrl
} from '@/lib/acuity/config'
import {
  loadDomainRegistry,
  validateRegistryIntegrity
} from '@/lib/acuity/registry'
import { getCircuitSnapshot } from '@/lib/acuity/search/provider-health'

/** Live check that the SearXNG JSON API answers (opt-in via ?probe=1). */
async function probeSearxngJson(): Promise<{
  ok: boolean
  httpStatus?: number
  contentType?: string
  hint?: string
}> {
  const v = validateSearxngUrl(resolveSearxngUrlEnv())
  if (!v.valid || !v.normalizedUrl) return { ok: false, hint: v.reason }
  try {
    const res = await fetch(
      `${v.normalizedUrl}/search?q=acuity&format=json&categories=general`,
      { signal: AbortSignal.timeout(6000), headers: { Accept: 'application/json' } }
    )
    const contentType = res.headers.get('content-type') || ''
    const ok = res.ok && contentType.includes('json')
    return {
      ok,
      httpStatus: res.status,
      contentType,
      hint: ok
        ? undefined
        : 'Enable json in search.formats of the SearXNG settings.yml (see docs/SEARXNG.md).'
    }
  } catch (error) {
    return {
      ok: false,
      hint: error instanceof Error ? error.message : 'probe failed'
    }
  }
}

export async function GET(req: Request) {
  const wantsProbe = new URL(req.url).searchParams.get('probe') === '1'
  const config = getAcuityConfig()
  const multiUserReadiness = validateMultiUserReadiness()
  const providerStatuses = getProviderStatuses()
  const registry = loadDomainRegistry()
  const registryCheck = validateRegistryIntegrity(registry)

  const healthy = multiUserReadiness.ready && registryCheck.valid

  return NextResponse.json(
    {
      healthy,
      timestamp: new Date().toISOString(),
      multiUserReadiness,
      registry: {
        valid: registryCheck.valid,
        curationState: registry.curationState,
        stats: registryCheck.stats,
        errors: registryCheck.errors
      },
      providers: providerStatuses,
      circuits: {
        searxng: getCircuitSnapshot('searxng'),
        brave: getCircuitSnapshot('brave'),
        tavily: getCircuitSnapshot('tavily'),
        exa: getCircuitSnapshot('exa')
      },
      ...(wantsProbe ? { searxngJsonProbe: await probeSearxngJson() } : {}),
      llm: {
        mode: config.llm.mode,
        configured: config.llm.configured
      },
      privacyDefaults: {
        faviconProviderUrl: config.security.faviconProviderUrl,
        updateCheckDisabled: config.security.updateCheckDisabled,
        fetchAllowPrivateNetwork: config.security.fetchAllowPrivateNetwork
      }
    },
    { status: healthy ? 200 : 503 }
  )
}
