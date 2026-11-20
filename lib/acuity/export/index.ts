import crypto from 'node:crypto'

import type { SearchRunState } from '@/lib/acuity/search/contracts'

export const RESEARCH_BUNDLE_SCHEMA_VERSION = 'acuity.research-bundle.v1.2'
export const ACCEPTED_BUNDLE_SCHEMA_VERSIONS = [
  'acuity.research-bundle.v1',
  'acuity.research-bundle.v1.1',
  'acuity.research-bundle.v1.2'
] as const

type BundleProvider = 'searxng' | 'brave' | 'tavily' | 'exa' | 'acuity-agent'

export interface ResearchBundleV1 {
  schemaVersion: (typeof ACCEPTED_BUNDLE_SCHEMA_VERSIONS)[number]
  exampleOnly?: false
  bundleId: string
  exportedAt: string
  sourceProduct: {
    name: 'Acuity.Search'
    version: string
    gitCommit?: string
  }
  queryRun: {
    runId: string
    query: string
    discoveryMode: 'general' | 'literature' | 'collections' | 'sacred-texts'
    depth: 'quick' | 'research'
    scope: {
      policy: 'strict' | 'open' | 'collection-and-web-lanes'
      collectionGroupIds: string[]
      entryIds: string[]
      includeDomains: string[]
      excludeDomains: string[]
    }
    executedQueries: Array<{
      provider: BundleProvider
      query: string
      status: string
      engines?: string[]
    }>
  }
  answer?: {
    answerVersionId: string
    createdAt: string
    model: string | null
    markdown: string
    /** v1.1: synthesized | results-only | fallback-results-only */
    mode?: string
    disclosureNote?: string
    /** v1.1: structured map from each cited label (S1…) to its source/evidence. */
    citations?: Record<string, { sourceId: string; evidenceIds: string[] }>
    unresolvedLabels?: string[]
  }
  sources: Array<{
    sourceId: string
    citationLabel: string
    title: string
    url: string
    canonicalUrl?: string
    domain: string
    providers: BundleProvider[]
    contentState:
      | 'snippet'
      | 'fulltext-excerpt'
      | 'catalogue-metadata'
      | 'scan-no-text'
      | 'unavailable'
    publishedDate?: string
    authors?: string[]
    translators?: string[]
    editionOrYear?: string
    /** v1.1 */
    snippet?: string
    accessStatus?: string
    literatureFormat?: string
    workTitle?: string
    /** v1.2: Library passages (Sacred Texts mode). */
    passageId?: string
    passageRef?: string
    tradition?: string
    bookCode?: string
    origin?: 'sacred-text-index' | 'local-corpus'
    licence?: string
  }>
  evidence: Array<{
    evidenceId: string
    sourceId: string
    url: string
    verbatimText: string
    sha256: string
    contentState:
      | 'snippet'
      | 'fulltext-excerpt'
      | 'catalogue-metadata'
      | 'scan-no-text'
      | 'unavailable'
    locator: {
      type: 'css-heading' | 'pdf-page' | 'epub-chapter' | 'char-offset'
      value: string
    }
    extractedAt: string
    /** v1.2: the answer quotes this passage word for word. */
    verbatim?: boolean
  }>
  codexCandidates: Array<{
    candidateType: 'source' | 'passage' | 'question' | 'tradition-note'
    title: string
    summary: string
    sourceIds: string[]
    evidenceIds: string[]
    tags: string[]
  }>
  /** v1.1: provider coverage and honest limitations of the run. */
  coverage?: {
    providerStatuses: Array<{ provider: string; status: string }>
    searchedTargetHosts: string[]
    unsearchedTargetHosts: string[]
    limitations: string[]
  }
  /** v1.1 */
  provenance?: {
    product: 'Acuity.Search'
    generatedContentIsPrimarySource: false
    upstreamRunId: string
    /** v1.2: the product that produced the answer on Search's behalf. */
    delegate?: { product: 'Acuity.Agent'; chatId: null }
  }
  integrity: {
    manifestEntries: Array<{
      path: string
      sha256: string
    }>
  }
}

/** Builds the v1.1 structured citation map from the answer and the run's sources. */
export function buildCitationMap(run: SearchRunState): {
  citations: Record<string, { sourceId: string; evidenceIds: string[] }>
  unresolved: string[]
} {
  const answer = run.answers[run.answers.length - 1]
  const citations: Record<string, { sourceId: string; evidenceIds: string[] }> =
    {}
  const unresolved: string[] = []
  if (!answer) return { citations, unresolved }
  const byLabel = new Map(run.results.map(r => [r.citationLabel, r]))
  const labels = new Set<string>(answer.citations?.citedLabels ?? [])
  for (const m of answer.markdown.matchAll(/\[(S\d+)\]/g)) labels.add(m[1])
  for (const label of Array.from(labels).sort(
    (a, b) => Number(a.slice(1)) - Number(b.slice(1))
  )) {
    const src = byLabel.get(label)
    if (!src) {
      unresolved.push(label)
      continue
    }
    const evidenceIds = run.evidence
      .filter(e => e.sourceId === src.id)
      .map(e => e.id)
    citations[label] = { sourceId: src.id, evidenceIds }
  }
  return { citations, unresolved }
}

