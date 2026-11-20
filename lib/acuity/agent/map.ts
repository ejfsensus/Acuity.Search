import type {
  EvidenceRecord,
  SourceResult
} from '@/lib/acuity/search/contracts'
import {
  computeVerbatimSha256,
  stripControlChars
} from '@/lib/acuity/search/evidence'

export const AGENT_SOURCES_SCHEMA = 'acuity.agent-sources.v1'
export const LIBRARY_PSEUDO_URL = 'https://agent.acuity.institute/library/'
const CORPUS_PREFIX = 'docs/sacred-texts/'

/** One entry of the Agent's `data-sources` chunk (acuity.agent-sources.v1). */
export interface AgentSource {
  ref: string
  origin: 'sacred-text-index' | 'local-corpus'
  title: string
  tradition?: string
  bookCode?: string
  path?: string
  passageId?: string
  chunkIndex?: number
  lineStart?: number
  lineEnd?: number
  sourceUrl?: string
  edition?: string
  translator?: string
  licence?: string
  text: string
  cited: boolean
  label?: string
}

const str = (v: unknown, max = 500): string | undefined =>
  typeof v === 'string' && v.trim()
    ? stripControlChars(v).slice(0, max)
    : undefined
const num = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) ? v : undefined

/** Validates a `data-sources` chunk's data; returns [] for anything else (incl. the legacy shape). */
export function parseAgentSources(data: unknown): AgentSource[] {
  const d = data as { schema?: unknown; sources?: unknown }
  if (!d || d.schema !== AGENT_SOURCES_SCHEMA || !Array.isArray(d.sources))
    return []
  const out: AgentSource[] = []
  for (const raw of d.sources.slice(0, 100)) {
    const s = raw as Record<string, unknown>
    const ref = str(s.ref, 600)
    const text = str(s.text, 4000)
    if (!ref || !text) continue
    const origin =
      s.origin === 'sacred-text-index' ? 'sacred-text-index' : 'local-corpus'
    out.push({
      ref,
      origin,
      title: str(s.title, 300) || 'Library passage',
      tradition: str(s.tradition, 120),
      bookCode: str(s.bookCode, 200),
      path: str(s.path, 600),
      passageId: str(s.passageId, 600),
      chunkIndex: num(s.chunkIndex),
      lineStart: num(s.lineStart),
      lineEnd: num(s.lineEnd),
      sourceUrl: str(s.sourceUrl, 1000)?.match(/^https?:\/\//)
        ? str(s.sourceUrl, 1000)
        : undefined,
      edition: str(s.edition, 300),
      translator: str(s.translator, 200),
      licence: str(s.licence, 300),
      text,
      cited: s.cited === true,
      label:
        typeof s.label === 'string' && /^S\d+$/.test(s.label)
          ? s.label
          : undefined
    })
  }
  return out
}

/** Fallback when the chunk is missing: sacred-text-mcp hits from tool outputs. */
export function sourcesFromToolOutput(
  toolName: string,
  output: unknown
): AgentSource[] {
  if (toolName !== 'sacred-text-mcp') return []
  const o = output as { status?: string; success?: boolean; text?: unknown }
  if (
    !o ||
    o.status !== 'done' ||
    o.success !== true ||
    typeof o.text !== 'string'
  )
    return []
  let data: unknown
  try {
    data = JSON.parse(o.text)
  } catch {
    return []
  }
  const hits: AgentSource[] = []
  const visit = (v: unknown, depth: number) => {
    if (depth > 6 || !v || typeof v !== 'object') return
    const h = v as Record<string, unknown>
    if (
      typeof h.text === 'string' &&
      typeof h.id === 'string' &&
      (h.book || h.title)
    ) {
      hits.push({
        ref: h.id,
        origin: 'sacred-text-index',
        title: str(h.title ?? h.book, 300) || 'Library passage',
        tradition: str(h.tradition, 120),
        bookCode: str(h.book, 200),
        passageId: h.id,
        chunkIndex: num(h.chunk_index),
        sourceUrl: str(h.source_url, 1000),
        text: stripControlChars(h.text).slice(0, 4000),
        cited: false
      })
    }
    for (const item of Array.isArray(v) ? v : Object.values(v))
      visit(item, depth + 1)
  }
  visit(data, 0)
  return hits
}

export function publicPath(path: string | undefined): string | undefined {
  return path?.startsWith(CORPUS_PREFIX)
    ? path.slice(CORPUS_PREFIX.length)
    : path
}

export function urlForAgentSource(s: AgentSource): string {
  if (s.sourceUrl) return s.sourceUrl
  const key =
    publicPath(s.path) || s.passageId?.split('#')[0] || s.bookCode || s.ref
  return LIBRARY_PSEUDO_URL + key.split('/').map(encodeURIComponent).join('/')
}

function needlesFor(s: AgentSource): string[] {
  return [
    s.path,
    publicPath(s.path),
    s.passageId,
    s.sourceUrl,
    s.title.length >= 6 ? s.title : undefined
  ].filter((n): n is string => Boolean(n && n.length >= 4))
}

/**
 * Inserts `[S#]` after the first mention of each cited source and hides the
 * sandbox path prefix. Answers that already carry the label are left alone.
 */
export function rewriteAnswerCitations(
  markdown: string,
  sources: AgentSource[]
): string {
  let out = markdown
  for (const s of sources) {
    if (!s.label || out.includes(`[${s.label}]`)) continue
    const lower = out.toLowerCase()
    let best: { at: number; len: number } | null = null
    for (const needle of needlesFor(s)) {
      const at = lower.indexOf(needle.toLowerCase())
      if (at >= 0 && (!best || at < best.at)) best = { at, len: needle.length }
    }
    if (!best) continue
    let end = best.at + best.len
    // keep the label after a closing backtick / bracket / quote
    while (end < out.length && /[`)\]"'*]/.test(out[end]!)) end += 1
    out = `${out.slice(0, end)} [${s.label}]${out.slice(end)}`
  }
  return out.split(CORPUS_PREFIX).join('')
}

function normalise(text: string): string {
  return text.replace(/\s+/g, ' ').trim().toLowerCase()
}

/** True when the answer quotes at least one 40+ character stretch of the passage. */
export function isQuotedVerbatim(answer: string, passage: string): boolean {
  const a = normalise(answer)
  const sentences = normalise(passage).split(/(?<=[.;:!?])\s+/)
  return sentences.some(
    sentence => sentence.length >= 40 && a.includes(sentence)
  )
}

export interface MappedAgentRun {
  sources: AgentSource[]
  results: SourceResult[]
  evidence: EvidenceRecord[]
  markdown: string
}

/**
 * Agent sources → Search results and evidence. Cited sources keep the Agent's
 * S# labels; the rest are numbered after them. Duplicate refs are dropped.
 */
export function mapAgentRun(input: {
  sources: AgentSource[]
  answer: string
  question: string
  retrievedAt?: string
}): MappedAgentRun {
  const retrievedAt = input.retrievedAt ?? new Date().toISOString()
  const seen = new Set<string>()
  const unique = input.sources.filter(s => !seen.has(s.ref) && seen.add(s.ref))
  const used = new Set(unique.map(s => s.label).filter(Boolean) as string[])
  const cited = unique
    .filter(s => s.cited && s.label)
    .sort((a, b) => Number(a.label!.slice(1)) - Number(b.label!.slice(1)))
  const rest = unique.filter(s => !(s.cited && s.label))
  let next = 1
  const labelled: AgentSource[] = [...cited]
  for (const s of rest) {
    while (used.has(`S${next}`)) next += 1
    used.add(`S${next}`)
    labelled.push({ ...s, cited: false, label: `S${next}` })
  }

  const markdown = rewriteAnswerCitations(
    input.answer,
    labelled.filter(s => s.cited)
  )
  const results: SourceResult[] = []
  const evidence: EvidenceRecord[] = []
  labelled.forEach((s, index) => {
    const url = urlForAgentSource(s)
    const parsed = new URL(url)
    const id = `agent-${index + 1}`
    const evidenceId = `ev-agent-${index + 1}`
    const text = stripControlChars(s.text).trim()
    const verbatim = isQuotedVerbatim(input.answer, text)
    results.push({
      id,
      citationLabel: s.label!,
      url,
      normalizedUrl: url,
      title: s.title,
      snippet: text.slice(0, 400),
      hostname: parsed.hostname,
      path: parsed.pathname,
      contentState: 'fulltext-excerpt',
      accessStatus: 'open-access',
      lane: 'collection',
      rrfScore: 1 / (60 + index + 1),
      firstProviderOrder: index,
      provenance: [
        {
          provider: 'acuity-agent',
          providerRank: index + 1,
          variantId: 'agent',
          executedQuery: input.question,
          scoreContribution: 1 / (60 + index + 1),
          retrievedAt
        }
      ],
      literature: {
        workTitle: s.title,
        translator: s.translator,
        editionOrYear: s.edition,
        traditionOrCategory: s.tradition,
        format: 'HTML',
        accessStatus: 'open-access',
        holdingInstitutionOrDomain: s.sourceUrl
          ? parsed.hostname
          : 'Acuity Library'
      },
      evidenceIds: [evidenceId],
      qualityTier: 'curated',
      passage: {
        ref: s.ref,
        origin: s.origin,
        tradition: s.tradition,
        bookCode: s.bookCode,
        passageId: s.passageId,
        licence: s.licence,
        verbatim
      }
    })
    evidence.push({
      id: evidenceId,
      sourceId: id,
      citationLabel: s.label!,
      sourceUrl: url,
      title: s.title,
      verbatimText: text,
      sha256: computeVerbatimSha256(text),
      contentState: 'fulltext-excerpt',
      mimeType: 'text/plain',
      byteLength: Buffer.byteLength(text, 'utf8'),
      extractedAt: retrievedAt,
      locator:
        s.origin === 'sacred-text-index'
          ? { type: 'css-heading', value: s.passageId || s.ref }
          : {
              type: 'char-offset',
              value: s.lineStart
                ? `L${s.lineStart}-${s.lineEnd ?? s.lineStart}`
                : 'L1'
            },
      redirectChain: []
    })
  })
  return { sources: labelled, results, evidence, markdown }
}

/** Friendly progress label for a tool call (never the raw command). */
export function stageLabel(toolName: unknown, input: unknown): string {
  const i = (input ?? {}) as Record<string, unknown>
  if (toolName === 'sacred-text-mcp') {
    const action = String(i.action ?? '')
    const book = typeof i.book === 'string' ? i.book : undefined
    if (/passage|read/.test(action))
      return book ? `Reading ${book.slice(0, 80)}` : 'Reading a passage'
    if (/tradition|catalog|list|book/.test(action))
      return 'Browsing the Library catalogue'
    return 'Searching the passage index'
  }
  if (toolName === 'bash' || toolName === 'bash_batch')
    return 'Scanning the Library corpus'
  if (typeof toolName === 'string' && /web|brave/i.test(toolName))
    return 'Checking the wider web'
  return 'Consulting the Library'
}
