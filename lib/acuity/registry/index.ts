import fs from 'node:fs'
import path from 'node:path'

import { getAcuityConfig } from '@/lib/acuity/config'
import type {
  CompiledScope,
  ScopePolicy,
  ScopeTargetRule
} from '@/lib/acuity/search/contracts'
import {
  normalizeHostname,
  normalizePathPrefix
} from '@/lib/acuity/search/scope'

export interface RegistryTargetUrl {
  suppliedUrl: string
  normalizedUrl: string
  hostname: string
  includeWwwAlias: boolean
  allowedPathPrefixes: string[]
  protocol: 'http' | 'https'
  pathPrefix?: string
  seedUrl?: string
  referenceUrls?: string[]
}

export type CurationValidationStatus =
  | 'not validated'
  | 'healthy'
  | 'metadata only'
  | 'login required'
  | 'blocked'
  | 'redirected'
  | 'failed'
  | 'not attempted'

export interface RegistryEntryCuration {
  status: string
  validationStatus: CurationValidationStatus
  lastValidatedAt: string | null
  httpStatus: number | null
  finalUrl: string | null
  supportsPathScope: boolean | null
  supportsFullText: boolean | null
  requiresJavaScript: boolean | null
  notes: string | null
}

export interface DomainRegistryEntry {
  id: string
  sourceIndex: number
  topicGroupId: string
  groupIds: string[]
  suppliedCategory: string
  suppliedName: string
  suppliedUrls: string[]
  suppliedFocus: string
  suppliedDescription?: string
  suppliedStrength?: string
  suppliedAccessModel?: string
  targets: RegistryTargetUrl[]
  starterPriority: boolean
  tags: string[]
  curation: RegistryEntryCuration
}

export interface DomainTopicGroup {
  id: string
  number: number
  title: string
  suppliedTitle: string
  slug: string
  description: string
  tags: string[]
  sourceIds: string[]
  entryCount: number
  urlCount: number
}

export interface DomainRegistryDocument {
  schemaVersion: string
  generatedAt: string
  sourceDocument: string
  curationState: string
  summary: {
    topicGroupCount: number
    entryCount: number
    uniqueUrlCount: number
    uniqueHostCount: number
    starterPriorityCount: number
  }
  crossCuttingTags: string[]
  topicGroups: DomainTopicGroup[]
  entries: DomainRegistryEntry[]
  rawSeed?: Record<string, any>
}

let cachedRegistry: DomainRegistryDocument | null = null
let cachedSeedRegistry: DomainRegistryDocument | null = null

function resolveProjectFile(relativePath: string): string {
  if (path.isAbsolute(relativePath)) return relativePath
  return path.join(/*turbopackIgnore: true*/ process.cwd(), relativePath)
}