function buildCoverage(
  run: SearchRunState
): NonNullable<ResearchBundleV1['coverage']> {
  const statusByProvider = new Map<string, string>()
  const rank: Record<string, number> = {
    succeeded: 3,
    partial: 2,
    failed: 1
  }
  for (const att of run.providerAttempts) {
    const prev = statusByProvider.get(att.provider)
    const next = att.status
    if (!prev || (rank[next] ?? 0) > (rank[prev] ?? 0))
      statusByProvider.set(att.provider, next)
  }
  const searched = new Set<string>()
  const unsearched = new Set<string>()
  for (const cell of run.coverage) {
    if (
      cell.status === 'succeeded' ||
      cell.status === 'attempted' ||
      cell.resultCount > 0
    )
      searched.add(cell.hostname)
    else unsearched.add(cell.hostname)
  }
  for (const h of searched) unsearched.delete(h)
  const limitations = [...run.warnings]
  const extracted = new Set(run.evidence.map(e => e.sourceId))
  const snippetOnly = run.results.filter(r => !extracted.has(r.id)).length
  if (snippetOnly > 0)
    limitations.push(
      `${snippetOnly} source(s) have no extracted passage (snippet or metadata only).`
    )
  return {
    providerStatuses: Array.from(statusByProvider, ([provider, status]) => ({
      provider,
      status
    })),
    searchedTargetHosts: Array.from(searched),
    unsearchedTargetHosts: Array.from(unsearched),
    limitations
  }
}

export function computeSha256Hex(content: string): string {
  return crypto.createHash('sha256').update(content, 'utf8').digest('hex')
}

export function exportRunToMarkdown(run: SearchRunState): string {
  const latestAnswer = run.answers[run.answers.length - 1]
  const lines: string[] = [
    `# Acuity.Search Research Export`,
    ``,
    `- **Query:** ${run.request.query}`,
    `- **Run ID:** \`${run.runId}\``,
    `- **Mode:** ${run.request.mode} · **Depth:** ${run.request.depth} · **Scope Policy:** ${run.scope.policy}`,
    `- **Exported At:** ${new Date().toISOString()}`,
    ``
  ]

  if (latestAnswer) {
    lines.push(`## Synthesis & Findings`, ``, latestAnswer.markdown, ``)
    if (latestAnswer.disclosureNote) {
      lines.push(`> **Note:** ${latestAnswer.disclosureNote}`, ``)
    }
  }

  lines.push(`## Verified Sources (${run.results.length})`, ``)
  for (const src of run.results) {
    const providers = Array.from(
      new Set(src.provenance.map(p => p.provider))
    ).join(', ')
    lines.push(
      `- **[${src.citationLabel}] [${src.title}](${src.url})**  `,
      `  Domain: \`${src.hostname}\` · State: \`${src.contentState}\` · Access: \`${src.accessStatus}\` · Providers: \`${providers}\` · RRF Score: \`${src.rrfScore.toFixed(4)}\``
    )
    if (src.literature) {
      const litParts = [
        src.literature.author ? `Author: ${src.literature.author}` : null,
        src.literature.translator
          ? `Translator: ${src.literature.translator}`
          : null,
        src.literature.editionOrYear
          ? `Edition/Year: ${src.literature.editionOrYear}`
          : null,
        `Format: ${src.literature.format}`
      ].filter(Boolean)
      lines.push(`  Literature Metadata: ${litParts.join(' · ')}`)
    }
    if (src.passage) {
      const passageParts = [
        src.passage.tradition ? `Tradition: ${src.passage.tradition}` : null,
        src.passage.bookCode ? `Book: ${src.passage.bookCode}` : null,
        `Passage: ${src.passage.ref.split('docs/sacred-texts/').join('')}`,
        src.passage.verbatim ? 'Quoted verbatim' : null,
        src.passage.licence ? `Licence: ${src.passage.licence}` : null
      ].filter(Boolean)
      lines.push(`  Library Passage: ${passageParts.join(' · ')}`)
    }
    if (src.snippet) {
      lines.push(`  > ${src.snippet.replace(/\n+/g, ' ')}`)
    }
    lines.push(``)
  }

  lines.push(`## Evidence Ledger (${run.evidence.length})`, ``)
  for (const ev of run.evidence) {
    lines.push(
      `### ${ev.citationLabel} — ${ev.title} (\`${ev.id}\`)`,
      `- **URL:** ${ev.sourceUrl}`,
      `- **Content State:** \`${ev.contentState}\` · **Locator:** \`${ev.locator.type}:${ev.locator.value}\``,
      `- **SHA-256:** \`${ev.sha256}\``,
      ``,
      `\`\`\`text`,
      ev.verbatimText.slice(0, 1200),
      `\`\`\``,
      ``
    )
  }

  lines.push(`## Search Execution & Provider Coverage`, ``)
  for (const att of run.providerAttempts) {
    lines.push(
      `- **${att.provider.toUpperCase()}** (\`${att.variantId}\`): status=\`${att.status}\`, accepted=${att.acceptedResultCount}/${att.rawResultCount}, latency=${att.latencyMs}ms — query: \`${att.executedQuery}\``
    )
  }

  return lines.join('\n')
}

