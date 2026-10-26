import { describe, expect, it } from 'vitest'

import type { SearchStreamEvent } from '@/lib/acuity/search/contracts'
import {
  initialProgress,
  parseSseChunk,
  progressFraction,
  reduceProgress
} from '@/lib/acuity/search/progress'

describe('parseSseChunk', () => {
  it('parses complete events and keeps the partial tail', () => {
    const a =
      'event: plan.Created\ndata: {"type":"plan.Created","runId":"r","plan":{"variants":[]}}\n\n'
    const b = 'event: answer.Delta\ndata: {"type":"answer.Del'
    const { events, rest } = parseSseChunk(a + b)
    expect(events).toHaveLength(1)
    expect(events[0].type).toBe('plan.Created')
    expect(rest).toBe(b)
    const more = parseSseChunk(rest + 'ta","runId":"r","textDelta":"Hi"}\n\n')
    expect(more.events[0]).toEqual({
      type: 'answer.Delta',
      runId: 'r',
      textDelta: 'Hi'
    })
  })
  it('tolerates CRLF and malformed blocks', () => {
    const { events } = parseSseChunk(
      'data: nope\r\n\r\ndata: {"type":"run.Error","runId":"r","error":"x"}\r\n\r\n'
    )
    expect(events).toEqual([{ type: 'run.Error', runId: 'r', error: 'x' }])
  })
})

describe('reduceProgress', () => {
  it('walks the stages monotonically', () => {
    const evs = [
      {
        type: 'plan.Created',
        runId: 'r',
        plan: { variants: [{ query: 'q' }] }
      },
      { type: 'provider.Started', runId: 'r', provider: 'brave', query: 'q' },
      { type: 'provider.Completed', runId: 'r', attempt: {} },
      {
        type: 'results.Updated',
        runId: 'r',
        results: [{ id: 's1' }, { id: 's2', qualityTier: 'low' }]
      },
      { type: 'extraction.Completed', runId: 'r', evidence: {} },
      { type: 'answer.Delta', runId: 'r', textDelta: 'The ' },
      { type: 'answer.Delta', runId: 'r', textDelta: 'Pleroma' },
      { type: 'provider.Started', runId: 'r', provider: 'exa', query: 'q' },
      { type: 'answer.Completed', runId: 'r', answer: {} }
    ] as unknown as SearchStreamEvent[]
    let p = initialProgress()
    const fractions: number[] = []
    for (const e of evs) {
      p = reduceProgress(p, e)
      fractions.push(progressFraction(p))
    }
    expect(p.stage).toBe('verifying')
    expect(p.answerText).toBe('The Pleroma')
    expect(p.results).toHaveLength(2)
    expect(p.extractionsPlanned).toBe(1)
    expect(fractions[fractions.length - 1]).toBeGreaterThan(fractions[0])
  })
})