function normalizeRawRegistry(
  raw: Record<string, any>
): DomainRegistryDocument {
  // If already normalized with topicGroups & entries, ensure groupIds and return
  if (Array.isArray(raw.topicGroups) && Array.isArray(raw.entries)) {
    return raw as DomainRegistryDocument
  }

  const rawGroups: Array<Record<string, any>> = Array.isArray(raw.groups)
    ? raw.groups
    : []
  const rawSources: Array<Record<string, any>> = Array.isArray(raw.sources)
    ? raw.sources
    : []

  const groupTitleById = new Map<string, string>()
  for (const g of rawGroups) {
    groupTitleById.set(String(g.id), String(g.suppliedTitle || g.title || g.id))
  }

  const allTags = new Set<string>()
  const uniqueUrls = new Set<string>()
  const uniqueHosts = new Set<string>()
  let starterPriorityCount = 0

  const entries: DomainRegistryEntry[] = rawSources.map((src, idx) => {
    const groupIds: string[] = Array.isArray(src.groupIds)
      ? src.groupIds.map(String)
      : []
    const primaryGroupId = groupIds[0] || 'gnostic-hermetic'
    const suppliedUrls: string[] = Array.isArray(src.suppliedUrls)
      ? src.suppliedUrls.map(String)
      : []
    for (const u of suppliedUrls) {
      uniqueUrls.add(u)
    }

    const tags: string[] = Array.isArray(src.tags) ? src.tags.map(String) : []
    for (const t of tags) {
      allTags.add(t)
    }

    const starterPriority = Boolean(src.starterPriority)
    if (starterPriority) {
      starterPriorityCount += 1
    }

    const targets: RegistryTargetUrl[] = (
      Array.isArray(src.targets) ? src.targets : []
    ).map((t: Record<string, any>) => {
      const seedUrl = String(t.seedUrl || suppliedUrls[0] || '')
      const pathPrefix = normalizePathPrefix(String(t.pathPrefix || '/'))
      const hostname =
        normalizeHostname(String(t.hostname || '')) || String(t.hostname || '')
      if (hostname) {
        uniqueHosts.add(hostname.replace(/^www\./, ''))
      }
      return {
        suppliedUrl: seedUrl,
        normalizedUrl: seedUrl,
        hostname,
        includeWwwAlias: t.includeWwwAlias !== false,
        allowedPathPrefixes: [pathPrefix],
        protocol: seedUrl.startsWith('http://') ? 'http' : 'https',
        pathPrefix,
        seedUrl,
        referenceUrls: Array.isArray(t.referenceUrls)
          ? t.referenceUrls.map(String)
          : [seedUrl]
      }
    })

    const rawCuration = (src.curation || {}) as Record<string, any>
    const notesArray = Array.isArray(rawCuration.notes)
      ? rawCuration.notes.join('; ')
      : typeof rawCuration.notes === 'string'
        ? rawCuration.notes
        : null

    return {
      id: String(src.id),
      sourceIndex: Number(src.suppliedNumber ?? idx + 1),
      topicGroupId: primaryGroupId,
      groupIds,
      suppliedCategory: groupTitleById.get(primaryGroupId) || primaryGroupId,
      suppliedName: String(src.title || src.suppliedName || src.id),
      suppliedUrls,
      suppliedFocus: [src.suppliedDescription, src.suppliedStrength]
        .filter(Boolean)
        .join(' ')
        .trim(),
      suppliedDescription: src.suppliedDescription,
      suppliedStrength: src.suppliedStrength,
      suppliedAccessModel: src.suppliedAccessModel,
      targets,
      starterPriority,
      tags,
      curation: {
        status: String(rawCuration.status || 'imported-unverified'),
        validationStatus:
          (rawCuration.validationStatus as CurationValidationStatus) ||
          'not validated',
        lastValidatedAt: rawCuration.checkedAt || null,
        httpStatus: rawCuration.httpStatus ?? null,
        finalUrl: rawCuration.finalUrl ?? null,
        supportsPathScope: true,
        supportsFullText: null,
        requiresJavaScript: null,
        notes: notesArray || null
      }
    }
  })

  const topicGroups: DomainTopicGroup[] = rawGroups.map((g, idx) => {
    const id = String(g.id)
    const sourceIds: string[] = Array.isArray(g.sourceIds)
      ? g.sourceIds.map(String)
      : []
    const groupEntries = entries.filter(
      e => e.topicGroupId === id || e.groupIds.includes(id)
    )
    const groupUrls = new Set<string>()
    for (const ge of groupEntries) {
      for (const u of ge.suppliedUrls) {
        groupUrls.add(u)
      }
    }
    const groupTags: string[] = Array.isArray(g.tags) ? g.tags.map(String) : []
    for (const gt of groupTags) {
      allTags.add(gt)
    }

    return {
      id,
      number: idx + 1,
      title: String(g.title || g.suppliedTitle || id),
      suppliedTitle: String(g.suppliedTitle || g.title || id),
      slug: id,
      description: `Curated sources for ${String(g.suppliedTitle || g.title || id)}`,
      tags: groupTags,
      sourceIds,
      entryCount: sourceIds.length || groupEntries.length,
      urlCount: groupUrls.size
    }
  })

  return {
    schemaVersion: String(raw.schemaVersion || 'acuity.search.domains.v1'),
    generatedAt: String(raw.createdAt || raw.generatedAt || '2026-10-25'),
    sourceDocument: String(
      raw.provenance?.file || raw.sourceDocument || 'seed-catalogue'
    ),
    curationState: String(
      raw.status || raw.curationState || 'planning-seed-not-runtime-validation'
    ),
    summary: {
      topicGroupCount: topicGroups.length,
      entryCount: entries.length,
      uniqueUrlCount: uniqueUrls.size,
      uniqueHostCount: uniqueHosts.size,
      starterPriorityCount
    },
    crossCuttingTags: Array.from(allTags).sort(),
    topicGroups,
    entries,
    rawSeed: raw
  }
}

