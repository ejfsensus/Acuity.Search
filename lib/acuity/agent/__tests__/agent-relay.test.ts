import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  buildCitationMap,
  exportRunToResearchBundle,
  validateResearchBundleForImport
} from '@/lib/acuity/export'
import type { SearchStreamEvent } from '@/lib/acuity/search/contracts'
import { executeFederatedSearchRun } from '@/lib/acuity/search/federate'
import { toPublicEvent, toPublicRun } from '@/lib/acuity/search/public-view'

import { onBehalfOf } from '../client'
import {
  type AgentSource,
  isQuotedVerbatim,
  mapAgentRun,
  parseAgentSources,
  rewriteAnswerCitations,
  sourcesFromToolOutput,
  stageLabel,
  urlForAgentSource
} from '../map'
import { tryAcquireAgentSlot } from '../semaphore'
import { UiStreamParser } from '../sse'

const PASSAGE =
  'Blessed are the poor in spirit, for theirs is the kingdom of heaven and the light within.'

const sources: AgentSource[] = [
  {
    ref: 'corpus:docs/sacred-texts/source1_ista/chr/thomas.txt:L10-14',
    origin: 'local-corpus',
    title: 'thomas',
    path: 'docs/sacred-texts/source1_ista/chr/thomas.txt',
    lineStart: 10,
    lineEnd: 14,
    sourceUrl: 'https://sacred-texts.com/chr/thomas.txt',
    licence: 'Public domain',
    text: PASSAGE,
    cited: true,
    label: 'S1'
  },
  {
    ref: 'gita#3',
    origin: 'sacred-text-index',
    title: 'Bhagavad Gita',
    tradition: 'Hindu',
    bookCode: 'gita',
    passageId: 'gita#3',
    text: 'Yoga is skill in action.',
    cited: false
  }
]

function sse(chunks: unknown[]): string {
  return (
    chunks.map(c => `data: ${JSON.stringify(c)}\n\n`).join('') +
    'data: [DONE]\n\n'
  )
}

describe('UiStreamParser', () => {
  it('handles split chunks, [DONE] and malformed lines', () => {
    const p = new UiStreamParser()
    const text =
      sse([{ type: 'start' }, { type: 'text-delta', delta: 'Hi' }]) +
      'data: {bad\n\n'
    const out = [
      ...p.push(text.slice(0, 7)),
      ...p.push(text.slice(7, 40)),
      ...p.push(text.slice(40)),
      ...p.end()
    ]
    expect(out.map(c => c.type)).toEqual(['start', 'text-delta'])
    expect(p.done).toBe(true)
  })
})

