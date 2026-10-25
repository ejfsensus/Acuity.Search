import { getAcuityConfig, getProviderStatuses } from '@/lib/acuity/config'
import { loadDomainRegistry } from '@/lib/acuity/registry'

import { AcuitySearchWorkspace } from '@/components/acuity/acuity-search-workspace'

export default async function Page() {
  const registry = loadDomainRegistry()
  const providerStatuses = getProviderStatuses()
  const config = getAcuityConfig()

  return (
    <AcuitySearchWorkspace
      topicGroups={registry.topicGroups}
      entries={registry.entries}
      crossCuttingTags={registry.crossCuttingTags}
      providerStatuses={providerStatuses}
      llmMode={config.llm.mode}
      llmConfigured={config.llm.configured}
    />
  )
}