export function loadSeedRegistry(forceReload = false): DomainRegistryDocument {
  if (cachedSeedRegistry && !forceReload) {
    return cachedSeedRegistry
  }
  const config = getAcuityConfig()
  const seedFilePath = resolveProjectFile(config.registrySeedPath)
  const raw = fs.readFileSync(seedFilePath, 'utf-8')
  const parsed = normalizeRawRegistry(JSON.parse(raw))
  cachedSeedRegistry = parsed
  return parsed
}

export function loadDomainRegistry(
  forceReload = false
): DomainRegistryDocument {
  if (cachedRegistry && !forceReload) {
    return cachedRegistry
  }
  const config = getAcuityConfig()
  const runtimePath = resolveProjectFile(config.registryPath)
  const fallbackSeedPath = resolveProjectFile(config.registrySeedPath)

  const fileToRead = fs.existsSync(runtimePath) ? runtimePath : fallbackSeedPath
  const raw = fs.readFileSync(fileToRead, 'utf-8')
  const parsed = normalizeRawRegistry(JSON.parse(raw))
  cachedRegistry = parsed
  return parsed
}

export function clearRegistryCache(): void {
  cachedRegistry = null
  cachedSeedRegistry = null
}

export function getRegistryGroupSummaries(
  registry: DomainRegistryDocument = loadDomainRegistry()
): DomainTopicGroup[] {
  return registry.topicGroups
}

export function validateRegistryIntegrity(
  registry: DomainRegistryDocument = loadDomainRegistry()
): {
  valid: boolean
  errors: string[]
  stats: {
    groupCount: number
    entryCount: number
    urlCount: number
    uniqueHosts: number
    uniqueUrlCount: number
    uniqueHostCount: number
    starterPriorityCount: number
  }
} {
  const errors: string[] = []
  const groupIds = new Set(registry.topicGroups.map(g => g.id))
  const entryIds = new Set<string>()
  const uniqueUrls = new Set<string>()
  const uniqueHosts = new Set<string>()
  let starterPriorityCount = 0

  if (registry.topicGroups.length !== 10) {
    errors.push(
      `Expected 10 topic groups, found ${registry.topicGroups.length}`
    )
  }
  if (registry.entries.length !== 110) {
    errors.push(`Expected 110 entries, found ${registry.entries.length}`)
  }

  for (const entry of registry.entries) {
    if (entryIds.has(entry.id)) {
      errors.push(`Duplicate entry id: ${entry.id}`)
    }
    entryIds.add(entry.id)

    if (!groupIds.has(entry.topicGroupId)) {
      errors.push(
        `Entry ${entry.id} references unknown topicGroupId ${entry.topicGroupId}`
      )
    }

    if (
      !entry.suppliedName ||
      !entry.suppliedFocus ||
      !entry.suppliedCategory
    ) {
      errors.push(`Entry ${entry.id} is missing supplied immutable fields`)
    }

    if (entry.starterPriority) {
      starterPriorityCount += 1
    }

    for (const u of entry.suppliedUrls) {
      uniqueUrls.add(u)
    }

    for (const target of entry.targets) {
      uniqueUrls.add(target.suppliedUrl)
      const normalizedHost = normalizeHostname(target.hostname)
      if (!normalizedHost) {
        errors.push(
          `Entry ${entry.id} has invalid hostname: ${target.hostname}`
        )
      } else {
        uniqueHosts.add(normalizedHost.replace(/^www\./, ''))
      }
    }
  }

  if (uniqueUrls.size !== 146) {
    errors.push(`Expected 146 unique URLs, found ${uniqueUrls.size}`)
  }
  if (uniqueHosts.size !== 117) {
    errors.push(`Expected 117 unique hostnames, found ${uniqueHosts.size}`)
  }
  if (starterPriorityCount < 20) {
    errors.push(
      `Expected at least 20 starterPriority entries, found ${starterPriorityCount}`
    )
  }

  return {
    valid: errors.length === 0,
    errors,
    stats: {
      groupCount: registry.topicGroups.length,
      entryCount: registry.entries.length,
      urlCount: uniqueUrls.size,
      uniqueHosts: uniqueHosts.size,
      uniqueUrlCount: uniqueUrls.size,
      uniqueHostCount: uniqueHosts.size,
      starterPriorityCount
    }
  }
}

