'use client'

import React from 'react'

import type { DomainTopicGroup } from '@/lib/acuity/registry'
import type { DiscoveryMode } from '@/lib/acuity/search/contracts'

import type { ClientRegistryEntry } from './acuity-types'

interface AcuityPortalHeroProps {
  mode: DiscoveryMode
  topicGroups: DomainTopicGroup[]
  selectedGroupIds: string[]
  onToggleGroup: (groupId: string) => void
  onSelectExampleQuery: (
    query: string,
    mode: DiscoveryMode,
    groupIds?: string[]
  ) => void
  compact?: boolean
}

export const CURATED_ENQUIRY_PROMPTS: Array<{
  label: string
  category: string
  query: string
  mode: 'general' | 'literature' | 'collections'
  groupIds?: string[]
}> = [
  {
    label: 'Corpus Hermeticum · Copenhaver vs Mead',
    category: 'Literature',
    query: 'Corpus Hermeticum Poimandres Copenhaver Mead translation',
    mode: 'literature'
  },
  {
    label: 'Nag Hammadi · Gospel of Truth',
    category: 'Literature',
    query: 'Nag Hammadi Gospel of Truth Coptic codex translation',
    mode: 'literature'
  },
  {
    label: 'Ibn Arabi · Wahdat al-Wujud',
    category: 'General',
    query: 'wahdat al-wujud Ibn Arabi Fusūs al-Hikam commentary',
    mode: 'general'
  },
  {
    label: 'Stargate Declassified Archives',
    category: 'Topic Specific',
    query: 'Stargate remote viewing declassified memorandum FOIA reading room',
    mode: 'collections',
    groupIds: ['records-foia', 'consciousness']
  }
]

export function AcuityEmblem({ className = 'size-7' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 64 64"
      fill="none"
      aria-hidden="true"
      className={className}
    >
      <polygon
        points="32,4 56,18 56,46 32,60 8,46 8,18"
        stroke="#d4a843"
        strokeWidth="1.75"
        fill="rgba(212, 168, 67, 0.06)"
      />
      <path
        d="M20 46 V28 C20 20 25.4 14 32 14 C38.6 14 44 20 44 28 V46"
        stroke="#e8c96a"
        strokeWidth="1.5"
        fill="rgba(124, 92, 224, 0.12)"
      />
      <circle cx="32" cy="27" r="3.5" fill="#e8c96a" />
      <line
        x1="16"
        y1="46"
        x2="48"
        y2="46"
        stroke="#d4a843"
        strokeWidth="1.5"
      />
    </svg>
  )
}

export function AcuityPortalHero({ compact = false }: AcuityPortalHeroProps) {
  if (compact) {
    return null
  }

  return (
    <section
      aria-label="Acuity.Search Discovery Portal"
      className="relative mx-auto flex w-full max-w-2xl flex-col items-center px-4 pt-8 pb-4 text-center md:pt-14 md:pb-6"
    >
      {/* Subtle Ambient Portal Archway Emblem */}
      <div className="relative mb-5 flex items-center justify-center">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -inset-8 rounded-full bg-[radial-gradient(circle,rgba(212,168,67,0.18)_0%,rgba(124,92,224,0.08)_50%,transparent_75%)] blur-2xl"
        />
        <div className="relative flex size-14 items-center justify-center rounded-full border border-[#35313c]/90 bg-[#111118]/90 shadow-[0_0_40px_rgba(212,168,67,0.12)]">
          <AcuityEmblem className="size-8" />
        </div>
      </div>

      <p className="font-mono text-[12px] uppercase tracking-[0.28em] text-[#d4a843]/90">
        Acuity Institute · Research & Archival Enquiry
      </p>
      <h1 className="mt-2 font-serif text-4xl font-normal tracking-tight text-[#fafafa] sm:text-5xl">
        What would you like to examine?
      </h1>
      <p className="mt-2.5 max-w-lg text-sm leading-relaxed text-[#8e899c]">
        Open enquiry. Wider sources. Traceable answers.
      </p>
    </section>
  )
}

