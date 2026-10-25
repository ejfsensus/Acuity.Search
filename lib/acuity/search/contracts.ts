import { z } from 'zod'

export const DISCOVERY_MODES = ['general', 'literature', 'collections'] as const
export type DiscoveryMode = (typeof DISCOVERY_MODES)[number]

export const RESEARCH_DEPTHS = ['quick', 'research'] as const
export type ResearchDepth = (typeof RESEARCH_DEPTHS)[number]

export const ANSWER_PREFERENCES = [
  'answer-with-sources',
  'results-only'
] as const
export type AnswerPreference = (typeof ANSWER_PREFERENCES)[number]

export const PROVIDER_IDS = ['searxng', 'brave', 'tavily', 'exa'] as const
export type ProviderId = (typeof PROVIDER_IDS)[number]

export const SORT_ORDERS = [
  'combined-relevance',
  'provider-order',
  'newest'
] as const
export type SortOrder = (typeof SORT_ORDERS)[number]

export const SCOPE_POLICIES = [
  'strict',
  'open',
  'collection-and-web-lanes'
] as const
export type ScopePolicy = (typeof SCOPE_POLICIES)[number]

export const CONTENT_STATES = [
  'snippet',
  'fulltext-excerpt',
  'catalogue-metadata',
  'scan-no-text',
  'unavailable'
] as const
export type ContentState = (typeof CONTENT_STATES)[number]

export const ACCESS_STATUSES = [
  'open-access',
  'access-unknown',
  'login-required',
  'metadata-only'
] as const
export type AccessStatus = (typeof ACCESS_STATUSES)[number]

export const TARGET_COVERAGE_STATUSES = [
  'queued',
  'attempted',
  'succeeded',
  'failed',
  'unsearched',
  'not-supported'
] as const
export type TargetCoverageStatus = (typeof TARGET_COVERAGE_STATUSES)[number]

export const DATE_RANGES = ['all', 'day', 'week', 'month', 'year'] as const
export type DateRangeFilter = (typeof DATE_RANGES)[number]

export const FILE_TYPE_FILTERS = ['any', 'html', 'pdf', 'epub'] as const
export type FileTypeFilter = (typeof FILE_TYPE_FILTERS)[number]

export const SAFESEARCH_LEVELS = [0, 1, 2] as const
export type SafeSearchLevel = (typeof SAFESEARCH_LEVELS)[number]

export interface ScopeTargetRule {
  targetId: string
  entryId?: string
  groupId?: string
  label: string
  hostname: string
  includeWwwAlias: boolean
  allowedPathPrefixes: string[]
  starterPriority?: boolean
}

export interface CompiledScope {
  policy: ScopePolicy
  targets: ScopeTargetRule[]
  includeDomains: string[]
  excludeDomains: string[]
  excludePathPrefixes: Array<{ hostname: string; pathPrefix: string }>
  registryVersion: string
}

export const searchRequestSchema = z.object({
  query: z
    .string()
    .trim()
    .min(1, 'Search query is required')
    .max(1000, 'Search query must not exceed 1000 characters'),
  mode: z.enum(DISCOVERY_MODES).default('general'),
  depth: z.enum(RESEARCH_DEPTHS).default('quick'),
  answerPreference: z.enum(ANSWER_PREFERENCES).default('answer-with-sources'),
  providers: z
    .array(z.enum(PROVIDER_IDS))
    .min(1, 'At least one search provider must be selected')
    .default(['searxng', 'brave', 'tavily', 'exa']),
  sortOrder: z.enum(SORT_ORDERS).default('combined-relevance'),
  scopePolicy: z.enum(SCOPE_POLICIES).optional(),
  collectionGroupIds: z.array(z.string()).default([]),
  entryIds: z.array(z.string()).default([]),
  tags: z.array(z.string()).default([]),
  starterPriorityOnly: z.boolean().default(false),
  includeDomains: z.array(z.string()).default([]),
  excludeDomains: z.array(z.string()).default([]),
  dateRange: z.enum(DATE_RANGES).default('all'),
  language: z.string().trim().max(16).optional(),
  fileType: z.enum(FILE_TYPE_FILTERS).default('any'),
  safeSearch: z.union([z.literal(0), z.literal(1), z.literal(2)]).default(0),
  page: z.number().int().min(1).max(20).default(1),
  includeMultimedia: z.boolean().default(false),
  extractTopSources: z.boolean().default(true)
})

export type SearchRequestInput = z.input<typeof searchRequestSchema>
export type SearchRequest = z.output<typeof searchRequestSchema>

export interface QueryVariant {
  id: string
  query: string
  kind:
    | 'literal'
    | 'transliteration'
    | 'literature-edition'
    | 'archival-expansion'
    | 'scoped-site'
  rationale: string
  targetHostname?: string
}

export interface TopicGroupSuggestion {
  groupId: string
  title: string
  confidence: number
  matchedTerms: string[]
  rationale: string
}

export interface QueryPlan {
  originalQuery: string
  cleanedQuery: string
  explicitSiteOperators: string[]
  explicitFileType?: FileTypeFilter
  variants: QueryVariant[]
  suggestedGroups: TopicGroupSuggestion[]
  scopeConflictWarning?: string
}

export type ProviderAttemptStatus =
  | 'succeeded'
  | 'partial'
  | 'failed'
  | 'skipped-unconfigured'
  | 'skipped-disabled'
  | 'skipped-budget'
  | 'cancelled'