describe('map', () => {
  it('parses only the v1 schema and sanitises fields', () => {
    expect(parseAgentSources({ sources: [{ category: 'x' }] })).toEqual([])
    const parsed = parseAgentSources({
      schema: 'acuity.agent-sources.v1',
      sources: [
        {
          ...sources[0],
          text: 'a\u0000b',
          label: 'bad',
          sourceUrl: 'javascript:x'
        }
      ]
    })
    expect(parsed[0]!.text).toBe('ab')
    expect(parsed[0]!.label).toBeUndefined()
    expect(parsed[0]!.sourceUrl).toBeUndefined()
  })

  it('maps sources keeping Agent labels, numbering the rest, rewriting citations', () => {
    const answer = `In source1_ista/chr/thomas.txt we read "${PASSAGE}"`
    const mapped = mapAgentRun({ sources, answer, question: 'q' })
    expect(mapped.results.map(r => r.citationLabel)).toEqual(['S1', 'S2'])
    expect(mapped.markdown).toContain('thomas.txt [S1]')
    expect(mapped.markdown).not.toContain('docs/sacred-texts')
    expect(mapped.results[0]!.passage?.verbatim).toBe(true)
    expect(mapped.results[1]!.url).toBe(
      'https://agent.acuity.institute/library/gita'
    )
    expect(mapped.evidence[1]!.locator).toEqual({
      type: 'css-heading',
      value: 'gita#3'
    })
    expect(mapped.evidence[0]!.locator.value).toBe('L10-14')
  })

  it('pseudo-URL for local files without a public page', () => {
    expect(urlForAgentSource({ ...sources[0]!, sourceUrl: undefined })).toBe(
      'https://agent.acuity.institute/library/source1_ista/chr/thomas.txt'
    )
  })

  it('does not double-label and ignores missing mentions', () => {
    expect(rewriteAnswerCitations('See thomas [S1].', [sources[0]!])).toBe(
      'See thomas [S1].'
    )
    expect(rewriteAnswerCitations('Nothing here.', [sources[0]!])).toBe(
      'Nothing here.'
    )
  })

  it('fallback: sacred-text tool output', () => {
    const out = sourcesFromToolOutput('sacred-text-mcp', {
      status: 'done',
      success: true,
      text: JSON.stringify({
        results: [{ id: 'b#1', book: 'b', title: 'Book', text: 'x' }]
      })
    })
    expect(out[0]!.passageId).toBe('b#1')
    expect(sourcesFromToolOutput('bash', {})).toEqual([])
  })

  it('stage labels never expose commands', () => {
    expect(
      stageLabel('bash', { command: 'grep -rn x docs/sacred-texts' })
    ).toBe('Scanning the Library corpus')
    expect(
      stageLabel('sacred-text-mcp', { action: 'get_passage', book: 'gita' })
    ).toBe('Reading gita')
    expect(stageLabel('sacred-text-mcp', { action: 'search' })).toBe(
      'Searching the passage index'
    )
  })

  it('verbatim needs a 40+ char sentence', () => {
    expect(isQuotedVerbatim('short', 'short.')).toBe(false)
  })
})

describe('semaphore and on-behalf-of', () => {
  it('caps concurrency and releases once', () => {
    const a = tryAcquireAgentSlot(1)
    expect(a).toBeTruthy()
    expect(tryAcquireAgentSlot(1)).toBeNull()
    a!()
    a!()
    const b = tryAcquireAgentSlot(1)
    expect(b).toBeTruthy()
    b!()
  })
  it('hashes the user id', () => {
    expect(onBehalfOf('user@example.test')).toMatch(/^[0-9a-f]{32}$/)
    expect(onBehalfOf('user@example.test')).not.toContain('@')
  })
})

