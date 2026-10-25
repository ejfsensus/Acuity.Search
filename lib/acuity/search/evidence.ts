import crypto from 'node:crypto'

import type {
  CitationVerificationResult,
  EvidenceRecord,
  SourceResult
} from '@/lib/acuity/search/contracts'
import type { ExtractionOutput } from '@/lib/acuity/search/extract'

export function computeVerbatimSha256(verbatimText: string): string {
  return crypto.createHash('sha256').update(verbatimText, 'utf8').digest('hex')
}

export function createEvidenceRecordFromExtraction(options: {
  evidenceId: string
  source: SourceResult
  extraction: ExtractionOutput
}): EvidenceRecord {
  const verbatim =
    options.extraction.verbatimText.trim() || options.source.snippet.trim()
  const sha256 = computeVerbatimSha256(verbatim)

  return {
    id: options.evidenceId,
    sourceId: options.source.id,
    citationLabel: options.source.citationLabel,
    sourceUrl: options.source.url,
    canonicalUrl: options.extraction.canonicalUrl,
    title: options.extraction.title || options.source.title,
    verbatimText: verbatim,
    sha256,
    contentState: options.extraction.contentState,
    mimeType: options.extraction.mimeType,
    byteLength: options.extraction.byteLength,
    extractedAt: new Date().toISOString(),
    locator: options.extraction.locator,
    redirectChain: options.extraction.redirectChain
  }
}

export function createSnippetEvidenceRecord(options: {
  evidenceId: string
  source: SourceResult
}): EvidenceRecord {
  const verbatim = options.source.snippet.trim() || options.source.title.trim()
  const sha256 = computeVerbatimSha256(verbatim)

  return {
    id: options.evidenceId,
    sourceId: options.source.id,
    citationLabel: options.source.citationLabel,
    sourceUrl: options.source.url,
    title: options.source.title,
    verbatimText: verbatim,
    sha256,
    contentState: options.source.contentState,
    mimeType: 'text/plain',
    byteLength: Buffer.byteLength(verbatim, 'utf8'),
    extractedAt: new Date().toISOString(),
    locator: {
      type: 'char-offset',
      value: `0..${verbatim.length}`,
      charStart: 0,
      charEnd: verbatim.length
    },
    redirectChain: [options.source.url]
  }
}

/**
 * Deterministically verifies all citation markers (`[S1]`, `[S2]`, `[1](#S1)`)
 * in synthesized answer markdown against retrieved `SourceResult[]` and
 * `EvidenceRecord[]`.
 *
 * Flags any unresolved citation label (e.g. `[S99]`) or paragraphs containing
 * factual claims with zero citations.
 */
export function verifyAnswerCitations(
  markdown: string,
  sources: SourceResult[],
  evidence: EvidenceRecord[]
): CitationVerificationResult {
  const validLabelSet = new Set<string>()
  for (const src of sources) {
    validLabelSet.add(src.citationLabel)
  }
  for (const ev of evidence) {
    validLabelSet.add(ev.citationLabel)
  }

  const citedSet = new Set<string>()

  // Match [S1], [S2, S3], [1](#S1), or [S1](url)
  const bracketPattern = /\[(S\d+(?:\s*,\s*S\d+)*)\]/g
  let match: RegExpExecArray | null
  while ((match = bracketPattern.exec(markdown)) !== null) {
    const tokens = match[1].split(',').map(t => t.trim())
    for (const token of tokens) {
      if (/^S\d+$/.test(token)) {
        citedSet.add(token)
      }
    }
  }

  const hashPattern = /\[\s*\d+\s*\]\(#(S\d+)\)/g
  while ((match = hashPattern.exec(markdown)) !== null) {
    citedSet.add(match[1])
  }

  const citedLabels = Array.from(citedSet)
  const resolvedLabels = citedLabels.filter(l => validLabelSet.has(l))
  const unresolvedLabels = citedLabels.filter(l => !validLabelSet.has(l))

  let unbackedClaimsWarning: string | undefined
  if (unresolvedLabels.length > 0) {
    unbackedClaimsWarning = `Answer referenced non-existent source labels: ${unresolvedLabels.join(', ')}.`
  } else if (
    markdown.trim().length > 160 &&
    sources.length > 0 &&
    resolvedLabels.length === 0
  ) {
    unbackedClaimsWarning =
      'Synthesized text contains no explicit source citations ([S1], [S2], ...).'
  }

  return {
    valid: unresolvedLabels.length === 0 && !unbackedClaimsWarning,
    citedLabels,
    resolvedLabels,
    unresolvedLabels,
    unbackedClaimsWarning
  }
}

/**
 * Strips or annotates any hallucinated citation markers (`[S99]`) that do not
 * exist in the verified evidence ledger so the UI never links to a phantom source.
 */
export function sanitizeUnresolvedCitations(
  markdown: string,
  unresolvedLabels: string[]
): string {
  if (unresolvedLabels.length === 0) return markdown
  const unresolvedSet = new Set(unresolvedLabels)
  return markdown.replace(/\[(S\d+)\]/g, (full, label: string) => {
    if (unresolvedSet.has(label)) {
      return `[unverified reference ${label} removed]`
    }
    return full
  })
}