export function filterRegistryEntries(options: {
  groupIds?: string[]
  entryIds?: string[]
  tags?: string[]
  starterPriorityOnly?: boolean
  starterOnly?: boolean
  searchQuery?: string
}): DomainRegistryEntry[] {
  const registry = loadDomainRegistry()
  const groupSet =
    options.groupIds && options.groupIds.length > 0
      ? new Set(options.groupIds)
      : null
  const entrySet =
    options.entryIds && options.entryIds.length > 0
      ? new Set(options.entryIds)
      : null
  const tagSet =
    options.tags && options.tags.length > 0
      ? new Set(options.tags.map(t => t.toLowerCase()))
      : null
  const starterFlag = Boolean(
    options.starterPriorityOnly || options.starterOnly
  )
  const q = options.searchQuery?.trim().toLowerCase()

  return registry.entries.filter(entry => {
    if (
      groupSet &&
      !groupSet.has(entry.topicGroupId) &&
      !entry.groupIds.some(gid => groupSet.has(gid))
    ) {
      return false
    }
    if (entrySet && !entrySet.has(entry.id)) return false
    if (starterFlag && !entry.starterPriority) return false
    if (tagSet) {
      const hasMatchingTag = entry.tags.some(t => tagSet.has(t.toLowerCase()))
      if (!hasMatchingTag) return false
    }
    if (q) {
      const haystack = [
        entry.suppliedName,
        entry.suppliedCategory,
        entry.suppliedFocus,
        ...entry.suppliedUrls,
        ...entry.tags
      ]
        .join(' ')
        .toLowerCase()
      if (!haystack.includes(q)) return false
    }
    return true
  })
}

