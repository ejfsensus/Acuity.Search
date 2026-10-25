import { NextResponse } from 'next/server'

import { validateMultiUserReadiness } from '@/lib/acuity/auth'
import { getAcuityConfig, getProviderStatuses } from '@/lib/acuity/config'
import {
  loadDomainRegistry,
  validateRegistryIntegrity
} from '@/lib/acuity/registry'

export async function GET() {
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
