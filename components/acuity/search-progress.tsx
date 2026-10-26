'use client'

import { useEffect, useState } from 'react'

import {
  progressFraction,
  type RunProgress,
  STAGE_LABELS,
  STAGE_ORDER
} from '@/lib/acuity/search/progress'

import { QualityBadge } from './quality-badge'

type VisibleStage = keyof typeof STAGE_LABELS

const VISIBLE_STAGES = STAGE_ORDER.filter(
  (s): s is VisibleStage => s !== 'done'
)

function useElapsedSeconds(active: boolean): number {
  const [startedAt] = useState(() => Date.now())
  const [now, setNow] = useState(startedAt)
  useEffect(() => {
    if (!active) return
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [active])
  return Math.max(0, Math.round((now - startedAt) / 1000))
}

/**
 * Live progress for a streamed enquiry: the gold arch hairline, five named
 * stages (announced politely to screen readers), early source cards as soon
 * as results arrive, and the narrative as it is written.
 */
export function SearchProgress({
  progress,
  depth,
  onCancel
}: {
  progress: RunProgress
  depth: 'quick' | 'research'
  onCancel: () => void
}) {
  const elapsed = useElapsedSeconds(progress.stage !== 'done')
  const currentIdx = STAGE_ORDER.indexOf(progress.stage)
  const fraction = progressFraction(progress)
  const currentLabel =
    progress.stage === 'done' ? 'Complete' : STAGE_LABELS[progress.stage]

  const detail = (stage: VisibleStage): string | null => {
    if (stage === 'searching' && progress.providersStarted > 0) {
      return `${progress.providersCompleted}/${progress.providersStarted} queries`
    }
    if (stage === 'reading' && progress.extractionsPlanned > 0) {
      return `${Math.min(progress.extractionsCompleted, progress.extractionsPlanned)}/${progress.extractionsPlanned} pages`
    }
    return null
  }

  const earlySources = progress.results
    .filter(r => r.qualityTier !== 'low')
    .slice(0, 6)

  return (
    <section
      aria-label="Enquiry progress"
      className="acuity-reveal mx-auto mt-5 flex w-full max-w-3xl flex-col gap-4"
    >
      <div className="rounded-3xl border border-[#35313c]/90 bg-[#111118] p-5 md:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="font-serif text-xl text-[#fafafa]">
            {currentLabel}
            <span className="sr-only"> — {Math.round(fraction * 100)}%</span>
          </p>
          <div className="flex items-center gap-3">
            {elapsed >= 8 && (
              <span className="font-mono text-[12px] text-[#a29db0]">
                {elapsed}s ·{' '}
                {depth === 'research'
                  ? 'Deep usually takes ~45s'
                  : 'Quick usually takes ~15s'}
              </span>
            )}
            <button
              type="button"
              onClick={onCancel}
              className="inline-flex min-h-11 items-center rounded-full border border-[#35313c] bg-[#181820] px-4 font-mono text-[12px] text-[#b3b0bd] hover:border-[#d4a843] hover:text-[#fafafa]"
            >
              Cancel
            </button>
          </div>
        </div>

        <div
          className="acuity-arch-track mt-4"
          role="progressbar"
          aria-label="Enquiry progress"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(fraction * 100)}
        >
          <div
            className="acuity-arch-fill"
            style={{ width: `${Math.round(fraction * 100)}%` }}
          />
        </div>

        <ol className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-5">
          {VISIBLE_STAGES.map((stage, i) => {
            const state =
              i < currentIdx ? 'done' : i === currentIdx ? 'active' : 'pending'
            const d = detail(stage)
            return (
              <li
                key={stage}
                aria-current={state === 'active' ? 'step' : undefined}
                className={`flex items-center gap-2 rounded-xl border px-3 py-2 font-mono text-[12px] sm:flex-col sm:items-start sm:gap-1 ${
                  state === 'active'
                    ? 'border-[#d4a843]/70 bg-[#d4a843]/10 text-[#e8c96a]'
                    : state === 'done'
                      ? 'border-[#35313c] text-[#b3b0bd]'
                      : 'border-[#35313c]/50 text-[#77728a]'
                }`}
              >
                <span aria-hidden="true">
                  {state === 'done' ? '✓' : state === 'active' ? '◌' : '·'}
                </span>
                <span>{STAGE_LABELS[stage]}</span>
                {d && state !== 'pending' && (
                  <span className="text-[12px] text-[#a29db0]">{d}</span>
                )}
                <span className="sr-only">
                  {state === 'done'
                    ? '(done)'
                    : state === 'active'
                      ? '(in progress)'
                      : '(pending)'}
                </span>
              </li>
            )
          })}
        </ol>
        <p aria-live="polite" className="sr-only">
          {currentLabel}
        </p>
      </div>

      {earlySources.length > 0 && (
        <div aria-label="Sources found so far" className="acuity-reveal">
          <h2 className="mb-2 font-mono text-[12px] uppercase tracking-wider text-[#d4a843]">
            Sources found so far
          </h2>
          <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {earlySources.map(src => (
              <li
                key={src.id}
                className="acuity-reveal rounded-2xl border border-[#35313c]/80 bg-[#111118]/95 p-3"
              >
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="font-mono text-[12px] text-[#e8c96a]">
                    [{src.citationLabel}]
                  </span>
                  <span className="truncate font-mono text-[12px] text-[#d4a843]">
                    {src.hostname.replace(/^www\./, '')}
                  </span>
                  <QualityBadge tier={src.qualityTier} />
                </div>
                <p className="mt-1 line-clamp-2 font-serif text-[15px] leading-snug text-[#fafafa]">
                  {src.title}
                </p>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="rounded-3xl border border-[#35313c]/90 bg-[#111118] p-5 md:p-6">
        {progress.answerText ? (
          <div
            aria-busy="true"
            className="whitespace-pre-wrap text-[15px] leading-relaxed text-[#e6e4ed]"
          >
            {progress.answerText}
            <span
              aria-hidden="true"
              className="ml-0.5 inline-block h-4 w-1.5 animate-pulse bg-[#d4a843] align-middle motion-reduce:animate-none"
            />
          </div>
        ) : (
          <div aria-hidden="true" className="flex flex-col gap-2.5">
            <div className="acuity-shimmer h-3.5 w-11/12 rounded" />
            <div className="acuity-shimmer h-3.5 w-full rounded" />
            <div className="acuity-shimmer h-3.5 w-4/6 rounded" />
          </div>
        )}
      </div>
    </section>
  )
}
