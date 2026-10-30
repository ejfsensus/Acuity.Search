import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import type { SearchRunState } from '@/lib/acuity/search/contracts'

import {
  buildCitationMap,
  computeSha256Hex,
  exportRunToResearchBundle,
  validateResearchBundleForImport
} from '../index'

const schema = JSON.parse(
  fs.readFileSync(
    path.join(
      process.cwd(),
      'config/acuity/schemas/research-bundle.schema.json'
    ),
    'utf8'
  )
)

/** Minimal draft-07 subset checker: required keys, types, enums, additionalProperties:false. */
function check(node: any, value: any, at: string, errors: string[]): void {
  if (!node || value === undefined) return
  if (node.const !== undefined && value !== node.const)
    errors.push(`${at}: expected const ${node.const}`)
  if (node.enum && !node.enum.includes(value))
    errors.push(`${at}: ${value} not in enum`)
  const types = node.type ? [].concat(node.type) : []
  const actual =
    value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value
  if (types.length && !types.includes(actual as never))
    errors.push(`${at}: expected ${types.join('|')} got ${actual}`)
  if (actual === 'object' && node.properties) {
    for (const key of node.required ?? [])
      if (!(key in value)) errors.push(`${at}.${key}: missing`)
    for (const [key, v] of Object.entries(value)) {
      if (node.properties[key])
        check(node.properties[key], v, `${at}.${key}`, errors)
      else if (node.additionalProperties === false)
        errors.push(`${at}.${key}: not in schema`)
    }
  }
  if (
    actual === 'object' &&
    !node.properties &&
    typeof node.additionalProperties === 'object'
  )
    for (const [key, v] of Object.entries(value))
      check(node.additionalProperties, v, `${at}.${key}`, errors)
  if (actual === 'array' && node.items)
    (value as unknown[]).forEach((v, i) =>
      check(node.items, v, `${at}[${i}]`, errors)
    )
}

function fakeRun(): SearchRunState {
  const text = 'The Corpus Hermeticum was translated by Ficino in 1471.'
  return {
    runId: 'run-test-1',
    userId: 'codex:user1',
    isGuest: false,
    createdAt: '2026-10-29T10:00:00.000Z',
    updatedAt: '2026-10-29T10:00:05.000Z',
    status: 'completed',
    request: {
      query: 'corpus hermeticum translations',
      mode: 'literature',
      depth: 'quick',
      tags: []
    } as any,
    scope: { policy: 'open', includeDomains: [], excludeDomains: [] } as any,
    plan: {} as any,
    budget: {} as any,
    providerAttempts: [
      {
        attemptId: 'a1',
        provider: 'searxng',
        variantId: 'v1',
        executedQuery: 'corpus hermeticum',
        status: 'succeeded',
        latencyMs: 10,
        rawResultCount: 2,
        acceptedResultCount: 2,
        filteredOutCount: 0,
        startedAt: '',
        completedAt: ''
      }
    ],
    results: [
      {
        id: 'src-1',
        citationLabel: 'S1',
        url: 'https://example.org/ch',
        normalizedUrl: 'https://example.org/ch',
        title: 'Corpus Hermeticum',
        snippet: 'Hermetic texts',
        hostname: 'example.org',
        path: '/ch',
        contentState: 'fulltext-excerpt',
        accessStatus: 'open-access',
        lane: 'wider-web',
        rrfScore: 0.03,
        firstProviderOrder: 0,
        provenance: [],
        evidenceIds: ['ev-1']
      } as any,
      {
        id: 'src-2',
        citationLabel: 'S2',
        url: 'https://example.org/other',
        normalizedUrl: 'https://example.org/other',
        title: 'Other',
        snippet: 'Snippet only',
        hostname: 'example.org',
        path: '/other',
        contentState: 'snippet',
        accessStatus: 'access-unknown',
        lane: 'wider-web',
        rrfScore: 0.02,
        firstProviderOrder: 1,
        provenance: [],
        evidenceIds: []
      } as any
    ],
    evidence: [
      {
        id: 'ev-1',
        sourceId: 'src-1',
        citationLabel: 'S1',
        sourceUrl: 'https://example.org/ch',
        title: 'Corpus Hermeticum',
        verbatimText: text,
        sha256: computeSha256Hex(text),
        contentState: 'fulltext-excerpt',
        mimeType: 'text/html',
        byteLength: text.length,
        extractedAt: '2026-10-29T10:00:03.000Z',
        locator: { type: 'css-heading', value: 'Introduction' },
        redirectChain: []
      }
    ],
    answers: [
      {
        id: 'ans-1',
        versionNumber: 1,
        createdAt: '2026-10-29T10:00:05.000Z',
        modelId: 'deepseek-flash',
        mode: 'synthesized',
        markdown: 'Ficino translated it [S1]; see also [S2] and [S9].',
        citations: {
          valid: false,
          citedLabels: ['S1', 'S2', 'S9'],
          resolvedLabels: ['S1', 'S2'],
          unresolvedLabels: ['S9']
        }
      }
    ],
    coverage: [],
    nextContinuationCursor: 0,
    warnings: []
  }
}

describe('acuity.research-bundle v1.1 contract', () => {
  it('real export matches the published JSON schema', () => {
    const bundle = exportRunToResearchBundle(fakeRun())
    const errors: string[] = []
    check(schema, bundle, '$', errors)
    expect(errors).toEqual([])
    expect(bundle.schemaVersion).toBe('acuity.research-bundle.v1.2')
    expect(bundle.sources[1].snippet).toBe('Snippet only')
    expect(bundle.coverage?.limitations.join(' ')).toContain(
      'no extracted passage'
    )
  })

  it('builds a structured citation map and reports unresolved labels', () => {
    const { citations, unresolved } = buildCitationMap(fakeRun())
    expect(citations.S1).toEqual({ sourceId: 'src-1', evidenceIds: ['ev-1'] })
    expect(citations.S2).toEqual({ sourceId: 'src-2', evidenceIds: [] })
    expect(unresolved).toEqual(['S9'])
  })

  it('validator re-verifies the section manifest', () => {
    const bundle = exportRunToResearchBundle(fakeRun())
    expect(validateResearchBundleForImport(bundle).valid).toBe(true)
    const tampered = JSON.parse(JSON.stringify(bundle))
    tampered.answer.markdown = 'tampered'
    const result = validateResearchBundleForImport(tampered)
    expect(result.valid).toBe(false)
    expect(result.errors.join(' ')).toContain('/answer')
  })

  it('example bundle validates against the schema but is rejected for import', () => {
    const example = JSON.parse(
      fs.readFileSync(
        path.join(process.cwd(), 'config/acuity/codex-bundle.example.json'),
        'utf8'
      )
    )
    const errors: string[] = []
    check(schema, example, '$', errors)
    expect(errors).toEqual([])
    expect(validateResearchBundleForImport(example).valid).toBe(false)
  })
})
