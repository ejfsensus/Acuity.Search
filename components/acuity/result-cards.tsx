'use client'

import React from 'react'

import type { DiscoveryMode, SourceResult } from '@/lib/acuity/search/contracts'

import {
  ACCESS_STATUS_LABELS,
  CONTENT_STATE_LABELS,
  PROVIDER_DISPLAY_NAMES
} from './acuity-types'

interface ResultCardsProps {
  results: SourceResult[]
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
      className={`inline-flex items-center rounded-full border px-2 py-0.5 font-mono text-[10px] ${toneClasses}`}
    >
      {spec.label}
    </span>
  )
}

function SingleResultCard({
  result,
  mode,
  isSelected,
  onSelect,
  readingSurface
}: {
  result: SourceResult
  mode: DiscoveryMode
  isSelected: boolean
  onSelect: () => void
  readingSurface: 'void' | 'parchment'
}) {
  const isParchment = readingSurface === 'parchment'
  const providers = Array.from(new Set(result.provenance.map(p => p.provider)))
  const searxEngines = Array.from(
    new Set(result.provenance.flatMap(p => p.engines || []))
  )

  return (
    <article
      onClick={onSelect}
      role="button"
      tabIndex={0}
      onKeyDown={e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onSelect()
        }
      }}
      className={`group rounded-2xl border p-3.5 transition-all focus-visible:outline-2 focus-visible:outline-[#d4a843] ${
        isParchment
          ? isSelected
            ? 'border-[#9e741f] bg-[#efe7d3] text-[#27241c]'
            : 'border-[#d3c7ad] bg-[#f4efe2] text-[#27241c] hover:border-[#9e741f]'
          : isSelected
            ? 'border-[#d4a843] bg-[#181820] text-[#fafafa] shadow-[0_0_24px_rgba(212,168,67,0.12)]'
            : 'border-[#35313c] bg-[#111118]/95 text-[#fafafa] hover:border-[#d4a843]/60 hover:bg-[#181820]/90'
      }`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="rounded-md border border-[#d4a843]/60 bg-[#d4a843]/15 px-1.5 py-0.5 font-mono text-xs font-semibold text-[#e8c96a]">
            [{result.citationLabel}]
          </span>
          <span className="font-mono text-xs text-[#d4a843]">
            {result.hostname}
          </span>
          {result.lane === 'collection' && (
            <span className="rounded-full border border-[#7c5ce0]/50 bg-[#7c5ce0]/15 px-2 py-0.5 font-mono text-[10px] text-[#c7b8f5]">
              Curated Collection
            </span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <ContentStateBadge state={result.contentState} />
          <span className="rounded-full border border-[#35313c] px-2 py-0.5 font-mono text-[10px] text-[#8e899c]">
            {ACCESS_STATUS_LABELS[result.accessStatus]}
          </span>
        </div>
      </div>

      {/* Title & Direct External Link */}
      <div className="mt-2 flex items-start justify-between gap-3">
        <h3 className="font-serif text-lg font-medium leading-snug">
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
      </div>

      {/* Literature Work / Edition Metadata Bar */}
      {(mode === 'literature' || result.literature) && result.literature && (
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-[#35313c]/70 bg-[#09090f]/50 px-3 py-1.5 font-mono text-[11px] text-[#b3b0bd]">
          <span>
            <strong className="text-[#d4a843]">Format:</strong>{' '}
            {result.literature.format}
          </span>
          {result.literature.author && (
            <span>
              <strong className="text-[#d4a843]">Author:</strong>{' '}
              {result.literature.author}
            </span>
          )}
          {result.literature.translator && (
            <span>
              <strong className="text-[#d4a843]">Translator:</strong>{' '}
              {result.literature.translator}
            </span>
          )}
          {result.literature.editionOrYear && (
            <span>
              <strong className="text-[#d4a843]">Edition/Year:</strong>{' '}
              {result.literature.editionOrYear}
            </span>
          )}
          <span>
            <strong className="text-[#d4a843]">Holding:</strong>{' '}
            {result.literature.holdingInstitutionOrDomain}
          </span>
        </div>
      )}

      {/* Snippet */}
      {result.snippet && (
        <p
          className={`mt-2 text-sm leading-relaxed ${
            isParchment ? 'text-[#3c372b]' : 'text-[#b3b0bd]'
          }`}
        >
          {result.snippet}
        </p>
      )}

      {/* Provenance Footer */}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-[#35313c]/50 pt-2 font-mono text-[11px] text-[#8e899c]">
        <div className="flex flex-wrap items-center gap-1.5">
          <span>Providers:</span>
          {providers.map(prov => (
            <span
              key={prov}
              className="rounded border border-[#35313c] bg-[#09090f]/70 px-1.5 py-0.5 text-[10px] text-[#fafafa]"
            >
              {PROVIDER_DISPLAY_NAMES[prov]}
            </span>
          ))}
          {searxEngines.length > 0 && (
            <span className="text-[10px] text-[#b3b0bd]">
              (engines: {searxEngines.join(', ')})
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          <span>RRF {result.rrfScore.toFixed(4)}</span>
          {result.publishedDate && <span>{result.publishedDate}</span>}
          <span className="text-[#d4a843] group-hover:underline">
            Inspect evidence →
          </span>
        </div>
      </div>
    </article>
  )
}

export function ResultCardsList({
  results,
  mode,
  selectedSourceId,
  onSelectSource,
  readingSurface
}: ResultCardsProps) {
  if (results.length === 0) {
    return (
      <div className="rounded-2xl border border-[#35313c] bg-[#111118] p-6 text-center">
        <p className="font-serif text-lg text-[#fafafa]">
          No sources matched this enquiry under the active scope.
        </p>
        <p className="mt-1 text-xs text-[#8e899c]">
          Inspect Search Details above to see provider statuses, unresponsive
          engines, or strict collection scope filters.
        </p>
      </div>
    )
  }

  const collectionLane = results.filter(r => r.lane === 'collection')
  const widerWebLane = results.filter(r => r.lane === 'wider-web')
  const showSplitLanes =
    mode === 'literature' &&
    collectionLane.length > 0 &&
    widerWebLane.length > 0

  if (showSplitLanes) {
    return (
      <div className="flex flex-col gap-6">
        <div>
          <div className="mb-2.5 flex items-center justify-between">
            <h3 className="font-serif text-lg text-[#e8c96a]">
              Curated Library & Archival Holdings ({collectionLane.length})
            </h3>
            <span className="font-mono text-[11px] text-[#8e899c]">
              Collection Lane
            </span>
          </div>
          <div className="flex flex-col gap-3">
            {collectionLane.map(result => (
              <SingleResultCard
                key={result.id}
                result={result}
                mode={mode}
                isSelected={selectedSourceId === result.id}
                onSelect={() => onSelectSource(result.id)}
                readingSurface={readingSurface}
              />
            ))}
          </div>
        </div>

        <div>
          <div className="mb-2.5 flex items-center justify-between">
            <h3 className="font-serif text-lg text-[#fafafa]">
              Wider Scholarly & Web Sources ({widerWebLane.length})
            </h3>
            <span className="font-mono text-[11px] text-[#8e899c]">
              Wider-Web Lane
            </span>
          </div>
          <div className="flex flex-col gap-3">
            {widerWebLane.map(result => (
              <SingleResultCard
                key={result.id}
                result={result}
                mode={mode}
                isSelected={selectedSourceId === result.id}
                onSelect={() => onSelectSource(result.id)}
                readingSurface={readingSurface}
              />
            ))}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      {results.map(result => (
        <SingleResultCard
          key={result.id}
          result={result}
          mode={mode}
          isSelected={selectedSourceId === result.id}
          onSelect={() => onSelectSource(result.id)}
          readingSurface={readingSurface}
        />
      ))}
    </div>
  )
}
