import crypto from 'node:crypto'

import type { SearchRunState } from '@/lib/acuity/search/contracts'

export interface ResearchBundleV1 {
  schemaVersion: 'acuity.research-bundle.v1'
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
    discoveryMode: 'general' | 'literature' | 'collections'
    depth: 'quick' | 'research'
    scope: {
      policy: 'strict' | 'open' | 'collection-and-web-lanes'
      collectionGroupIds: string[]
      entryIds: string[]
      includeDomains: string[]
      excludeDomains: string[]
    }
    executedQueries: Array<{
      provider: 'searxng' | 'brave' | 'tavily' | 'exa'
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
  }
  sources: Array<{
    sourceId: string
    citationLabel: string
    title: string
    url: string
    canonicalUrl?: string
    domain: string
    providers: Array<'searxng' | 'brave' | 'tavily' | 'exa'>
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
  }>
  codexCandidates: Array<{
    candidateType: 'source' | 'passage' | 'question' | 'tradition-note'
    title: string
    summary: string
    sourceIds: string[]
    evidenceIds: string[]
    tags: string[]
  }>
  integrity: {
    manifestEntries: Array<{
      path: string
      sha256: string
    }>
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
      : {})
  }))

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
      extractedAt: ev.extractedAt
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

  const answerPayload = latestAnswer
    ? {
        answerVersionId: latestAnswer.id,
        createdAt: latestAnswer.createdAt,
        model: latestAnswer.modelId,
        markdown: latestAnswer.markdown
      }
    : undefined

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

  if (answerPayload) {
    manifestEntries.push({
      path: '/answer',
      sha256: computeSha256Hex(JSON.stringify(answerPayload))
    })
  }

  return {
    schemaVersion: 'acuity.research-bundle.v1',
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
  if (record.schemaVersion !== 'acuity.research-bundle.v1') {
    errors.push(
      `Unsupported schemaVersion: ${String(record.schemaVersion)} (expected acuity.research-bundle.v1)`
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
  }

  return {
    valid: errors.length === 0,
    errors
  }
}
