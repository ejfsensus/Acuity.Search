import { isSacredTextsAvailable } from '@/lib/acuity/agent/config'
import { isByokRequired } from '@/lib/acuity/byok/config'
import { buildByokContext, byokPublicStatus } from '@/lib/acuity/byok/context'
import { providerStatusesFor } from '@/lib/acuity/byok/status'
import { getAcuityConfig } from '@/lib/acuity/config'
import { loadDomainRegistry } from '@/lib/acuity/registry'
import { toPublicProviderStatuses } from '@/lib/acuity/search/public-view'
import { getCurrentUser } from '@/lib/auth/get-current-user'

import { AcuitySearchWorkspace } from '@/components/acuity/acuity-search-workspace'
import { toClientRegistryEntries } from '@/components/acuity/acuity-types'

// Rendered per request: the Sacred Texts tab depends on runtime env and the
// reader's session (a build-time prerender would freeze it off).
export const dynamic = 'force-dynamic'

export default async function Page() {
  const registry = loadDomainRegistry()
  const config = getAcuityConfig()
  const sacredTextsAvailable = isSacredTextsAvailable()
  const byokRequired = isByokRequired()
  // Only resolve the session when it matters (keeps the page static otherwise).
  const user =
    sacredTextsAvailable || byokRequired
      ? await getCurrentUser().catch(() => null)
      : null
  const signedIn = Boolean(user)
  const byok = await buildByokContext(user?.email ? { email: user.email } : null)
  const byokStatus = byokPublicStatus(byok)
  const providerStatuses = toPublicProviderStatuses(providerStatusesFor(byok))

  return (
    <AcuitySearchWorkspace
      topicGroups={registry.topicGroups}
      entries={toClientRegistryEntries(registry.entries)}
      crossCuttingTags={registry.crossCuttingTags}
      providerStatuses={providerStatuses}
      llmConfigured={
        byokStatus.required ? byokStatus.llm : config.llm.configured
      }
      byok={byokStatus}
      sacredTexts={{ available: sacredTextsAvailable, signedIn }}
    />
  )
}
