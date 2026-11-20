import { cookies } from 'next/headers'
import { notFound } from 'next/navigation'

import { isSacredTextsAvailable } from '@/lib/acuity/agent/config'
import { buildByokContext, byokPublicStatus } from '@/lib/acuity/byok/context'
import { providerStatusesFor } from '@/lib/acuity/byok/status'
import { getAcuityConfig } from '@/lib/acuity/config'
import {
  EMBED_SESSION_COOKIE_NAME,
  embedAllowedOrigins,
  isEmbedEnabled,
  verifyEmbedSession
} from '@/lib/acuity/embed'
import { loadDomainRegistry } from '@/lib/acuity/registry'
import { toPublicProviderStatuses } from '@/lib/acuity/search/public-view'

import { AcuitySearchWorkspace } from '@/components/acuity/acuity-search-workspace'
import { toClientRegistryEntries } from '@/components/acuity/acuity-types'

export const dynamic = 'force-dynamic'

export default async function EmbedPage() {
  if (!isEmbedEnabled()) notFound()
  const jar = await cookies()
  const session = verifyEmbedSession(jar.get(EMBED_SESSION_COOKIE_NAME)?.value)
  if (!session) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#0f0f14] p-6 font-mono text-sm text-[#b3b0bd]">
        <p role="alert">Session expired. Open Search from Codex again.</p>
      </main>
    )
  }
  const registry = loadDomainRegistry()
  const config = getAcuityConfig()
  const byok = await buildByokContext(
    session.email ? { email: session.email } : null
  )
  const byokStatus = byokPublicStatus(byok)
  return (
    <AcuitySearchWorkspace
      topicGroups={registry.topicGroups}
      entries={toClientRegistryEntries(registry.entries)}
      crossCuttingTags={registry.crossCuttingTags}
      providerStatuses={toPublicProviderStatuses(providerStatusesFor(byok))}
      llmConfigured={
        byokStatus.required ? byokStatus.llm : config.llm.configured
      }
      byok={byokStatus}
      sacredTexts={{ available: isSacredTextsAvailable(), signedIn: true }}
      embed={{
        target: session.ctx,
        parentOrigin: embedAllowedOrigins()[0] ?? null
      }}
    />
  )
}
