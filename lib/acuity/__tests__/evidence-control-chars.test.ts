import { describe, expect, it } from 'vitest'

import {
  computeVerbatimSha256,
  createSnippetEvidenceRecord,
  stripControlChars
} from '@/lib/acuity/search/evidence'

describe('evidence control characters', () => {
  it('strips NUL/C0 bytes but keeps whitespace', () => {
    expect(stripControlChars('a\u0000b\u0002c\td\ne')).toBe('abc\td\ne')
  })
  it('hashes the cleaned text so Codex integrity checks still pass', () => {
    const ev = createSnippetEvidenceRecord({
      evidenceId: 'e1',
      source: {
        id: 's1',
        citationLabel: 'S1',
        url: 'https://example.org/a.pdf',
        title: 'PDF',
        snippet: '%PDF\u0000\u0001 text',
        contentState: 'snippet-only'
      } as never
    })
    expect(ev.verbatimText).not.toMatch(/\u0000/)
    expect(JSON.stringify(ev)).not.toContain('\\u0000')
    expect(ev.sha256).toBe(computeVerbatimSha256(ev.verbatimText))
  })
})
