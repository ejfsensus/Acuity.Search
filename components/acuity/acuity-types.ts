import type {
  AccessStatus,
  ContentState,
  DiscoveryMode,
  ProvenanceProviderId,
  ProviderId,
  ResearchDepth,
  SortOrder
} from '@/lib/acuity/search/contracts'

export const MODE_DESCRIPTIONS: Record<
  DiscoveryMode,
  { label: string; subtitle: string; placeholder: string }
> = {
  general: {
    label: 'General',
    subtitle:
      'Broad search across web indexes, digital archives, and scholarly sources.',
    placeholder:
      'Ask anything across esoteric traditions, consciousness, philosophy, or historical archives...'
  },
  literature: {
    label: 'Literature',
    subtitle:
      'Primary texts, translations, manuscripts, and critical editions.',
    placeholder:
      'Search primary texts, manuscripts, translators, or critical editions (e.g. Corpus Hermeticum Copenhaver)...'
  },
  collections: {
    label: 'Topic Specific',
    subtitle:
      'Focused search across 10 curated topic collections and 110 specialist repositories.',
    placeholder:
      'Enquire within the selected topic domains and specialist repositories...'
  },
  'sacred-texts': {
    label: 'Sacred Texts',
    subtitle:
      'The Library agent reads the Acuity sacred-text library and answers with cited passages.',
    placeholder:
      'Ask the Library about a teaching, passage, or theme across traditions...'
  }
}

export const DEPTH_DESCRIPTIONS: Record<
  ResearchDepth,
  { label: string; badge: string; detail: string }
> = {
  quick: {
    label: 'Quick',
    badge: 'Quick multi-provider search',
    detail:
      'Rapid federated synthesis across all active search providers with top-source verification.'
  },
  research: {
    label: 'Deep',
    badge: 'Deep comprehensive search',
    detail:
      'Comprehensive query expansion, transliteration variants, and deep full-text archival extraction.'
  }
}

export const CONTENT_STATE_LABELS: Record<
  ContentState,
  { label: string; tone: 'gold' | 'emerald' | 'violet' | 'muted' | 'danger' }
> = {
  'fulltext-excerpt': { label: 'Full text', tone: 'emerald' },
  snippet: { label: 'Snippet', tone: 'gold' },
  'catalogue-metadata': { label: 'Catalogue', tone: 'violet' },
  'scan-no-text': { label: 'Scan, OCR unavailable', tone: 'muted' },
  unavailable: { label: 'Unavailable', tone: 'danger' }
}

export const ACCESS_STATUS_LABELS: Record<AccessStatus, string> = {
  'open-access': 'Open access',
  'access-unknown': 'Access unknown',
  'login-required': 'Login required',
  'metadata-only': 'Metadata only'
}

export const SORT_ORDER_LABELS: Record<SortOrder, string> = {
  'combined-relevance': 'Combined relevance',
  'provider-order': 'Provider order',
  newest: 'Newest'
}

export const PROVIDER_DISPLAY_NAMES: Record<ProvenanceProviderId, string> = {
  'acuity-agent': 'Acuity Library',
  searxng: 'SearXNG',
  brave: 'Brave',
  tavily: 'Tavily',
  exa: 'Exa'
}

/**
 * Minimal registry entry shape sent to the browser. The full entry (targets,
 * curation, reference URLs) stays on the server — sending all 110 entries
 * inflated the home page HTML by ~200 KB.
 */
export type ClientRegistryEntry = Pick<
  import('@/lib/acuity/registry').DomainRegistryEntry,
  'id' | 'topicGroupId' | 'starterPriority' | 'suppliedName'
> & { hostnames: string[] }

export function toClientRegistryEntries(
  entries: import('@/lib/acuity/registry').DomainRegistryEntry[]
): ClientRegistryEntry[] {
  return entries.map(e => ({
    id: e.id,
    topicGroupId: e.topicGroupId,
    starterPriority: e.starterPriority,
    suppliedName: e.suppliedName,
    hostnames: e.targets.map(t => t.hostname)
  }))
}
