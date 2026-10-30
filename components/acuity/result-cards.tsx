'use client'

import React, { useState } from 'react'

import type { DiscoveryMode, SourceResult } from '@/lib/acuity/search/contracts'

import {
  ACCESS_STATUS_LABELS,
  CONTENT_STATE_LABELS,
  PROVIDER_DISPLAY_NAMES
} from './acuity-types'
import { QualityBadge } from './quality-badge'

interface ResultCardsProps {
  results: SourceResult[]
  citedLabels?: string[]
  mode: DiscoveryMode
  selectedSourceId: string | null
  onSelectSource: (sourceId: string) => void
  readingSurface: 'void' | 'parchment'
}

function ContentStateBadge({ state }: { state: SourceResult['contentState'] }) {
  const spec = CONTENT_STATE_LABELS[state]
  const toneClasses = {
    emerald: 'border-[#4ca771]/50 bg-[#4ca771]/15 text-[#4ca771]',
    gold: 'border-[#d4a843]/50 bg-[#d4a843]/15 text-[#e8c96a]',
    violet: 'border-[#7c5ce0]/50 bg-[#7c5ce0]/15 text-[#b6a2f3]',
    muted: 'border-[#8e899c]/50 bg-[#8e899c]/15 text-[#b3b0bd]',
    danger: 'border-[#d16060]/50 bg-[#d16060]/15 text-[#e58c8c]'
  }[spec.tone]

  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 font-mono text-[12px] ${toneClasses}`}
    >
      {spec.label}
    </span>
  )
}

/**
 * Collapsible Key Sources toggle & card grid displayed directly above the synthesized answer,
 * so the LLM synthesis remains the primary visual focus while key grounding sources are one click away.
 */
export function CitedSourceRibbon({
  results,
  citedLabels,
  selectedSourceId,
  onSelectSource
}: {
  results: SourceResult[]
  citedLabels: string[]
  selectedSourceId: string | null
  onSelectSource: (sourceId: string) => void
}) {
  const [open, setOpen] = useState(false)
  const citedSet = new Set(citedLabels)
  const prioritized = [
    ...results.filter(r => citedSet.has(r.citationLabel)),
    ...results.filter(r => !citedSet.has(r.citationLabel))
  ].slice(0, 6)

  if (prioritized.length === 0) return null

  const uniqueHosts = Array.from(
    new Set(prioritized.map(r => r.hostname.replace(/^www\./, '')))
  ).slice(0, 3)

  return (
    <div className="w-full">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => setOpen(prev => !prev)}
          aria-expanded={open}
          className="inline-flex items-center gap-2 rounded-full border border-[#35313c] bg-[#111118] px-3.5 py-1.5 font-mono text-xs text-[#fafafa] transition-colors hover:border-[#d4a843] hover:text-[#e8c96a]"
        >
          <span className="size-1.5 rounded-full bg-[#d4a843]" />
          <span>
            {open ? 'Hide Key Sources' : 'Show Key Sources'} (
            {citedLabels.length > 0
              ? `${citedLabels.length} cited`
              : `${prioritized.length} top`}
            )
          </span>
          <span className="hidden text-[#8e899c] sm:inline">
            · {uniqueHosts.join(', ')}
          </span>
          <span className="text-[#d4a843]">{open ? '↑' : '↓'}</span>
        </button>

        {open && (
          <span className="font-mono text-[12px] text-[#8e899c]">
            Click any source to view excerpt →
          </span>
        )}
      </div>

      {open && (
        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {prioritized.map(src => {
            const isSelected = selectedSourceId === src.id
            const isCited = citedSet.has(src.citationLabel)
            const providers = Array.from(
              new Set(src.provenance.map(p => p.provider))
            )
            return (
              <div
                key={src.id}
                role="button"
                tabIndex={0}
                onClick={() => onSelectSource(src.id)}
                onKeyDown={e => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    onSelectSource(src.id)
                  }
                }}
                className={`group flex flex-col justify-between rounded-xl border p-2.5 text-left transition-all ${
                  isSelected
                    ? 'border-[#d4a843] bg-[#d4a843]/15 shadow-[0_0_20px_rgba(212,168,67,0.12)]'
                    : 'border-[#35313c]/80 bg-[#181820]/75 hover:border-[#d4a843]/50 hover:bg-[#181820]'
                }`}
              >
                <div className="flex items-center justify-between gap-1.5">
                  <div className="flex items-center gap-1.5 truncate">
                    <span
                      className={`shrink-0 rounded px-1.5 py-0.5 font-mono text-[12px] font-semibold ${
                        isCited
                          ? 'bg-[#d4a843] text-[#09090f]'
                          : 'border border-[#d4a843]/50 bg-[#d4a843]/10 text-[#e8c96a]'
                      }`}
                    >
                      {src.citationLabel}
                    </span>
                    <span className="truncate font-mono text-[12px] text-[#d4a843]">
                      {src.hostname}
                    </span>
                  </div>
                  <a
                    href={src.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={e => e.stopPropagation()}
                    title="Open source in new tab"
                    className="shrink-0 font-mono text-[12px] text-[#8e899c] hover:text-[#e8c96a]"
                  >
                    ↗
                  </a>
                </div>

                <div className="mt-1.5 line-clamp-2 font-serif text-sm font-medium leading-snug text-[#fafafa] group-hover:text-[#e8c96a]">
                  {src.title}
                </div>

                <div className="mt-2 flex items-center justify-between gap-1 border-t border-[#35313c]/40 pt-1.5 font-mono text-[12px] text-[#8e899c]">
                  <span className="truncate">
                    {[
                      ...providers.map(p => PROVIDER_DISPLAY_NAMES[p]),
                      src.passage?.tradition,
                      src.passage?.verbatim ? 'Quoted verbatim' : undefined
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                  <span className="shrink-0 text-[#b3b0bd]">
                    {CONTENT_STATE_LABELS[src.contentState].label}
                  </span>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function SingleResultCard({
  result,
  isCited,
  mode,
  isSelected,
  onSelect,
  readingSurface
}: {
  result: SourceResult
  isCited: boolean
  mode: DiscoveryMode
  isSelected: boolean
  onSelect: () => void
  readingSurface: 'void' | 'parchment'
}) {
  const isParchment = readingSurface === 'parchment'
  const providers = Array.from(new Set(result.provenance.map(p => p.provider)))

  return (
    <article
      onClick={onSelect}
      className={`group flex flex-col justify-between rounded-2xl border p-3.5 transition-all focus-visible:outline-2 focus-visible:outline-[#d4a843] ${
        isParchment
          ? isSelected
            ? 'border-[#9e741f] bg-[#efe7d3] text-[#27241c]'
            : 'border-[#d3c7ad] bg-[#f4efe2] text-[#27241c] hover:border-[#9e741f]'
          : isSelected
            ? 'border-[#d4a843] bg-[#181820] text-[#fafafa] shadow-[0_0_24px_rgba(212,168,67,0.12)]'
            : 'border-[#35313c]/80 bg-[#111118]/95 text-[#fafafa] hover:border-[#d4a843]/50 hover:bg-[#181820]/85'
      }`}
    >
      <div>
        <div className="flex flex-wrap items-center justify-between gap-1.5">
          <div className="flex flex-wrap items-center gap-1.5">
            <span
              className={`rounded-md px-1.5 py-0.5 font-mono text-[12px] font-semibold ${
                isCited
                  ? 'bg-[#d4a843] text-[#09090f]'
                  : 'border border-[#d4a843]/50 bg-[#d4a843]/15 text-[#e8c96a]'
              }`}
            >
              [{result.citationLabel}]
            </span>
            <span className="truncate font-mono text-xs text-[#d4a843]">
              {result.hostname}
            </span>
            {result.lane === 'collection' && (
              <span className="rounded-full border border-[#7c5ce0]/50 bg-[#7c5ce0]/15 px-2 py-0.5 font-mono text-[12px] text-[#c7b8f5]">
                Verified Archive
              </span>
            )}
          </div>

          <div className="flex items-center gap-1.5">
            <QualityBadge tier={result.qualityTier} />
            <ContentStateBadge state={result.contentState} />
          </div>
        </div>

        {/* Title & Direct External Link */}
        <h3 className="mt-2 line-clamp-2 font-serif text-base font-medium leading-snug">
          <a
            href={result.url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={e => e.stopPropagation()}
            className="underline-offset-4 hover:text-[#e8c96a] hover:underline"
          >
            {result.title}
          </a>
        </h3>

        {/* Literature Work / Edition Metadata Bar */}
        {(mode === 'literature' || result.literature) && result.literature && (
          <div className="mt-2 flex flex-wrap items-center gap-x-2.5 gap-y-1 rounded-lg border border-[#35313c]/60 bg-[#09090f]/60 px-2.5 py-1 font-mono text-[12px] text-[#b3b0bd]">
            <span>{result.literature.format}</span>
            {result.literature.translator && (
              <span>
                <strong className="text-[#d4a843]">Trans:</strong>{' '}
                {result.literature.translator}
              </span>
            )}
            {result.literature.editionOrYear && (
              <span>
                <strong className="text-[#d4a843]">Year:</strong>{' '}
                {result.literature.editionOrYear}
              </span>
            )}
          </div>
        )}

        {/* Concise Clamped Snippet */}
        {result.snippet && (
          <p
            className={`mt-2 line-clamp-2 text-xs leading-relaxed ${
              isParchment ? 'text-[#3c372b]' : 'text-[#b3b0bd]'
            }`}
          >
            {result.snippet}
          </p>
        )}
      </div>

      {/* Provenance Footer */}
      <div className="mt-3 flex items-center justify-between gap-2 border-t border-[#35313c]/40 pt-2 font-mono text-[12px] text-[#8e899c]">
        <div className="flex flex-wrap items-center gap-1">
          {providers.map(prov => (
            <span
              key={prov}
              className="rounded border border-[#35313c] bg-[#09090f]/80 px-1.5 py-0.5 text-[12px] text-[#b3b0bd]"
            >
              {PROVIDER_DISPLAY_NAMES[prov]}
            </span>
          ))}
          <span className="ml-1 text-[#8e899c]">
            {ACCESS_STATUS_LABELS[result.accessStatus]}
          </span>
        </div>
        <button
          type="button"
          onClick={e => {
            e.stopPropagation()
            onSelect()
          }}
          aria-label={`View excerpt for ${result.citationLabel}: ${result.title}`}
          className="inline-flex min-h-11 shrink-0 items-center text-[#d4a843] group-hover:underline"
        >
          View excerpt →
        </button>
      </div>
    </article>
  )
}

export function ResultCardsList({
  results,
  citedLabels = [],
  mode,
  selectedSourceId,
  onSelectSource,
  readingSurface
}: ResultCardsProps) {
  const [filterTab, setFilterTab] = useState<'cited' | 'all' | 'collection'>(
    citedLabels.length > 0 ? 'cited' : 'all'
  )
  const [expanded, setExpanded] = useState(false)

  if (results.length === 0) {
    return (
      <div className="rounded-2xl border border-[#35313c] bg-[#111118] p-6 text-center">
        <p className="font-serif text-lg text-[#fafafa]">
          No sources matched this enquiry under the active scope.
        </p>
        <p className="mt-1 text-xs text-[#8e899c]">
          Check your selected topics or switch back to General mode for broader
          results.
        </p>
      </div>
    )
  }

  const citedSet = new Set(citedLabels)
  const citedResults = results.filter(r => citedSet.has(r.citationLabel))
  const collectionResults = results.filter(r => r.lane === 'collection')

  const activeTab =
    filterTab === 'cited' && citedResults.length === 0 ? 'all' : filterTab

  const filteredList =
    activeTab === 'cited'
      ? citedResults
      : activeTab === 'collection'
        ? collectionResults
        : results

  const INITIAL_VISIBLE = 8
  const displayedResults = expanded
    ? filteredList
    : filteredList.slice(0, INITIAL_VISIBLE)
  const hiddenCount = Math.max(0, filteredList.length - displayedResults.length)

  return (
    <div className="flex flex-col gap-3.5">
      {/* Clean Filter Tabs for Source Visibility */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1 rounded-full border border-[#35313c] bg-[#111118] p-1">
          {citedResults.length > 0 && (
            <button
              type="button"
              onClick={() => {
                setFilterTab('cited')
                setExpanded(false)
              }}
              className={`rounded-full px-3 py-1 font-mono text-[12px] transition-colors ${
                activeTab === 'cited'
                  ? 'bg-[#d4a843] font-semibold text-[#09090f]'
                  : 'text-[#b3b0bd] hover:text-[#fafafa]'
              }`}
            >
              Cited in Answer ({citedResults.length})
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              setFilterTab('all')
              setExpanded(false)
            }}
            className={`rounded-full px-3 py-1 font-mono text-[12px] transition-colors ${
              activeTab === 'all'
                ? 'bg-[#d4a843] font-semibold text-[#09090f]'
                : 'text-[#b3b0bd] hover:text-[#fafafa]'
            }`}
          >
            All Retrieved ({results.length})
          </button>
          {collectionResults.length > 0 && (
            <button
              type="button"
              onClick={() => {
                setFilterTab('collection')
                setExpanded(false)
              }}
              className={`rounded-full px-3 py-1 font-mono text-[12px] transition-colors ${
                activeTab === 'collection'
                  ? 'bg-[#d4a843] font-semibold text-[#09090f]'
                  : 'text-[#b3b0bd] hover:text-[#fafafa]'
              }`}
            >
              Curated Archives ({collectionResults.length})
            </button>
          )}
        </div>
      </div>

      {/* 2-Column Scannable Source Grid */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {displayedResults.map(result => (
          <SingleResultCard
            key={result.id}
            result={result}
            isCited={citedSet.has(result.citationLabel)}
            mode={mode}
            isSelected={selectedSourceId === result.id}
            onSelect={() => onSelectSource(result.id)}
            readingSurface={readingSurface}
          />
        ))}
      </div>

      {/* Progressive Disclosure Button */}
      {(hiddenCount > 0 || expanded) &&
        filteredList.length > INITIAL_VISIBLE && (
          <div className="flex justify-center pt-1">
            <button
              type="button"
              onClick={() => setExpanded(prev => !prev)}
              className="rounded-full border border-[#35313c] bg-[#111118] px-4 py-1.5 font-mono text-xs text-[#b3b0bd] transition-colors hover:border-[#d4a843] hover:text-[#e8c96a]"
            >
              {expanded
                ? 'Show fewer sources ↑'
                : `View ${hiddenCount} more retrieved sources ↓`}
            </button>
          </div>
        )}
    </div>
  )
}