export function compileScopeFromSelection(options: {
  policy: ScopePolicy
  collectionGroupIds?: string[]
  groupIds?: string[]
  entryIds?: string[]
  sourceIds?: string[]
  tags?: string[]
  starterPriorityOnly?: boolean
  includeDomains?: string[]
  includedDomains?: string[]
  excludeDomains?: string[]
  excludedDomains?: string[]
}): CompiledScope {
  const registry = loadDomainRegistry()
  const targets: ScopeTargetRule[] = []
  const seenTargetKeys = new Set<string>()

  const effectiveGroupIds = options.collectionGroupIds ?? options.groupIds
  const effectiveEntryIds = options.entryIds ?? options.sourceIds
  const effectiveIncludeDomains =
    options.includeDomains ?? options.includedDomains
  const effectiveExcludeDomains =
    options.excludeDomains ?? options.excludedDomains

  const hasRegistrySelection =
    (effectiveGroupIds && effectiveGroupIds.length > 0) ||
    (effectiveEntryIds && effectiveEntryIds.length > 0) ||
    (options.tags && options.tags.length > 0) ||
    Boolean(options.starterPriorityOnly)

  const selectedEntries = hasRegistrySelection
    ? filterRegistryEntries({
        groupIds: effectiveGroupIds,
        entryIds: effectiveEntryIds,
        tags: options.tags,
        starterPriorityOnly: options.starterPriorityOnly
      })
    : []

  for (const entry of selectedEntries) {
    for (const target of entry.targets) {
      const hostname = normalizeHostname(target.hostname)
      if (!hostname) continue
      const prefixes = (
        target.allowedPathPrefixes.length > 0
          ? target.allowedPathPrefixes
          : ['/']
      ).map(normalizePathPrefix)

      const key = `${hostname}|${prefixes.join(',')}`
      if (seenTargetKeys.has(key)) continue
      seenTargetKeys.add(key)

      targets.push({
        targetId: `${entry.id}:${hostname}`,
        entryId: entry.id,
        groupId: entry.topicGroupId,
        label: entry.suppliedName,
        hostname,
        includeWwwAlias: target.includeWwwAlias ?? true,
        allowedPathPrefixes: prefixes,
        starterPriority: entry.starterPriority
      })
    }
  }

  for (const rawInclude of effectiveIncludeDomains ?? []) {
    const trimmed = rawInclude.trim()
    if (!trimmed) continue
    let hostCandidate = trimmed
    let pathPrefix = '/'

    if (trimmed.includes('/')) {
      try {
        const parsed = new URL(
          /^[a-z]+:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
        )
        hostCandidate = parsed.hostname
        pathPrefix = normalizePathPrefix(parsed.pathname || '/')
      } catch {
        const slashIdx = trimmed.indexOf('/')
        hostCandidate = trimmed.slice(0, slashIdx)
        pathPrefix = normalizePathPrefix(trimmed.slice(slashIdx))
      }
    }

    const hostname = normalizeHostname(hostCandidate)
    if (!hostname) continue

    const key = `${hostname}|${pathPrefix}`
    if (seenTargetKeys.has(key)) continue
    seenTargetKeys.add(key)

    targets.push({
      targetId: `custom:${hostname}:${pathPrefix}`,
      label: pathPrefix !== '/' ? `${hostname}${pathPrefix}` : hostname,
      hostname,
      includeWwwAlias: true,
      allowedPathPrefixes: [pathPrefix]
    })
  }

  const normalizedExcludes: string[] = []
  const excludePathPrefixes: Array<{ hostname: string; pathPrefix: string }> =
    []

  for (const rawExclude of effectiveExcludeDomains ?? []) {
    const trimmed = rawExclude.trim()
    if (!trimmed) continue
    if (trimmed.includes('/')) {
      try {
        const parsed = new URL(
          /^[a-z]+:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
        )
        const host = normalizeHostname(parsed.hostname)
        const prefix = normalizePathPrefix(parsed.pathname || '/')
        if (host) {
          if (prefix === '/') {
            normalizedExcludes.push(host)
          } else {
            excludePathPrefixes.push({ hostname: host, pathPrefix: prefix })
          }
        }
        continue
      } catch {
        // Fallback below
      }
    }
    const host = normalizeHostname(trimmed)
    if (host) {
      normalizedExcludes.push(host)
    }
  }

  const excludeHostSet = new Set(normalizedExcludes)

  // Exclusions always override inclusions
  const filteredTargets = targets.filter(target => {
    if (excludeHostSet.has(target.hostname)) return false
    const bare = target.hostname.replace(/^www\./, '')
    if (
      excludeHostSet.has(bare) ||
      (target.includeWwwAlias && excludeHostSet.has(`www.${bare}`))
    ) {
      return false
    }
    return true
  })

  const uniqueIncludeDomains = Array.from(
    new Set(filteredTargets.map(t => t.hostname))
  )

  return {
    policy: options.policy,
    targets: filteredTargets,
    includeDomains: uniqueIncludeDomains,
    excludeDomains: Array.from(excludeHostSet),
    excludePathPrefixes,
    registryVersion: `${registry.schemaVersion}@${registry.generatedAt}`
  }
}