export function exportRunToResearchBundle(
  run: SearchRunState
): ResearchBundleV1 {
  const latestAnswer = run.answers[run.answers.length - 1]
  const exportedAt = new Date().toISOString()

  const sourcesPayload: ResearchBundleV1['sources'] = run.results.map(src => ({
    sourceId: src.id,
    citationLabel: src.citationLabel,
    title: src.title,
    url: src.url,
    ...(src.canonicalUrl ? { canonicalUrl: src.canonicalUrl } : {}),
    domain: src.hostname,
    providers: Array.from(new Set(src.provenance.map(p => p.provider))),
    contentState: src.contentState,
    ...(src.publishedDate ? { publishedDate: src.publishedDate } : {}),
    ...(src.author ? { authors: [src.author] } : {}),
    ...(src.literature?.translator
      ? { translators: [src.literature.translator] }
      : {}),
    ...(src.literature?.editionOrYear
      ? { editionOrYear: src.literature.editionOrYear }
      : {}),
    ...(src.snippet ? { snippet: src.snippet } : {}),
    accessStatus: src.accessStatus,
    ...(src.literature?.format
      ? { literatureFormat: src.literature.format }
      : {}),
    ...(src.literature?.workTitle
      ? { workTitle: src.literature.workTitle }
      : {}),
    ...(src.passage
      ? {
          passageRef: src.passage.ref.split('docs/sacred-texts/').join(''),
          origin: src.passage.origin,
          ...(src.passage.passageId
            ? { passageId: src.passage.passageId }
            : {}),
          ...(src.passage.tradition
            ? { tradition: src.passage.tradition }
            : {}),
          ...(src.passage.bookCode ? { bookCode: src.passage.bookCode } : {}),
          ...(src.passage.licence ? { licence: src.passage.licence } : {})
        }
      : {})
  }))
  const verbatimSources = new Set(
    run.results.filter(r => r.passage?.verbatim).map(r => r.id)
  )

  const evidencePayload: ResearchBundleV1['evidence'] = run.evidence.map(
    ev => ({
      evidenceId: ev.id,
      sourceId: ev.sourceId,
      url: ev.sourceUrl,
      verbatimText: ev.verbatimText,
      sha256: ev.sha256,
      contentState: ev.contentState,
      locator: {
        type: ev.locator.type,
        value: ev.locator.value
      },
      extractedAt: ev.extractedAt,
      ...(verbatimSources.has(ev.sourceId) ? { verbatim: true } : {})
    })
  )

  const codexCandidates: ResearchBundleV1['codexCandidates'] = run.results
    .slice(0, 5)
    .map(src => ({
      candidateType: run.request.mode === 'literature' ? 'passage' : 'source',
      title: src.title,
      summary: src.snippet || src.title,
      sourceIds: [src.id],
      evidenceIds: src.evidenceIds,
      tags: [...run.request.tags, run.request.mode]
    }))

  const queryRunPayload: ResearchBundleV1['queryRun'] = {
    runId: run.runId,
    query: run.request.query,
    discoveryMode: run.request.mode,
    depth: run.request.depth,
    scope: {
      policy: run.scope.policy,
      collectionGroupIds: run.request.collectionGroupIds,
      entryIds: run.request.entryIds,
      includeDomains: run.scope.includeDomains,
      excludeDomains: run.scope.excludeDomains
    },
    executedQueries: run.providerAttempts.map(att => ({
      provider: att.provider,
      query: att.executedQuery,
      status: att.status,
      ...(att.enginesReporting && att.enginesReporting.length > 0
        ? { engines: att.enginesReporting }
        : {})
    }))
  }

  const citationMap = buildCitationMap(run)
  const answerPayload = latestAnswer
    ? {
        answerVersionId: latestAnswer.id,
        createdAt: latestAnswer.createdAt,
        model: latestAnswer.modelId,
        markdown: latestAnswer.markdown,
        mode: latestAnswer.mode,
        ...(latestAnswer.disclosureNote
          ? { disclosureNote: latestAnswer.disclosureNote }
          : {}),
        citations: citationMap.citations,
        unresolvedLabels: citationMap.unresolved
      }
    : undefined
  const coveragePayload = buildCoverage(run)

  // Compute detached section SHA-256 manifest so there is no circular self-hash
  const manifestEntries: Array<{ path: string; sha256: string }> = [
    {
      path: '/queryRun',
      sha256: computeSha256Hex(JSON.stringify(queryRunPayload))
    },
    {
      path: '/sources',
      sha256: computeSha256Hex(JSON.stringify(sourcesPayload))
    },
    {
      path: '/evidence',
      sha256: computeSha256Hex(JSON.stringify(evidencePayload))
    },
    {
      path: '/codexCandidates',
      sha256: computeSha256Hex(JSON.stringify(codexCandidates))
    }
  ]

  manifestEntries.push({
    path: '/coverage',
    sha256: computeSha256Hex(JSON.stringify(coveragePayload))
  })

  if (answerPayload) {
    manifestEntries.push({
      path: '/answer',
      sha256: computeSha256Hex(JSON.stringify(answerPayload))
    })
  }

  return {
    schemaVersion: RESEARCH_BUNDLE_SCHEMA_VERSION,
    exampleOnly: false,
    bundleId: `bundle-${run.runId}`,
    exportedAt,
    sourceProduct: {
      name: 'Acuity.Search',
      version: '1.0.0'
    },
    queryRun: queryRunPayload,
    ...(answerPayload ? { answer: answerPayload } : {}),
    sources: sourcesPayload,
    evidence: evidencePayload,
    codexCandidates,
    coverage: coveragePayload,
    provenance: {
      product: 'Acuity.Search',
      generatedContentIsPrimarySource: false,
      upstreamRunId: run.runId,
      ...(run.request.mode === 'sacred-texts'
        ? { delegate: { product: 'Acuity.Agent' as const, chatId: null } }
        : {})
    },
    integrity: {
      manifestEntries
    }
  }
}

