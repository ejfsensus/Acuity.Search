import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase/middleware', () => ({ updateSession: vi.fn() }))

import { config } from '../../../../proxy'

// Next compiles the matcher source as a path regexp anchored to the pathname.
const matcher = new RegExp(`^${config.matcher[0]}$`)

describe('proxy matcher', () => {
  it.each([
    '/fonts/Inter.woff2',
    '/fonts/Cormorant-Garamond.woff2',
    '/robots.txt',
    '/sitemap.xml',
    '/acuity-mark.svg',
    '/favicon.ico',
    '/_next/static/chunks/main.js'
  ])('does not run auth for static asset %s', path => {
    expect(matcher.test(path)).toBe(false)
  })

  it.each([
    '/',
    '/auth/login',
    '/api/acuity-search/runs',
    '/some/unknown/page'
  ])('still runs for app route %s', path => {
    expect(matcher.test(path)).toBe(true)
  })
})
