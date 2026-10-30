import { isSacredTextsAvailable } from '@/lib/acuity/agent/config'
import { getAcuityConfig, getProviderStatuses } from '@/lib/acuity/config'
import { loadDomainRegistry } from '@/lib/acuity/registry'
import { toPublicProviderStatuses } from '@/lib/acuity/search/public-view'
import { getCurrentUser } from '@/lib/auth/get-current-user'

import { AcuitySearchWorkspace } from '@/components/acuity/acuity-search-workspace'
import { toClientRegistryEntries } from '@/components/acuity/acuity-types'

export default async function Page() {
  const registry = loadDomainRegistry()
  const providerStatuses = toPublicProviderStatuses(getProviderStatuses())
  const config = getAcuityConfig()
  const sacredTextsAvailable = isSacredTextsAvailable()
  // Only resolve the session when the tab can show (keeps the page static otherwise).
  const signedIn = sacredTextsAvailable
    ? Boolean(await getCurrentUser().catch(() => null))
    : false

  return (
    <AcuitySearchWorkspace
      topicGroups={registry.topicGroups}
      entries={toClientRegistryEntries(registry.entries)}
      crossCuttingTags={registry.crossCuttingTags}
      providerStatuses={providerStatuses}
      llmConfigured={config.llm.configured}
      sacredTexts={{ available: sacredTextsAvailable, signedIn }}
    />
  )
}
