'use client'

import React from 'react'

import type { DomainTopicGroup } from '@/lib/acuity/registry'

interface AcuityPortalHeroProps {
  topicGroups: DomainTopicGroup[]
  selectedGroupIds: string[]
  onToggleGroup: (groupId: string) => void
  onSelectExampleQuery: (
    query: string,
    mode: 'general' | 'literature' | 'collections',
    groupIds?: string[]
  ) => void
  compact?: boolean
}

const CURATED_ENQUIRY_PROMPTS: Array<{
  label: string
  query: string
  mode: 'general' | 'literature' | 'collections'
  groupIds?: string[]
}> = [
  {
    label: 'Nag Hammadi · Gospel of Truth',
    query: 'Nag Hammadi Gospel of Truth Coptic codex translation',
    mode: 'literature',
    groupIds: ['topic-01']
  },
  {
    label: 'Corpus Hermeticum · Nous & Poimandres',
    query: 'Corpus Hermeticum Poimandres Copenhaver Mead translation',
    mode: 'literature',
    groupIds: ['topic-01', 'topic-02']
  },
  {
    label: 'Ibn Arabi · Wahdat al-Wujud',
    query: 'wahdat al-wujud Ibn Arabi Fusūs al-Hikam commentary',
    mode: 'general',
    groupIds: ['topic-01', 'topic-05']
  },
  {
    label: 'Declassified Stargate / Remote Viewing Archives',
    query: 'Stargate remote viewing declassified memorandum FOIA reading room',
    mode: 'collections',
    groupIds: ['topic-03', 'topic-06']
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
        strokeWidth="2"
        fill="rgba(212, 168, 67, 0.06)"
      />
      <path
        d="M20 46 V28 C20 20 25.4 14 32 14 C38.6 14 44 20 44 28 V46"
        stroke="#e8c96a"
        strokeWidth="1.75"
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

export function AcuityPortalHero({
  topicGroups,
  selectedGroupIds,
  onToggleGroup,
  onSelectExampleQuery,
  compact = false
}: AcuityPortalHeroProps) {
  if (compact) {
    return null
  }

  return (
    <section
      aria-label="Acuity.Search Discovery Portal"
      className="relative mx-auto w-full max-w-4xl px-3 pt-4 pb-2 md:px-6 md:pt-8"
    >
      {/* Portal Archway & Luminous Orb SVG */}
      <div className="relative mx-auto mb-5 flex flex-col items-center text-center">
        <div className="relative mb-3 flex items-center justify-center">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -inset-6 rounded-full bg-[radial-gradient(circle,rgba(212,168,67,0.16)_0%,rgba(124,92,224,0.10)_45%,transparent_72%)] blur-xl"
          />
          <svg
            viewBox="0 0 180 120"
            className="h-20 w-32 md:h-24 md:w-36"
            aria-hidden="true"
          >
            <defs>
              <radialGradient id="acuityOrbGlow" cx="50%" cy="45%" r="50%">
                <stop offset="0%" stopColor="#e8c96a" stopOpacity="0.45" />
                <stop offset="55%" stopColor="#7c5ce0" stopOpacity="0.18" />
                <stop offset="100%" stopColor="#09090f" stopOpacity="0" />
              </radialGradient>
            </defs>
            <circle cx="90" cy="56" r="46" fill="url(#acuityOrbGlow)" />
            {/* Outer Archway */}
            <path
              d="M52 108 V54 C52 31 69 14 90 14 C111 14 128 31 128 54 V108"
              stroke="#d4a843"
              strokeOpacity="0.65"
              strokeWidth="1.5"
              fill="none"
            />
            {/* Inner Archway */}
            <path
              d="M62 108 V56 C62 39 74.5 25 90 25 C105.5 25 118 39 118 56 V108"
              stroke="#7c5ce0"
              strokeOpacity="0.5"
              strokeWidth="1"
              strokeDasharray="3 3"
              fill="none"
            />
            <circle
              cx="90"
              cy="52"
              r="14"
              stroke="#e8c96a"
              strokeWidth="1.25"
              fill="rgba(212,168,67,0.10)"
            />
            <circle cx="90" cy="52" r="3.5" fill="#fafafa" />
            <line
              x1="40"
              y1="108"
              x2="140"
              y2="108"
              stroke="#35313c"
              strokeWidth="1.25"
            />
          </svg>
        </div>

        <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-[#d4a843]">
          Acuity Institute · Sovereign Research Instrument
        </p>
        <h1 className="mt-1.5 font-serif text-3xl font-normal tracking-tight text-[#fafafa] sm:text-4xl md:text-5xl">
          Acuity<span className="text-[#d4a843]">.Search</span>
        </h1>
        <p className="mt-2 max-w-xl text-sm leading-relaxed text-[#b3b0bd] sm:text-base">
          Open enquiry. Wider sources. Traceable answers.
        </p>
      </div>

      {/* Interactive 10-Collection Constellation Facets (Keyboard & Screen-Reader Accessible) */}
      <div className="mt-4 rounded-2xl border border-[#35313c] bg-[#111118]/90 p-3.5 shadow-lg">
        <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="inline-block size-2 rounded-full bg-[#d4a843]" />
            <h2 className="font-mono text-xs uppercase tracking-wider text-[#b3b0bd]">
              Curated Discovery Collections (10 Topic Orbs · 110 Sources)
            </h2>
          </div>
          {selectedGroupIds.length > 0 && (
            <span className="rounded-full border border-[#d4a843]/50 bg-[#d4a843]/10 px-2.5 py-0.5 font-mono text-[11px] text-[#e8c96a]">
              {selectedGroupIds.length} selected
            </span>
          )}
        </div>

        <div
          role="group"
          aria-label="Topic collections"
          className="grid grid-cols-1 gap-1.5 sm:grid-cols-2 lg:grid-cols-5"
        >
          {topicGroups.map(group => {
            const active = selectedGroupIds.includes(group.id)
            return (
              <button
                key={group.id}
                type="button"
                onClick={() => onToggleGroup(group.id)}
                aria-pressed={active}
                className={`group flex flex-col justify-between rounded-xl border px-3 py-2 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#d4a843] ${
                  active
                    ? 'border-[#d4a843] bg-[#d4a843]/15 text-[#fafafa]'
                    : 'border-[#35313c]/80 bg-[#181820]/70 text-[#b3b0bd] hover:border-[#d4a843]/50 hover:text-[#fafafa]'
                }`}
              >
                <div className="flex items-center justify-between gap-1">
                  <span className="font-mono text-[10px] text-[#d4a843]">
                    {String(group.number).padStart(2, '0')}
                  </span>
                  <span className="font-mono text-[10px] text-[#8e899c]">
                    {group.entryCount} sources
                  </span>
                </div>
                <span className="mt-1 line-clamp-2 text-xs font-medium leading-snug">
                  {group.suppliedTitle}
                </span>
              </button>
            )
          })}
        </div>

        {/* Starter Enquiry Prompts */}
        <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-[#35313c]/60 pt-2.5">
          <span className="mr-1 font-mono text-[11px] text-[#8e899c]">
            Exemplars:
          </span>
          {CURATED_ENQUIRY_PROMPTS.map(item => (
            <button
              key={item.label}
              type="button"
              onClick={() =>
                onSelectExampleQuery(item.query, item.mode, item.groupIds)
              }
              className="rounded-full border border-[#35313c] bg-[#09090f]/80 px-2.5 py-1 text-xs text-[#b3b0bd] transition-colors hover:border-[#d4a843]/60 hover:text-[#e8c96a]"
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>
    </section>
  )
}