/**
 * Validates an `acuity.research-bundle.v1` payload for import or handoff.
 * Rejects synthetic example bundles (`exampleOnly: true`) and verifies
 * SHA-256 integrity of all evidence items.
 */
export function validateResearchBundleForImport(bundle: unknown): {
  valid: boolean
  errors: string[]
} {
  const errors: string[] = []
  if (!bundle || typeof bundle !== 'object') {
    return { valid: false, errors: ['Bundle must be a JSON object'] }
  }

  const record = bundle as Record<string, any>
  if (
    !(ACCEPTED_BUNDLE_SCHEMA_VERSIONS as readonly string[]).includes(
      record.schemaVersion
    )
  ) {
    errors.push(
      `Unsupported schemaVersion: ${String(record.schemaVersion)} (expected ${ACCEPTED_BUNDLE_SCHEMA_VERSIONS.join(' or ')})`
    )
  }

  if (record.exampleOnly === true) {
    errors.push(
      'Synthetic example bundle (exampleOnly: true) cannot be imported as real research evidence.'
    )
  }

  if (!record.sourceProduct || record.sourceProduct.name !== 'Acuity.Search') {
    errors.push('sourceProduct.name must be "Acuity.Search"')
  }

  if (!Array.isArray(record.sources)) {
    errors.push('sources must be an array')
  }
  if (!Array.isArray(record.evidence)) {
    errors.push('evidence must be an array')
  } else {
    for (const ev of record.evidence) {
      if (
        typeof ev.verbatimText === 'string' &&
        typeof ev.sha256 === 'string'
      ) {
        const expected = computeSha256Hex(ev.verbatimText)
        if (expected !== ev.sha256.toLowerCase()) {
          errors.push(`Evidence SHA-256 mismatch on ${String(ev.evidenceId)}`)
        }
      } else {
        errors.push(
          `Evidence item ${String(ev?.evidenceId)} missing verbatimText or sha256`
        )
      }
    }
  }

  if (
    !record.integrity ||
    !Array.isArray(record.integrity.manifestEntries) ||
    record.integrity.manifestEntries.length === 0
  ) {
    errors.push('integrity.manifestEntries must be a non-empty array')
  } else {
    const sections: Record<string, unknown> = {
      '/queryRun': record.queryRun,
      '/sources': record.sources,
      '/evidence': record.evidence,
      '/codexCandidates': record.codexCandidates,
      '/coverage': record.coverage,
      '/answer': record.answer
    }
    for (const entry of record.integrity.manifestEntries) {
      if (!entry || typeof entry.path !== 'string') continue
      if (!(entry.path in sections)) continue
      const actual = computeSha256Hex(JSON.stringify(sections[entry.path]))
      if (actual !== String(entry.sha256).toLowerCase()) {
        errors.push(`Integrity manifest mismatch on ${entry.path}`)
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors
  }
}