export interface ProviderAttempt {
  attemptId: string
  provider: ProviderId
  variantId: string
  executedQuery: string
  targetId?: string
  status: ProviderAttemptStatus
  httpStatus?: number
  latencyMs: number
  rawResultCount: number
  acceptedResultCount: number
  filteredOutCount: number
  enginesReporting?: string[]
  unresponsiveEngines?: Array<{ engine: string; reason: string }>
  errorCode?: string
  errorMessage?: string
  startedAt: string
  completedAt: string
}

export interface SourceProvenanceEntry {
  provider: ProviderId
  providerRank: number
  variantId: string
  executedQuery: string
  engines?: string[]
  scoreContribution: number
  retrievedAt: string
}

export interface LiteratureMetadata {
  workTitle: string
  author?: string
  translator?: string
  editionOrYear?: string
  traditionOrCategory?: string
  format: 'HTML' | 'PDF' | 'EPUB' | 'Catalogue' | 'Scan'
  accessStatus: AccessStatus
  holdingInstitutionOrDomain: string
}

export interface SourceResult {
  id: string
  citationLabel: string
  url: string
  normalizedUrl: string
  canonicalUrl?: string
  title: string
  snippet: string
  hostname: string
  path: string
  publishedDate?: string
  author?: string
  contentState: ContentState
  accessStatus: AccessStatus
  lane: 'collection' | 'wider-web'
  matchedEntryId?: string
  matchedGroupId?: string
  rrfScore: number
  firstProviderOrder: number
  provenance: SourceProvenanceEntry[]
  literature?: LiteratureMetadata
  evidenceIds: string[]
}

export interface EvidenceLocator {
  type: 'css-heading' | 'pdf-page' | 'epub-chapter' | 'char-offset'
  value: string
  pageNumber?: number
  charStart?: number
  charEnd?: number
}

export interface EvidenceRecord {
  id: string
  sourceId: string
  citationLabel: string
  sourceUrl: string
  canonicalUrl?: string
  title: string
  verbatimText: string
  sha256: string
  contentState: ContentState
  mimeType: string
  byteLength: number
  extractedAt: string
  locator: EvidenceLocator
  redirectChain: string[]
}

export interface CitationVerificationResult {
  valid: boolean
  citedLabels: string[]
  resolvedLabels: string[]
  unresolvedLabels: string[]
  unbackedClaimsWarning?: string
}

export interface AnswerVersion {
  id: string
  versionNumber: number
  createdAt: string
  modelId: string | null
  mode: 'synthesized' | 'results-only' | 'fallback-results-only'
  markdown: string
  citations: CitationVerificationResult
  disclosureNote?: string
}

export interface CoverageCell {
  targetId: string
  targetLabel: string
  hostname: string
  variantId: string
  provider: ProviderId
  status: TargetCoverageStatus
  resultCount: number
  reason?: string
}

export interface BudgetSnapshot {
  depth: ResearchDepth
  maxSearchRequests: number
  usedSearchRequests: number
  maxVariants: number
  usedVariants: number
  maxExtractions: number
  usedExtractions: number
  initialLatencyBudgetMs: number
  totalLatencyBudgetMs: number
  elapsedMs: number
  maxSynthesisTokens: number
}

export interface SearchRunState {
  runId: string
  userId: string
  isGuest: boolean
  createdAt: string
  updatedAt: string
  status: 'running' | 'completed' | 'partial' | 'cancelled' | 'failed'
  request: SearchRequest
  scope: CompiledScope
  plan: QueryPlan
  budget: BudgetSnapshot
  providerAttempts: ProviderAttempt[]
  results: SourceResult[]
  evidence: EvidenceRecord[]
  answers: AnswerVersion[]
  coverage: CoverageCell[]
  nextContinuationCursor: number
  warnings: string[]
}

export const createShareRequestSchema = z.object({
  runId: z.string().min(1),
  title: z.string().trim().min(1).max(200),
  includeQuery: z.boolean().default(true),
  includeAnswerVersionId: z.string().optional(),
  selectedSourceIds: z.array(z.string()).min(1),
  selectedEvidenceIds: z.array(z.string()).default([]),
  expiresInDays: z.number().int().min(1).max(365).nullable().default(30)
})

export type CreateShareRequest = z.output<typeof createShareRequestSchema>

export interface ShareSnapshot {
  id: string
  runId: string
  ownerId: string
  title: string
  createdAt: string
  expiresAt: string | null
  revokedAt: string | null
  snapshot: {
    query?: string
    mode: DiscoveryMode
    depth: ResearchDepth
    createdAt: string
    answer?: {
      markdown: string
      modelId: string | null
      createdAt: string
    }
    sources: SourceResult[]
    evidence: EvidenceRecord[]
  }
}

export type SearchStreamEvent =
  | {
      type: 'run.Accepted'
      runId: string
      request: SearchRequest
      scope: CompiledScope
    }
  | { type: 'plan.Created'; runId: string; plan: QueryPlan }
  | {
      type: 'provider.Started'
      runId: string
      provider: ProviderId
      query: string
    }
  | { type: 'provider.Completed'; runId: string; attempt: ProviderAttempt }
  | { type: 'results.Updated'; runId: string; results: SourceResult[] }
  | { type: 'extraction.Completed'; runId: string; evidence: EvidenceRecord }
  | { type: 'answer.Delta'; runId: string; textDelta: string }
  | { type: 'answer.Completed'; runId: string; answer: AnswerVersion }
  | { type: 'run.Completed'; runId: string; run: SearchRunState }
  | { type: 'run.Error'; runId: string; error: string }
