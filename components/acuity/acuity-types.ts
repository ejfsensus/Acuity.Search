import type {
  AccessStatus,
  ContentState,
  DiscoveryMode,
  ProviderId,
  ResearchDepth,
  SortOrder
} from '@/lib/acuity/search/contracts'

export const MODE_DESCRIPTIONS: Record<
  DiscoveryMode,
  { label: string; subtitle: string }
> = {
  general: {
    label: 'General',
    subtitle:
      'Open multi-provider enquiry across independent indexes, archives, and scholarly web sources.'
  },
  literature: {
    label: 'Literature',
    subtitle:
      'Primary texts, translations, critical editions, manuscripts, and archival holdings with translator & edition distinction.'
  },
  collections: {
    label: 'Collections',
    subtitle:
      'Scoped domain-group discovery across the 110 curated Acuity source repositories and 10 thematic collections.'
  }
}

export const DEPTH_DESCRIPTIONS: Record<
  ResearchDepth,
  { label: string; badge: string; detail: string }
> = {
  quick: {
    label: 'Quick',
    badge: '≤8 requests · ≤2 variants',
    detail: 'Fast multi-provider pass with bounded top-4 source extraction.'
  },
  research: {
    label: 'Research',
    badge: '≤24 requests · ≤6 variants',
    detail:
      'Deep transliteration, archival expansion, and up to 12 full-text extractions.'
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
  'combined-relevance': 'Combined relevance (RRF)',
  'provider-order': 'Provider order',
  newest: 'Newest'
}

export const PROVIDER_DISPLAY_NAMES: Record<ProviderId, string> = {
  searxng: 'SearXNG',
  brave: 'Brave',
  tavily: 'Tavily',
  exa: 'Exa'
}
