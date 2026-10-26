import type { SourceResult } from '@/lib/acuity/search/contracts'

/**
 * Source-quality tiers. The fused RRF rank (rank.ts) only knows where each
 * provider put a URL; it cannot tell a Nag Hammadi translation from a
 * Pinterest board. Tiers re-weight the fused score and drive the UI badges.
 */
export type SourceQualityTier = 'curated' | 'scholarly' | 'general' | 'low'

export type EvidenceStrength = 'strong' | 'weak' | 'none'

const TIER_WEIGHT: Record<SourceQualityTier, number> = {
  curated: 1.6,
  scholarly: 1.3,
  general: 1,
  low: 0.25
}

/** Hosts that are almost never useful evidence for a contemplative enquiry. */
const LOW_QUALITY_HOSTS = [
  'imdb.com',
  'pinterest.com',
  'pinterest.co.uk',
  'instagram.com',
  'facebook.com',
  'tiktok.com',
  'x.com',
  'twitter.com',
  'urbandictionary.com',
  'quora.com',
  'answers.com',
  'merriam-webster.com',
  'dictionary.com',
  'thefreedictionary.com',
  'collinsdictionary.com',
  'dictionary.cambridge.org',
  'vocabulary.com',
  'yourdictionary.com',
  'wiktionary.org',
  'thesaurus.com',
  'amazon.com',
  'amazon.co.uk',
  'ebay.com',
  'etsy.com',
  'youtube.com',
  'spotify.com',
  'genius.com',
  'lyrics.com',
  'azlyrics.com',
  'brainyquote.com',
  'goodreads.com'
]

const SCHOLARLY_HOSTS = [
  'plato.stanford.edu',
  'iep.utm.edu',
  'britannica.com',
  'jstor.org',
  'archive.org',
  'sacred-texts.com',
  'gutenberg.org',
  'ccel.org',
  'perseus.tufts.edu',
  'newadvent.org',
  'earlychristianwritings.com',
  'gnosis.org',
  'oxfordreference.com',
  'cambridge.org',
  'academia.edu',
  'philpapers.org',
  'worldhistory.org',
  'jewishencyclopedia.com',
  'sefaria.org',
  'suttacentral.net',
  'accesstoinsight.org',
  'quran.com',
  'biblegateway.com',
  'en.wikipedia.org',
  'wikisource.org',
  'nasa.gov',
  'nature.com',
  'ncbi.nlm.nih.gov',
  'pubmed.ncbi.nlm.nih.gov',
  'semanticscholar.org',
  'arxiv.org'
]

const SCHOLARLY_TLDS = ['.edu', '.ac.uk', '.ac.jp', '.ac.nz', '.edu.au', '.gov']

const STOPWORDS = new Set(
  'a an and are as at be by did do does for from how in into is it its of on or that the their them they this to was what when where which who why with within without'.split(
    ' '
  )
)

function hostMatches(hostname: string, list: string[]): boolean {
  const h = hostname.toLowerCase().replace(/^www\./, '')
  return list.some(d => h === d || h.endsWith(`.${d}`))
}

export function classifySourceTier(
  hostname: string,
  curatedHosts: ReadonlySet<string> = new Set()
): SourceQualityTier {
  const h = hostname.toLowerCase().replace(/^www\./, '')
  if (curatedHosts.has(h) || [...curatedHosts].some(c => h.endsWith(`.${c}`))) {
    return 'curated'
  }
  if (hostMatches(h, LOW_QUALITY_HOSTS)) return 'low'
  if (hostMatches(h, SCHOLARLY_HOSTS)) return 'scholarly'
  if (SCHOLARLY_TLDS.some(tld => h.endsWith(tld))) return 'scholarly'
  return 'general'
}

export function queryTerms(query: string): string[] {
  return Array.from(
    new Set(
      query
        .toLowerCase()
        .replace(/site:\S+/g, ' ')
        .split(/[^\p{L}\p{N}]+/u)
        .filter(t => t.length > 2 && !STOPWORDS.has(t))
    )
  )
}

/** Share of meaningful query terms that appear in the title or snippet (0..1). */
export function lexicalRelevance(
  query: string,
  source: Pick<SourceResult, 'title' | 'snippet' | 'url'>
): number {
  const terms = queryTerms(query)
  if (terms.length === 0) return 1
  const hay = `${source.title} ${source.snippet} ${source.url}`.toLowerCase()
  const hits = terms.filter(
    t => hay.includes(t) || (t.length > 5 && hay.includes(t.slice(0, -2)))
  ).length
  return hits / terms.length
}

export const RELEVANCE_FLOOR = 0.34

export interface QualityAssessment {
  results: SourceResult[]
  evidenceStrength: EvidenceStrength
  strongCount: number
  lowCount: number
}

/**
 * Re-rank fused results by quality tier × lexical relevance, push `low` tier
 * to the end (kept, but hidden by default in the UI and excluded from
 * synthesis), and re-number citation labels in the new order.
 */
export function assessSourceQuality(options: {
  query: string
  results: SourceResult[]
  curatedHosts?: ReadonlySet<string>
  relabel?: boolean
}): QualityAssessment {
  const curated = options.curatedHosts ?? new Set<string>()
  const scored = options.results.map((r, idx) => {
    const tier = classifySourceTier(r.hostname, curated)
    const relevance = lexicalRelevance(options.query, r)
    const weighted = r.rrfScore * TIER_WEIGHT[tier] * (0.4 + 0.6 * relevance)
    return {
      r: { ...r, qualityTier: tier, relevance: Number(relevance.toFixed(2)) },
      weighted,
      idx
    }
  })

  scored.sort((a, b) => {
    const aLow = a.r.qualityTier === 'low' ? 1 : 0
    const bLow = b.r.qualityTier === 'low' ? 1 : 0
    if (aLow !== bLow) return aLow - bLow
    if (b.weighted !== a.weighted) return b.weighted - a.weighted
    return a.idx - b.idx
  })

  const results = scored.map((s, i) =>
    options.relabel ? { ...s.r, citationLabel: `S${i + 1}` } : s.r
  )
  const strongCount = results.filter(
    r => r.qualityTier !== 'low' && (r.relevance ?? 0) >= RELEVANCE_FLOOR
  ).length
  const lowCount = results.filter(r => r.qualityTier === 'low').length

  const evidenceStrength: EvidenceStrength =
    strongCount === 0 ? 'none' : strongCount < 3 ? 'weak' : 'strong'

  return { results, evidenceStrength, strongCount, lowCount }
}
