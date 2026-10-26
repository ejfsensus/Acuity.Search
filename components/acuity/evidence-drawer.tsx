'use client'

import React from 'react'

import type {
  EvidenceRecord,
  SearchRunState,
  SourceResult
} from '@/lib/acuity/search/contracts'

import {
  ACCESS_STATUS_LABELS,
  CONTENT_STATE_LABELS,
  PROVIDER_DISPLAY_NAMES
} from './acuity-types'

interface EvidenceDrawerProps {
  run: SearchRunState | null
  selectedSource: SourceResult | null
  selectedEvidence: EvidenceRecord[]
  onSelectSource: (sourceId: string) => void
  onContinueResearch?: () => void
  continuing?: boolean
}

export function EvidenceDrawer({
  run,
  selectedSource,
  selectedEvidence,
  onSelectSource,
  onContinueResearch,
  continuing = false
}: EvidenceDrawerProps) {
  if (!run) {
    return (
      <div className="flex h-full flex-col justify-between p-4 text-xs text-[#b3b0bd]">
        <div>
          <h3 className="font-serif text-base font-medium text-[#fafafa]">
            Evidence Ledger
          </h3>
          <p className="mt-1 text-xs leading-relaxed text-[#8e899c]">
            Select any citation or source to view original excerpts, archive
            locations, and retrieval details.
          </p>
        </div>

        <div className="rounded-xl border border-[#35313c] bg-[#181820]/70 p-3">
          <div className="font-mono text-[11px] uppercase tracking-wider text-[#d4a843]">
            Research Standard
          </div>
          <p className="mt-1 text-[11px] leading-relaxed text-[#b3b0bd]">
            Sources are drawn from verified archives and scholarly collections.
            Every quoted passage is preserved verbatim as originally published.
          </p>
        </div>
      </div>
    )
  }

  const unsearchedCount = run.coverage.filter(
    c => c.status === 'unsearched'
  ).length
  const hasRemainingCollectionTargets =
    run.scope.targets.length > run.nextContinuationCursor

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-3 text-xs text-[#fafafa]">
      {/* Selected Source & Verbatim Evidence Inspector */}
      {selectedSource ? (
        <div className="rounded-2xl border border-[#d4a843]/60 bg-[#181820] p-3">
          <div className="flex items-center justify-between gap-2">
            <span className="rounded bg-[#d4a843]/20 px-2 py-0.5 font-mono text-xs font-semibold text-[#e8c96a]">
              [{selectedSource.citationLabel}] Selected Source
            </span>
            <span className="font-mono text-[11px] text-[#8e899c]">
              {CONTENT_STATE_LABELS[selectedSource.contentState].label} ·{' '}
              {ACCESS_STATUS_LABELS[selectedSource.accessStatus]}
            </span>
          </div>

          <h4 className="mt-2 font-serif text-base font-medium text-[#fafafa]">
            {selectedSource.title}
          </h4>

          <a
            href={selectedSource.url}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-1 block break-all font-mono text-[11px] text-[#d4a843] hover:underline"
          >
            {selectedSource.url} ↗
          </a>

          {selectedSource.canonicalUrl &&
            selectedSource.canonicalUrl !== selectedSource.url && (
              <div className="mt-1 break-all font-mono text-[10px] text-[#8e899c]">
                Canonical: {selectedSource.canonicalUrl}
              </div>
            )}

          {/* Provenance Breakdown */}
          <div className="mt-2.5 border-t border-[#35313c] pt-2">
            <div className="font-mono text-[10px] uppercase tracking-wider text-[#8e899c]">
              Found via
            </div>
            <div className="mt-1 flex flex-col gap-1">
              {selectedSource.provenance.map((prov, idx) => (
                <div
                  key={`${prov.provider}-${prov.variantId}-${idx}`}
                  className="flex flex-wrap items-center justify-between rounded-lg border border-[#35313c] bg-[#09090f]/80 px-2 py-1 font-mono text-[10px]"
                >
                  <span className="text-[#e8c96a]">
                    {PROVIDER_DISPLAY_NAMES[prov.provider]} · Result #
                    {prov.providerRank}
                  </span>
                  <span className="text-[#8e899c]">
                    {prov.variantId === 'v1-literal'
                      ? 'Direct query'
                      : prov.variantId === 'v2-translit'
                        ? 'Transliteration'
                        : prov.variantId === 'v3-translation'
                          ? 'Translation'
                          : 'Expanded search'}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Verbatim Evidence Records */}
          <div className="mt-3 flex flex-col gap-2 border-t border-[#35313c] pt-2.5">
            <div className="font-mono text-[10px] uppercase tracking-wider text-[#d4a843]">
              Original Excerpts ({selectedEvidence.length})
            </div>
            {selectedEvidence.map(ev => (
              <div
                key={ev.id}
                className="rounded-xl border border-[#35313c] bg-[#09090f] p-2.5"
              >
                <div className="flex flex-wrap items-center justify-between gap-1 font-mono text-[10px] text-[#8e899c]">
                  <span>
                    {ev.locator.type === 'pdf-page'
                      ? `Page ${ev.locator.pageNumber ?? ev.locator.value}`
                      : ev.locator.type === 'epub-chapter'
                        ? `Chapter ${ev.locator.value}`
                        : ev.locator.type === 'css-heading'
                          ? `Section: ${ev.locator.value}`
                          : 'Text excerpt'}
                  </span>
                  <span>{ev.mimeType}</span>
                </div>
                <pre className="mt-1.5 max-h-48 overflow-y-auto whitespace-pre-wrap break-words font-sans text-xs leading-relaxed text-[#fafafa]">
                  {ev.verbatimText}
                </pre>
                <div className="mt-2 break-all border-t border-[#35313c]/60 pt-1.5 font-mono text-[10px] text-[#8e899c]">
                  Verification hash:{' '}
                  <span className="text-[#b3b0bd]">{ev.sha256}</span>
                </div>
                {ev.redirectChain.length > 1 && (
                  <div className="mt-1 break-all font-mono text-[10px] text-[#8e899c]">
                    Redirects ({ev.redirectChain.length - 1}):{' '}
                    {ev.redirectChain.join(' → ')}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="rounded-xl border border-[#35313c] bg-[#181820]/60 p-3 text-[#b3b0bd]">
          Select any source card or inline citation{' '}
          <span className="font-mono text-[#e8c96a]">[S1]</span> to view its
          original excerpt and archive location.
        </div>
      )}

      {/* Search Details & Provider Status */}
      <div className="rounded-2xl border border-[#35313c] bg-[#181820]/80 p-3">
        <div className="flex items-center justify-between">
          <h4 className="font-serif text-sm font-medium text-[#fafafa]">
            Search Details
          </h4>
          <span className="font-mono text-[10px] text-[#d4a843]">
            {run.budget.usedSearchRequests} queries completed
          </span>
        </div>

        {/* Executed Queries */}
        <div className="mt-2">
          <div className="font-mono text-[10px] uppercase tracking-wider text-[#8e899c]">
            Search Queries Used ({run.plan.variants.length})
          </div>
          <div className="mt-1 flex flex-col gap-1">
            {run.plan.variants.map(v => (
              <div
                key={v.id}
                className="rounded-lg border border-[#35313c] bg-[#09090f]/70 px-2 py-1"
              >
                <div className="flex items-center justify-between font-mono text-[10px]">
                  <span className="text-[#e8c96a]">
                    {v.kind === 'literal'
                      ? 'Direct query'
                      : v.kind === 'transliteration'
                        ? 'Transliteration variant'
                        : v.kind === 'literature-edition'
                          ? 'Edition / translation'
                          : v.kind === 'archival-expansion'
                            ? 'Archival terms'
                            : 'Collection filter'}
                  </span>
                </div>
                <div className="mt-0.5 break-words font-mono text-[11px] text-[#fafafa]">
                  {v.query}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Provider Attempts */}
        <div className="mt-3">
          <div className="font-mono text-[10px] uppercase tracking-wider text-[#8e899c]">
            Search Providers Consulted ({run.providerAttempts.length})
          </div>
          <div className="mt-1 flex flex-col gap-1.5">
            {run.providerAttempts.map(att => (
              <div
                key={att.attemptId}
                className="rounded-lg border border-[#35313c] bg-[#09090f]/80 p-2 font-mono text-[10px]"
              >
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-[#fafafa]">
                    {PROVIDER_DISPLAY_NAMES[att.provider]}
                  </span>
                  <span
                    className={
                      att.status === 'succeeded'
                        ? 'text-[#4ca771]'
                        : att.status === 'partial'
                          ? 'text-[#d4a843]'
                          : 'text-[#d16060]'
                    }
                  >
                    {att.status === 'succeeded'
                      ? 'Connected'
                      : att.status === 'partial'
                        ? 'Partial'
                        : 'Unavailable'}
                  </span>
                </div>
                <div className="mt-0.5 text-[#8e899c]">
                  {att.acceptedResultCount} sources matched
                </div>
                {att.enginesReporting && att.enginesReporting.length > 0 && (
                  <div className="mt-0.5 text-[#b3b0bd]">
                    Engines: {att.enginesReporting.join(', ')}
                  </div>
                )}
                {att.errorMessage && (
                  <div className="mt-1 text-[#e58c8c]">{att.errorMessage}</div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Target Coverage & Continue Research */}
        <div className="mt-3 border-t border-[#35313c] pt-2.5">
          <div className="flex items-center justify-between">
            <span className="font-mono text-[10px] uppercase tracking-wider text-[#8e899c]">
              Collection Coverage ({run.coverage.length} archives examined)
            </span>
          </div>

          {hasRemainingCollectionTargets && onContinueResearch && (
            <button
              type="button"
              onClick={onContinueResearch}
              disabled={continuing}
              className="mt-2 w-full rounded-xl border border-[#d4a843] bg-[#d4a843]/20 px-3 py-2 font-mono text-xs font-medium text-[#e8c96a] transition-colors hover:bg-[#d4a843]/30 disabled:opacity-50"
            >
              {continuing
                ? 'Searching next archive batch...'
                : `Continue Research (${run.scope.targets.length - run.nextContinuationCursor} collection targets remaining)`}
            </button>
          )}
        </div>
      </div>

      {/* Quick Source Switcher */}
      {run.results.length > 0 && (
        <div className="rounded-2xl border border-[#35313c] bg-[#181820]/60 p-3">
          <div className="mb-1.5 font-mono text-[10px] uppercase tracking-wider text-[#8e899c]">
            All Sources ({run.results.length})
          </div>
          <div className="flex flex-wrap gap-1">
            {run.results.map(src => (
              <button
                key={src.id}
                type="button"
                onClick={() => onSelectSource(src.id)}
                className={`rounded-md border px-2 py-0.5 font-mono text-[11px] ${
                  selectedSource?.id === src.id
                    ? 'border-[#d4a843] bg-[#d4a843]/25 text-[#e8c96a]'
                    : 'border-[#35313c] bg-[#09090f] text-[#b3b0bd] hover:border-[#d4a843]/50'
                }`}
              >
                [{src.citationLabel}] {src.hostname}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