describe('executeAgentRun via federate', () => {
  const env = { ...process.env }
  beforeEach(() => {
    process.env.ACUITY_SEARCH_SACRED_TEXTS_ENABLED = 'true'
    process.env.ACUITY_AGENT_API_URL = 'https://agent.example.test'
    process.env.ACUITY_AGENT_API_KEY = 'test-key'
  })
  afterEach(() => {
    process.env = { ...env }
  })

  function fakeAgent(
    stream: string,
    status = 200
  ): {
    fetchImpl: typeof fetch
    calls: Array<{ url: string; headers: Record<string, string> }>
  } {
    const calls: Array<{ url: string; headers: Record<string, string> }> = []
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      calls.push({ url, headers: init?.headers as Record<string, string> })
      if (String(url).endsWith('/api/chats'))
        return new Response('{}', { status })
      if (init?.method === 'POST')
        return new Response(stream, {
          status: 200,
          headers: { 'content-type': 'text/event-stream' }
        })
      return new Response('{}', { status: 404 })
    }) as unknown as typeof fetch
    return { fetchImpl, calls }
  }

  const happy = sse([
    { type: 'start' },
    {
      type: 'tool-input-available',
      toolCallId: 't1',
      toolName: 'bash',
      input: { command: 'grep -rn light docs/sacred-texts' }
    },
    {
      type: 'tool-output-available',
      toolCallId: 't1',
      output: {
        commands: [
          { command: 'grep', stdout: 'docs/sacred-texts/x:1:y', exitCode: 0 }
        ]
      }
    },
    {
      type: 'text-delta',
      id: 'a',
      delta: `In source1_ista/chr/thomas.txt we read "${PASSAGE}"`
    },
    {
      type: 'data-sources',
      id: 'sources',
      data: { schema: 'acuity.agent-sources.v1', sources }
    },
    { type: 'finish' }
  ])

  it('runs, maps, exports a valid v1.2 bundle and keeps the browser free of internals', async () => {
    const { fetchImpl, calls } = fakeAgent(happy)
    const events: SearchStreamEvent[] = []
    const run = await executeFederatedSearchRun(
      { query: 'light', mode: 'sacred-texts' },
      {
        runId: 'r1',
        userId: 'u1',
        isGuest: false,
        onEvent: e => events.push(e),
        fetchImpl
      }
    )
    expect(run.status).toBe('completed')
    expect(run.results).toHaveLength(2)
    expect(run.answers[0]!.markdown).toContain('[S1]')
    expect(calls[0]!.headers['x-acuity-on-behalf-of']).toMatch(/^[0-9a-f]{32}$/)
    expect(calls[0]!.headers.Authorization).toBe('Bearer test-key')

    const browser = JSON.stringify([
      ...events.map(toPublicEvent),
      toPublicRun(run)
    ])
    expect(browser).not.toContain('docs/sacred-texts')
    expect(browser).not.toContain('grep')
    expect(browser).not.toContain('agent.example.test')
    expect(browser).not.toContain('test-key')
    expect(
      events.some(
        e =>
          e.type === 'agent.Stage' && e.label === 'Scanning the Library corpus'
      )
    ).toBe(true)

    const bundle = exportRunToResearchBundle(run)
    expect(bundle.schemaVersion).toBe('acuity.research-bundle.v1.2')
    expect(bundle.queryRun.discoveryMode).toBe('sacred-texts')
    expect(bundle.provenance?.delegate?.product).toBe('Acuity.Agent')
    expect(bundle.sources[0]!.passageRef).not.toContain('docs/sacred-texts')
    expect(bundle.evidence[0]!.verbatim).toBe(true)
    expect(validateResearchBundleForImport(bundle).valid).toBe(true)
    expect(buildCitationMap(run).citations.S1?.sourceId).toBe('agent-1')
  })

  it('guests and a disabled flag never call the Agent', async () => {
    const { fetchImpl, calls } = fakeAgent(happy)
    await expect(
      executeFederatedSearchRun(
        { query: 'x', mode: 'sacred-texts' },
        { userId: 'g', isGuest: true, fetchImpl }
      )
    ).rejects.toThrow('Sign in')
    process.env.ACUITY_SEARCH_SACRED_TEXTS_ENABLED = 'false'
    await expect(
      executeFederatedSearchRun(
        { query: 'x', mode: 'sacred-texts' },
        { userId: 'u', isGuest: false, fetchImpl }
      )
    ).rejects.toThrow('unavailable')
    expect(calls).toHaveLength(0)
  })

  it('maps a 429 to the limit message', async () => {
    const { fetchImpl } = fakeAgent(happy, 429)
    await expect(
      executeFederatedSearchRun(
        { query: 'x', mode: 'sacred-texts' },
        { userId: 'u', isGuest: false, fetchImpl }
      )
    ).rejects.toThrow('limit')
  })

  it('EOF without finish is partial; synthesis failure keeps passages', async () => {
    const partial = sse([
      {
        type: 'data-sources',
        data: { schema: 'acuity.agent-sources.v1', sources }
      }
    ]).replace('data: [DONE]\n\n', '')
    const a = await executeFederatedSearchRun(
      { query: 'x', mode: 'sacred-texts' },
      { userId: 'u', isGuest: false, fetchImpl: fakeAgent(partial).fetchImpl }
    )
    expect(a.status).toBe('partial')
    const failed = sse([
      {
        type: 'text-delta',
        delta:
          'The search finished, but the model service could not complete the synthesis.'
      },
      {
        type: 'data-sources',
        data: { schema: 'acuity.agent-sources.v1', sources }
      },
      { type: 'finish' }
    ])
    const b = await executeFederatedSearchRun(
      { query: 'x', mode: 'sacred-texts' },
      { userId: 'u', isGuest: false, fetchImpl: fakeAgent(failed).fetchImpl }
    )
    expect(b.status).toBe('partial')
    expect(b.answers[0]!.mode).toBe('fallback-results-only')
    expect(b.results).toHaveLength(2)
  })
})
