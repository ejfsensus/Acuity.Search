import {
  getProviderStatuses,
  type ProviderConfigStatus
} from '@/lib/acuity/config'
import type { ProviderId } from '@/lib/acuity/search/contracts'

import type { ByokContext } from './context'

/**
 * Provider readiness as this member sees it. In the open edition SearXNG stays
 * free; Exa and Tavily depend on the member's own Composio key; Brave (which
 * would run on Acuity's key) is switched off.
 */
export function providerStatusesFor(
  ctx: ByokContext | undefined,
  env: Record<string, string | undefined> = process.env
): Record<ProviderId, ProviderConfigStatus> {
  const statuses = getProviderStatuses(env)
  if (!ctx?.required) return statuses
  const hasComposio = Boolean(ctx.credentials.composio)
  const paid = (provider: 'exa' | 'tavily'): ProviderConfigStatus => ({
    provider,
    enabled: true,
    configured: hasComposio,
    status: hasComposio ? 'ready' : 'unconfigured',
    message: hasComposio
      ? 'Runs through your own Composio project.'
      : 'Add your Composio key in your Acuity profile to use this engine.'
  })
  return {
    ...statuses,
    brave: {
      provider: 'brave',
      enabled: false,
      configured: false,
      status: 'unconfigured',
      message: 'Not part of the open edition.'
    },
    exa: paid('exa'),
    tavily: paid('tavily')
  }
}
