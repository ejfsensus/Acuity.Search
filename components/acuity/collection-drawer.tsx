'use client'

import React, { useMemo, useState } from 'react'

import type {
  DomainRegistryEntry,
  DomainTopicGroup
} from '@/lib/acuity/registry'

interface CollectionDrawerProps {
  topicGroups: DomainTopicGroup[]
  entries: DomainRegistryEntry[]
  crossCuttingTags: string[]
  selectedGroupIds: string[]
  selectedEntryIds: string[]
  selectedTags: string[]
  starterPriorityOnly: boolean
  customIncludeDomains: string
  customExcludeDomains: string
  onToggleGroup: (groupId: string) => void
  onToggleEntry: (entryId: string) => void
  onToggleTag: (tag: string) => void
  onToggleStarterPriority: () => void
  onChangeCustomInclude: (val: string) => void
  onChangeCustomExclude: (val: string) => void
  onClearAllScope: () => void
}

export function CollectionDrawer({
  topicGroups,
  entries,
  crossCuttingTags,
  selectedGroupIds,
  selectedEntryIds,
  selectedTags,
  starterPriorityOnly,
  customIncludeDomains,
  customExcludeDomains,
  onToggleGroup,
  onToggleEntry,
  onToggleTag,
  onToggleStarterPriority,
  onChangeCustomInclude,
  onChangeCustomExclude,
  onClearAllScope
}: CollectionDrawerProps) {
  const [filterText, setFilterText] = useState('')

  const filteredEntries = useMemo(() => {
    const q = filterText.trim().toLowerCase()
    return entries.filter(entry => {
      if (
        selectedGroupIds.length > 0 &&
        !selectedGroupIds.includes(entry.topicGroupId)
      ) {
        return false
      }
      if (starterPriorityOnly && !entry.starterPriority) {
        return false
      }
      if (selectedTags.length > 0) {
        const lowerTags = entry.tags.map(t => t.toLowerCase())
        if (!selectedTags.some(t => lowerTags.includes(t.toLowerCase()))) {
          return false
        }
      }
      if (q) {
        const hay =
          `${entry.suppliedName} ${entry.suppliedCategory} ${entry.suppliedFocus} ${entry.suppliedUrls.join(' ')}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [entries, filterText, selectedGroupIds, starterPriorityOnly, selectedTags])

  return (
    <div className="flex h-full flex-col gap-3 overflow-y-auto p-3 text-xs text-[#fafafa]">
      <div className="flex items-center justify-between border-b border-[#35313c] pb-2">
        <div>
          <h3 className="font-serif text-base font-medium text-[#fafafa]">
            Domain Registry & Collections
          </h3>
          <p className="font-mono text-[11px] text-[#8e899c]">
            110 seed repositories · 10 collections · 146 URLs
          </p>
        </div>
        <button
          type="button"
          onClick={onClearAllScope}
          className="rounded-lg border border-[#35313c] bg-[#181820] px-2 py-1 font-mono text-[11px] text-[#b3b0bd] hover:border-[#d4a843] hover:text-[#e8c96a]"
        >
          Reset Scope
        </button>
      </div>

      {/* Starter Priority Toggle */}
      <div className="flex items-center justify-between rounded-xl border border-[#35313c] bg-[#181820] px-3 py-2">
        <div>
          <div className="font-medium text-[#e8c96a]">
            Starter Priority Sources (20)
          </div>
          <div className="text-[11px] text-[#8e899c]">
            High-value open archives & primary text collections
          </div>
        </div>
        <input
          type="checkbox"
          aria-label="Filter to 20 starter priority sources"
          checked={starterPriorityOnly}
          onChange={onToggleStarterPriority}
          className="size-4 accent-[#d4a843]"
        />
      </div>

      {/* Cross-cutting tags */}
      <div>
        <div className="mb-1.5 font-mono text-[11px] uppercase tracking-wider text-[#8e899c]">
          Tradition & Evidence Tags
        </div>
        <div className="flex flex-wrap gap-1">
          {crossCuttingTags.map(tag => {
            const active = selectedTags.includes(tag)
            return (
              <button
                key={tag}
                type="button"
                onClick={() => onToggleTag(tag)}
                aria-pressed={active}
                className={`rounded-full border px-2 py-0.5 text-[11px] transition-colors ${
                  active
                    ? 'border-[#d4a843] bg-[#d4a843]/20 text-[#e8c96a]'
                    : 'border-[#35313c] bg-[#111118] text-[#b3b0bd] hover:border-[#d4a843]/50'
                }`}
              >
                {tag}
              </button>
            )
          })}
        </div>
      </div>

      {/* Custom Domain Include / Exclude Controls */}
      <div className="grid grid-cols-1 gap-2 rounded-xl border border-[#35313c] bg-[#181820]/70 p-2.5">
        <label className="flex flex-col gap-1">
          <span className="font-mono text-[11px] text-[#b3b0bd]">
            Include Domains / Paths (comma-separated)
          </span>
          <input
            type="text"
            value={customIncludeDomains}
            onChange={e => onChangeCustomInclude(e.target.value)}
            placeholder="e.g. gnosis.org, sacred-texts.com"
            className="rounded-lg border border-[#35313c] bg-[#09090f] px-2.5 py-1.5 font-mono text-xs text-[#fafafa] placeholder:text-[#8e899c] focus:border-[#d4a843] focus:outline-none"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-mono text-[11px] text-[#b3b0bd]">
            Exclude Domains / Paths (overrides inclusions)
          </span>
          <input
            type="text"
            value={customExcludeDomains}
            onChange={e => onChangeCustomExclude(e.target.value)}
            placeholder="e.g. pinterest.com, example.com"
            className="rounded-lg border border-[#35313c] bg-[#09090f] px-2.5 py-1.5 font-mono text-xs text-[#fafafa] placeholder:text-[#8e899c] focus:border-[#d4a843] focus:outline-none"
          />
        </label>
      </div>

      {/* Topic Group Filter Chips */}
      <div>
        <div className="mb-1.5 font-mono text-[11px] uppercase tracking-wider text-[#8e899c]">
          10 Thematic Groups
        </div>
        <div className="flex flex-col gap-1">
          {topicGroups.map(group => {
            const active = selectedGroupIds.includes(group.id)
            return (
              <button
                key={group.id}
                type="button"
                onClick={() => onToggleGroup(group.id)}
                aria-pressed={active}
                className={`flex items-center justify-between rounded-lg border px-2.5 py-1.5 text-left transition-colors ${
                  active
                    ? 'border-[#d4a843] bg-[#d4a843]/15 text-[#fafafa]'
                    : 'border-[#35313c]/70 bg-[#111118] text-[#b3b0bd] hover:border-[#d4a843]/40'
                }`}
              >
                <span className="truncate pr-2">
                  <span className="mr-1.5 font-mono text-[10px] text-[#d4a843]">
                    {String(group.number).padStart(2, '0')}
                  </span>
                  {group.suppliedTitle}
                </span>
                <span className="shrink-0 font-mono text-[10px] text-[#8e899c]">
                  {group.entryCount}
                </span>
              </button>
            )
          })}
        </div>
      </div>

      {/* Search & Select Individual Registry Entries */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <span className="font-mono text-[11px] uppercase tracking-wider text-[#8e899c]">
            Sources ({filteredEntries.length} of {entries.length})
          </span>
          {selectedEntryIds.length > 0 && (
            <span className="font-mono text-[11px] text-[#e8c96a]">
              {selectedEntryIds.length} pinned
            </span>
          )}
        </div>
        <input
          type="search"
          value={filterText}
          onChange={e => setFilterText(e.target.value)}
          placeholder="Filter 110 sources by name, focus, or URL..."
          aria-label="Filter registry sources"
          className="rounded-lg border border-[#35313c] bg-[#09090f] px-2.5 py-1.5 text-xs text-[#fafafa] placeholder:text-[#8e899c] focus:border-[#d4a843] focus:outline-none"
        />

        <div className="flex max-h-72 flex-col gap-1.5 overflow-y-auto pr-1">
          {filteredEntries.map(entry => {
            const selected = selectedEntryIds.includes(entry.id)
            const hosts = entry.targets.map(t => t.hostname).join(', ')
            return (
              <div
                key={entry.id}
                onClick={() => onToggleEntry(entry.id)}
                role="button"
                tabIndex={0}
                onKeyDown={e => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    onToggleEntry(entry.id)
                  }
                }}
                aria-pressed={selected}
                className={`cursor-pointer rounded-xl border p-2.5 transition-colors ${
                  selected
                    ? 'border-[#d4a843] bg-[#d4a843]/15'
                    : 'border-[#35313c]/80 bg-[#181820]/60 hover:border-[#d4a843]/40'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="font-medium text-[#fafafa]">
                    {entry.suppliedName}
                  </span>
                  <div className="flex shrink-0 items-center gap-1">
                    {entry.starterPriority && (
                      <span className="rounded border border-[#d4a843]/50 bg-[#d4a843]/10 px-1.5 py-0.5 font-mono text-[9px] text-[#e8c96a]">
                        Priority
                      </span>
                    )}
                    <span className="rounded border border-[#35313c] bg-[#111118] px-1.5 py-0.5 font-mono text-[9px] text-[#8e899c]">
                      {entry.curation.validationStatus}
                    </span>
                  </div>
                </div>
                <div className="mt-1 font-mono text-[10px] text-[#d4a843]">
                  {hosts}
                </div>
                <p className="mt-1 line-clamp-2 text-[11px] text-[#b3b0bd]">
                  {entry.suppliedFocus}
                </p>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
