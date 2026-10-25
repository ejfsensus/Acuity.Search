import { NextResponse } from 'next/server'

import {
  filterRegistryEntries,
  loadDomainRegistry
} from '@/lib/acuity/registry'

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const groupIdsParam = searchParams.get('groupIds')
  const tagsParam = searchParams.get('tags')
  const starterOnly = searchParams.get('starterPriorityOnly') === 'true'
  const q = searchParams.get('q') || undefined

  const groupIds = groupIdsParam
    ? groupIdsParam
        .split(',')
        .map(s => s.trim())
        .filter(Boolean)
    : undefined
  const tags = tagsParam
    ? tagsParam
        .split(',')
        .map(s => s.trim())
        .filter(Boolean)
    : undefined

  const registry = loadDomainRegistry()
  const entries = filterRegistryEntries({
    groupIds,
    tags,
    starterPriorityOnly: starterOnly,
    searchQuery: q
  })

  return NextResponse.json({
    schemaVersion: registry.schemaVersion,
    generatedAt: registry.generatedAt,
    curationState: registry.curationState,
    summary: registry.summary,
    crossCuttingTags: registry.crossCuttingTags,
    topicGroups: registry.topicGroups,
    entries
  })
}
