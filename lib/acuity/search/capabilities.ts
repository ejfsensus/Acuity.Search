import type { ProviderId } from '@/lib/acuity/search/contracts'

export type CapabilitySupportLevel =
  | 'native'
  | 'query-emulated'
  | 'post-filtered'
  | 'unsupported'

export interface ProviderCapabilityMatrix {
  provider: ProviderId
  displayName: string
  description: string
  domainInclude: CapabilitySupportLevel
  domainExclude: CapabilitySupportLevel
  pathScope: CapabilitySupportLevel
  dateRange: CapabilitySupportLevel
  language: CapabilitySupportLevel
  fileType: CapabilitySupportLevel
  safeSearch: CapabilitySupportLevel
  pagination: CapabilitySupportLevel
  snippetQuality: 'snippets' | 'highlights-and-text' | 'snippets-and-raw'
  maxResultsPerCall: number
  maxPageIndex: number
}

export const PROVIDER_CAPABILITIES: Record<
  ProviderId,
  ProviderCapabilityMatrix
> = {
  searxng: {
    provider: 'searxng',
    displayName: 'External SearXNG',
    description:
      'External metasearch instance aggregating multiple upstream engines with engine-level provenance.',
    domainInclude: 'query-emulated',
    domainExclude: 'post-filtered',
    pathScope: 'post-filtered',
    dateRange: 'native',
    language: 'native',
    fileType: 'query-emulated',
    safeSearch: 'native',
    pagination: 'native',
    snippetQuality: 'snippets',
    maxResultsPerCall: 20,
    maxPageIndex: 10
  },
  brave: {
    provider: 'brave',
    displayName: 'Brave Search',
    description:
      'Independent web index with operator support, date freshness filters, and pagination up to 20 results per page.',
    domainInclude: 'query-emulated',
    domainExclude: 'query-emulated',
    pathScope: 'post-filtered',
    dateRange: 'native',
    language: 'native',
    fileType: 'query-emulated',
    safeSearch: 'native',
    pagination: 'native',
    snippetQuality: 'snippets',
    maxResultsPerCall: 20,
    maxPageIndex: 9
  },
  tavily: {
    provider: 'tavily',
    displayName: 'Tavily Search',
    description:
      'Research search API with native domain inclusion/exclusion arrays and raw content snippets (vendor answers disabled).',
    domainInclude: 'native',
    domainExclude: 'native',
    pathScope: 'post-filtered',
    dateRange: 'native',
    language: 'unsupported',
    fileType: 'query-emulated',
    safeSearch: 'unsupported',
    pagination: 'unsupported',
    snippetQuality: 'snippets-and-raw',
    maxResultsPerCall: 20,
    maxPageIndex: 1
  },
  exa: {
    provider: 'exa',
    displayName: 'Exa Search',
    description:
      'Semantic and keyword neural search index with native domain inclusion/exclusion, highlights arrays, and publication metadata.',
    domainInclude: 'native',
    domainExclude: 'native',
    pathScope: 'post-filtered',
    dateRange: 'native',
    language: 'unsupported',
    fileType: 'query-emulated',
    safeSearch: 'unsupported',
    pagination: 'unsupported',
    snippetQuality: 'highlights-and-text',
    maxResultsPerCall: 20,
    maxPageIndex: 1
  }
}

export function getProviderCapability(
  provider: ProviderId
): ProviderCapabilityMatrix {
  return PROVIDER_CAPABILITIES[provider]
}