export function TopicDomainScopePanel({
  topicGroups,
  entries,
  selectedGroupIds,
  starterPriorityOnly,
  onToggleGroup,
  onSelectAllGroups,
  onClearScope,
  onToggleStarterPriority
}: {
  topicGroups: DomainTopicGroup[]
  entries: ClientRegistryEntry[]
  selectedGroupIds: string[]
  starterPriorityOnly: boolean
  onToggleGroup: (groupId: string) => void
  onSelectAllGroups: () => void
  onClearScope: () => void
  onToggleStarterPriority: () => void
}) {
  const [inspectSources, setInspectSources] = React.useState(false)

  const activeDomainCount = React.useMemo(() => {
    const filtered = entries.filter(e => {
      if (
        selectedGroupIds.length > 0 &&
        !selectedGroupIds.includes(e.topicGroupId)
      ) {
        return false
      }
      if (starterPriorityOnly && !e.starterPriority) {
        return false
      }
      return true
    })
    return filtered.length
  }, [entries, selectedGroupIds, starterPriorityOnly])

  const visibleEntries = React.useMemo(() => {
    return entries.filter(e => {
      if (
        selectedGroupIds.length > 0 &&
        !selectedGroupIds.includes(e.topicGroupId)
      ) {
        return false
      }
      if (starterPriorityOnly && !e.starterPriority) {
        return false
      }
      return true
    })
  }, [entries, selectedGroupIds, starterPriorityOnly])

  return (
    <div
      aria-label="Topic Specific Domain Scope"
      className="mx-auto mt-3 w-full max-w-3xl rounded-2xl border border-[#35313c]/90 bg-[#111118]/95 p-3.5 shadow-xl transition-all sm:p-4"
    >
      <div className="flex flex-col gap-2.5 pb-3 border-b border-[#35313c]/60 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <span className="size-2 rounded-full bg-[#d4a843]" />
          <span className="font-serif text-base font-medium text-[#fafafa]">
            Topic Collections
          </span>
          <span className="rounded-full border border-[#d4a843]/40 bg-[#d4a843]/10 px-2.5 py-0.5 font-mono text-[12px] text-[#e8c96a]">
            {selectedGroupIds.length === 0
              ? `All 10 topics (${activeDomainCount} repositories)`
              : `${selectedGroupIds.length} topic${selectedGroupIds.length === 1 ? '' : 's'} (${activeDomainCount} repositories)`}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Core 20 Priority Archive Toggle */}
          <button
            type="button"
            onClick={onToggleStarterPriority}
            aria-pressed={starterPriorityOnly}
            className={`inline-flex min-h-11 items-center gap-1.5 rounded-full border px-3 py-1 font-mono text-[12px] transition-colors ${
              starterPriorityOnly
                ? 'border-[#d4a843] bg-[#d4a843]/20 text-[#e8c96a]'
                : 'border-[#35313c] bg-[#09090f] text-[#b3b0bd] hover:border-[#d4a843]/50'
            }`}
          >
            <span
              className={`size-1.5 rounded-full ${
                starterPriorityOnly ? 'bg-[#e8c96a]' : 'bg-[#8e899c]'
              }`}
            />
            Core Archives Only
          </button>

          {selectedGroupIds.length > 0 ? (
            <button
              type="button"
              onClick={onClearScope}
              className="min-h-11 rounded-full border border-[#35313c] bg-[#181820] px-3 py-1 font-mono text-[12px] text-[#b3b0bd] hover:border-[#d4a843] hover:text-[#fafafa] sm:px-2.5"
            >
              All Topics
            </button>
          ) : (
            <button
              type="button"
              onClick={onSelectAllGroups}
              className="min-h-11 rounded-full border border-[#35313c] bg-[#181820] px-3 py-1 font-mono text-[12px] text-[#b3b0bd] hover:border-[#d4a843] hover:text-[#fafafa] sm:px-2.5"
            >
              Select All
            </button>
          )}
        </div>
      </div>

      {/* Clean Responsive 10-Topic Toggle Grid (2-col mobile portrait, 3-col tablet, 5-col desktop) */}
      <div
        role="group"
        aria-label="Topic collections"
        className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5"
      >
        {topicGroups.map(group => {
          const active = selectedGroupIds.includes(group.id)
          return (
            <button
              key={group.id}
              type="button"
              onClick={() => onToggleGroup(group.id)}
              aria-pressed={active}
              className={`group flex min-h-[58px] flex-col justify-between rounded-xl border p-2.5 text-left transition-all ${
                active
                  ? 'border-[#d4a843] bg-[#d4a843]/15 text-[#fafafa] shadow-[0_0_20px_rgba(212,168,67,0.10)]'
                  : 'border-[#35313c]/70 bg-[#09090f]/70 text-[#b3b0bd] hover:border-[#d4a843]/40 hover:bg-[#181820]/60 hover:text-[#fafafa]'
              }`}
            >
              <div className="flex w-full items-center justify-between gap-1">
                <span className="font-mono text-[12px] font-semibold text-[#d4a843]">
                  {String(group.number).padStart(2, '0')}
                </span>
                <span className="font-mono text-[12px] text-[#8e899c]">
                  {group.entryCount} domains
                </span>
              </div>
              <span className="mt-1 line-clamp-2 text-xs font-medium leading-snug">
                {group.suppliedTitle}
              </span>
            </button>
          )
        })}
      </div>

      {/* Collapsible Transparent Domain List Preview */}
      <div className="mt-3 flex flex-col gap-1 pt-2 border-t border-[#35313c]/40 sm:flex-row sm:items-center sm:justify-between">
        <span className="text-[12px] text-[#8e899c]">
          Select topics to focus your search on specific collections.
        </span>
        <button
          type="button"
          onClick={() => setInspectSources(prev => !prev)}
          className="inline-flex min-h-11 items-center self-start font-mono text-[12px] text-[#d4a843] hover:underline sm:self-auto"
        >
          {inspectSources
            ? 'Hide archive list ↑'
            : `Browse ${visibleEntries.length} archives ↓`}
        </button>
      </div>

      {inspectSources && (
        <div className="mt-2.5 grid max-h-48 grid-cols-1 gap-1.5 overflow-y-auto rounded-xl border border-[#35313c]/70 bg-[#09090f]/90 p-2.5 sm:grid-cols-2 md:grid-cols-3">
          {visibleEntries.map(entry => (
            <div
              key={entry.id}
              className="flex flex-col justify-between rounded-lg border border-[#35313c]/50 bg-[#111118] px-2.5 py-1.5"
            >
              <div className="flex items-center justify-between gap-1">
                <span className="truncate text-xs font-medium text-[#fafafa]">
                  {entry.suppliedName}
                </span>
                {entry.starterPriority && (
                  <span className="shrink-0 rounded bg-[#d4a843]/15 px-1.5 py-0.5 font-mono text-[12px] text-[#e8c96a]">
                    Core
                  </span>
                )}
              </div>
              <span className="truncate font-mono text-[12px] text-[#d4a843]/90">
                {entry.hostnames.join(', ')}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
