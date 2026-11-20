import type { SourceResult } from '@/lib/acuity/search/contracts'

const TIER_SPEC: Record<
  NonNullable<SourceResult['qualityTier']>,
  { label: string; className: string; title: string }
> = {
  curated: {
    label: 'Curated archive',
    className: 'border-[#d4a843] bg-[#d4a843] text-[#09090f] font-semibold',
    title: 'From one of the 110 curated Acuity repositories'
  },
  scholarly: {
    label: 'Scholarly',
    className: 'border-[#d4a843]/70 bg-transparent text-[#e8c96a]',
    title: 'Academic, encyclopaedic or primary-text source'
  },
  general: {
    label: 'Web',
    className: 'border-[#35313c] bg-[#09090f]/70 text-[#b3b0bd]',
    title: 'General web source'
  },
  low: {
    label: 'Weaker source',
    className: 'border-[#d9a05b]/50 bg-[#d9a05b]/10 text-[#e0b37a]',
    title:
      'Social, dictionary or entertainment site — not used for the narrative'
  }
}

export function QualityBadge({ tier }: { tier: SourceResult['qualityTier'] }) {
  if (!tier) return null
  const spec = TIER_SPEC[tier]
  return (
    <span
      title={spec.title}
      className={`inline-flex items-center rounded-full border px-2 py-0.5 font-mono text-[12px] ${spec.className}`}
    >
      {spec.label}
    </span>
  )
}
