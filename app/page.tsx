import { getAcuityConfig, getProviderStatuses } from '@/lib/acuity/config'
import { loadDomainRegistry } from '@/lib/acuity/registry'
import { toPublicProviderStatuses } from '@/lib/acuity/search/public-view'

import { AcuitySearchWorkspace } from '@/components/acuity/acuity-search-workspace'
import { toClientRegistryEntries } from '@/components/acuity/acuity-types'

export default async function Page() {
  const registry = loadDomainRegistry()
  const providerStatuses = toPublicProviderStatuses(getProviderStatuses())
  const config = getAcuityConfig()

  return (
    <AcuitySearchWorkspace
      topicGroups={registry.topicGroups}
      entries={toClientRegistryEntries(registry.entries)}
      crossCuttingTags={registry.crossCuttingTags}
      providerStatuses={providerStatuses}
      llmConfigured={config.llm.configured}
    />
  )
}
