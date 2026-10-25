import type {
  AccessStatus,
  ContentState,
  LiteratureMetadata,
  ProviderId,
  SortOrder,
  SourceResult
} from '@/lib/acuity/search/contracts'
import { normalizeResultUrl } from '@/lib/acuity/search/normalize'

export const RRF_K = 60

export interface RawProviderCandidate {
  provider: ProviderId
  providerRank: number
  variantId: string
  executedQuery: string
  url: string
  title: string
  snippet: string
  publishedDate?: string
  author?: string
  engines?: string[]
  contentState?: ContentState
  accessStatus?: AccessStatus
  lane: 'collection' | 'wider-web'
  matchedEntryId?: string
  matchedGroupId?: string
  holdingLabel?: string
}

/**
 * Computes the Reciprocal Rank Fusion contribution for a 1-based provider rank:
 *   score = 1 / (60 + providerRank)
 */
export function computeRrfContribution(providerRank: number): number {
  const clampedRank = Math.max(1, Math.trunc(providerRank))
  return 1 / (RRF_K + clampedRank)
}

/**
 * Extracts structured Literature metadata from a candidate result without
 * fabricating fields that are not evidenced in the title, snippet, or URL.
 */
export function inferLiteratureMetadata(
  candidate: RawProviderCandidate,
  hostname: string,
  path: string
): LiteratureMetadata {
  const combined = `${candidate.title} ${candidate.snippet}`
  const lowerUrl = candidate.url.toLowerCase()

  let format: LiteratureMetadata['format'] = 'HTML'
  if (lowerUrl.endsWith('.pdf') || /\bpdf\b/i.test(candidate.title)) {
    format = 'PDF'
  } else if (lowerUrl.endsWith('.epub') || /\bepub\b/i.test(candidate.title)) {
    format = 'EPUB'
  } else if (
    candidate.contentState === 'scan-no-text' ||
    /\b(facsimile|microfilm|scanned\s+manuscript|digitized\s+ms)\b/i.test(
      combined
    )
  ) {
    format = 'Scan'
  } else if (
    candidate.contentState === 'catalogue-metadata' ||
    /\b(worldcat|catalogue\s+record|bibliographic\s+record|finding\s+aid)\b/i.test(
      combined
    )
  ) {
    format = 'Catalogue'
  }

  // Detect explicit translator attribution when present in title or snippet
  let translator: string | undefined
  const transMatch = combined.match(
    /(?:translated\s+by|trans\.\s+by|tr\.\s+)\s*([A-Z][A-Za-z.\s'-]{2,50}?)(?=\s*[,;()|\-\n]|$)/i
  )
  if (transMatch?.[1]) {
    translator = transMatch[1].trim()
  }

  // Detect explicit year or edition
  let editionOrYear: string | undefined
  const yearMatch =
    candidate.publishedDate?.match(/\b(1[5-9]\d{2}|20[0-2]\d)\b/) ||
    combined.match(/\b(1[5-9]\d{2}|20[0-2]\d)\s*(?:edition|ed\.|printing)?\b/i)
  if (yearMatch?.[0]) {
    editionOrYear = yearMatch[0].trim()
  }

  return {
    workTitle: candidate.title.trim() || path,
    author: candidate.author,
    translator,
    editionOrYear,
    format,
    accessStatus: candidate.accessStatus ?? 'access-unknown',
    holdingInstitutionOrDomain: candidate.holdingLabel || hostname
  }
}

/**
 * Merges and ranks raw provider candidates into normalized `SourceResult` items.
 *
 * Key guarantees:
 * 1. Identical normalized URLs from multiple providers merge into one SourceResult
 *    whose `rrfScore` is `sum(1 / (60 + providerRank))` and whose `provenance`
 *    retains every provider, rank, variant, and SearXNG engine.
 * 2. Different URLs (including different translations or editions of the same work)
 *    are NEVER collapsed into a single result.
 * 3. If `existingResults` are supplied (e.g. during progressive streaming or
 *    `Continue research`), already-allocated `citationLabel` values (`S1`, `S2`, ...)
 *    are preserved without renumbering.
 */
export function mergeAndRankCandidates(options: {
  candidates: RawProviderCandidate[]
  existingResults?: SourceResult[]
  sortOrder: SortOrder
  includeLiteratureMetadata?: boolean
}): SourceResult[] {
  const byNormalizedUrl = new Map<string, SourceResult>()
  let maxCitationIndex = 0
  let providerOrderCounter = 0

  for (const existing of options.existingResults ?? []) {
    byNormalizedUrl.set(existing.normalizedUrl, {
      ...existing,
      provenance: [...existing.provenance],
      evidenceIds: [...existing.evidenceIds]
    })
    const labelNum = Number(existing.citationLabel.replace(/^S/, ''))
    if (Number.isFinite(labelNum) && labelNum > maxCitationIndex) {
      maxCitationIndex = labelNum
    }
    if (existing.firstProviderOrder > providerOrderCounter) {
      providerOrderCounter = existing.firstProviderOrder
    }
  }

  const nowIso = new Date().toISOString()

  for (const cand of options.candidates) {
    const normalizedUrl = normalizeResultUrl(cand.url)
    let parsedUrl: URL
    try {
      parsedUrl = new URL(cand.url)
    } catch {
      continue
    }

    const hostname = parsedUrl.hostname.toLowerCase()
    const path = parsedUrl.pathname || '/'
    const contribution = computeRrfContribution(cand.providerRank)

    const existing = byNormalizedUrl.get(normalizedUrl)
    if (existing) {
      // Avoid double-counting the exact same provider + variantId on the same URL
      const alreadyRecorded = existing.provenance.some(
        p => p.provider === cand.provider && p.variantId === cand.variantId
      )
      if (!alreadyRecorded) {
        existing.rrfScore = Number(
          (existing.rrfScore + contribution).toFixed(8)
        )
        existing.provenance.push({
          provider: cand.provider,
          providerRank: cand.providerRank,
          variantId: cand.variantId,
          executedQuery: cand.executedQuery,
          engines: cand.engines,
          scoreContribution: Number(contribution.toFixed(8)),
          retrievedAt: nowIso
        })
      }
      // Enrich missing fields if the newer candidate has richer snippet/metadata
      if (cand.snippet.length > existing.snippet.length) {
        existing.snippet = cand.snippet
      }
      if (!existing.publishedDate && cand.publishedDate) {
        existing.publishedDate = cand.publishedDate
      }
      if (!existing.author && cand.author) {
        existing.author = cand.author
      }
      if (existing.lane === 'wider-web' && cand.lane === 'collection') {
        existing.lane = 'collection'
        existing.matchedEntryId = cand.matchedEntryId
        existing.matchedGroupId = cand.matchedGroupId
      }
      continue
    }

    maxCitationIndex += 1
    providerOrderCounter += 1
    const citationLabel = `S${maxCitationIndex}`
    const sourceId = `src-${maxCitationIndex}`

    const contentState: ContentState =
      cand.contentState ??
      (cand.snippet && cand.snippet.trim().length > 0
        ? 'snippet'
        : 'catalogue-metadata')

    const accessStatus: AccessStatus = cand.accessStatus ?? 'access-unknown'

    const item: SourceResult = {
      id: sourceId,
      citationLabel,
      url: cand.url,
      normalizedUrl,
      title: cand.title.trim() || cand.url,
      snippet: cand.snippet.trim(),
      hostname,
      path,
      publishedDate: cand.publishedDate,
      author: cand.author,
      contentState,
      accessStatus,
      lane: cand.lane,
      matchedEntryId: cand.matchedEntryId,
      matchedGroupId: cand.matchedGroupId,
      rrfScore: Number(contribution.toFixed(8)),
      firstProviderOrder: providerOrderCounter,
      provenance: [
        {
          provider: cand.provider,
          providerRank: cand.providerRank,
          variantId: cand.variantId,
          executedQuery: cand.executedQuery,
          engines: cand.engines,
          scoreContribution: Number(contribution.toFixed(8)),
          retrievedAt: nowIso
        }
      ],
      literature: options.includeLiteratureMetadata
        ? inferLiteratureMetadata(cand, hostname, path)
        : undefined,
      evidenceIds: []
    }

    byNormalizedUrl.set(normalizedUrl, item)
  }

  const allResults = Array.from(byNormalizedUrl.values())
  return sortSourceResults(allResults, options.sortOrder)
}

export function sortSourceResults(
  results: SourceResult[],
  sortOrder: SortOrder
): SourceResult[] {
  const copy = [...results]

  if (sortOrder === 'provider-order') {
    return copy.sort((a, b) => a.firstProviderOrder - b.firstProviderOrder)
  }

  if (sortOrder === 'newest') {
    return copy.sort((a, b) => {
      const timeA = a.publishedDate ? Date.parse(a.publishedDate) : NaN
      const timeB = b.publishedDate ? Date.parse(b.publishedDate) : NaN
      const validA = Number.isFinite(timeA)
      const validB = Number.isFinite(timeB)
      if (validA && validB && timeA !== timeB) {
        return timeB - timeA
      }
      if (validA && !validB) return -1
      if (!validA && validB) return 1
      return b.rrfScore - a.rrfScore
    })
  }

  // Default: 'combined-relevance' (Reciprocal Rank Fusion score descending, tie-broken by firstProviderOrder)
  return copy.sort((a, b) => {
    if (b.rrfScore !== a.rrfScore) {
      return b.rrfScore - a.rrfScore
    }
    return a.firstProviderOrder - b.firstProviderOrder
  })
}
