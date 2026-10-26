import { describe, expect, it } from 'vitest'

import type { SourceResult } from '@/lib/acuity/search/contracts'
import { awaitWithDeadline } from '@/lib/acuity/search/federate'
import {
  assessSourceQuality,
  classifySourceTier,
  lexicalRelevance
} from '@/lib/acuity/search/source-quality'

function src(i: number, hostname: string, title: string, snippet = ''): SourceResult {
  return {
    id: `s${i}`,
    citationLabel: `S${i}`,
    url: `https://${hostname}/p${i}`,
    normalizedUrl: `https://${hostname}/p${i}`,
    title,
    snippet,
    hostname,
    path: `/p${i}`,
    contentState: 'snippet-only',
    accessStatus: 'unknown',
    lane: 'wider-web',
    rrfScore: 1 / (60 + i),
    firstProviderOrder: i,
    provenance: [],
    evidenceIds: []
  } as unknown as SourceResult
}

describe('classifySourceTier', () => {
  it('flags social, dictionary and entertainment hosts as low', () => {
    for (const h of ['www.imdb.com', 'pinterest.co.uk', 'www.instagram.com', 'www.urbandictionary.com', 'www.merriam-webster.com']) {
      expect(classifySourceTier(h)).toBe('low')
    }
  })
  it('recognises scholarly hosts and academic TLDs', () => {
    expect(classifySourceTier('plato.stanford.edu')).toBe('scholarly')
    expect(classifySourceTier('www.sacred-texts.com')).toBe('scholarly')
    expect(classifySourceTier('divinity.uchicago.edu')).toBe('scholarly')
  })
  it('prefers the curated registry over heuristics', () => {
    expect(classifySourceTier('www.gnosis.org', new Set(['gnosis.org']))).toBe('curated')
  })
  it('defaults to general', () => {
    expect(classifySourceTier('example.org')).toBe('general')
  })
})

describe('lexicalRelevance', () => {
  it('scores term overlap and ignores stopwords', () => {
    expect(lexicalRelevance('what is the Pleroma in gnosticism', { title: 'The Pleroma', snippet: 'Gnosticism teaches', url: '' })).toBe(1)
    expect(lexicalRelevance('xqzv florp', { title: 'Instagram', snippet: '', url: '' })).toBe(0)
  })
})

describe('assessSourceQuality', () => {
  it('pushes low-tier sources to the end and relabels citations', () => {
    const out = assessSourceQuality({
      query: 'meaning of love in mysticism',
      relabel: true,
      results: [
        src(1, 'www.imdb.com', 'Love (2015) film'),
        src(2, 'www.merriam-webster.com', 'Love definition'),
        src(3, 'plato.stanford.edu', 'Love in mysticism', 'meaning'),
        src(4, 'example.org', 'Mysticism and love', 'meaning'),
        src(5, 'www.sacred-texts.com', 'Mystic love', 'meaning of love')
      ]
    })
    expect(out.results.slice(-2).every(r => r.qualityTier === 'low')).toBe(true)
    expect(out.results[0].hostname).toBe('plato.stanford.edu')
    expect(out.results.map(r => r.citationLabel)).toEqual(['S1', 'S2', 'S3', 'S4', 'S5'])
    expect(out.evidenceStrength).toBe('strong')
    expect(out.lowCount).toBe(2)
  })

  it("reports 'none' when only off-topic or low sources exist", () => {
    const out = assessSourceQuality({
      query: 'xqzv florp',
      results: [src(1, 'www.instagram.com', 'Instagram'), src(2, 'example.org', 'Unrelated')]
    })
    expect(out.evidenceStrength).toBe('none')
  })
})

describe('awaitWithDeadline', () => {
  it('returns false when work finishes first', async () => {
    expect(await awaitWithDeadline(Promise.resolve(), 50, 100, () => true)).toBe(false)
  })
  it('stops at the soft deadline when enough has arrived', async () => {
    const t0 = Date.now()
    const hit = await awaitWithDeadline(new Promise(r => setTimeout(r, 1000)), 30, 500, () => true)
    expect(hit).toBe(true)
    expect(Date.now() - t0).toBeLessThan(300)
  })
  it('keeps waiting to the hard deadline when nothing has arrived', async () => {
    const t0 = Date.now()
    const hit = await awaitWithDeadline(new Promise(r => setTimeout(r, 1000)), 20, 120, () => false)
    expect(hit).toBe(true)
    expect(Date.now() - t0).toBeGreaterThanOrEqual(110)
  })
})
