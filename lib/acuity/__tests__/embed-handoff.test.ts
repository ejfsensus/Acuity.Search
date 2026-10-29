import crypto from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { SearchRunState } from '@/lib/acuity/search/contracts'

import {
  clearEmbedStateForTests,
  EMBED_SESSION_COOKIE_NAME,
  embedFrameAncestors,
  signLaunchTokenForTests,
  verifyEmbedSession,
  verifyLaunchToken
} from '../embed'
import {
  handoffIdempotencyKey,
  sendHandoffToCodex,
  sha256Hex,
  signHandoff
} from '../handoff'
import { clearAcuityStoreForTests, saveSearchRun } from '../store'

const SECRET = 'l'.repeat(40)
const HANDOFF = 'h'.repeat(40)
const now = () => Math.floor(Date.now() / 1000)

function launch(over: Record<string, unknown> = {}, secret = SECRET) {
  return signLaunchTokenForTests(
    {
      iss: 'acuity-codex',
      aud: 'acuity-search',
      sub: 'user:alice',
      jti: crypto.randomUUID(),
      iat: now(),
      exp: now() + 60,
      ctx: { kind: 'sphere', workspaceId: 'workspace:abc', title: 'Gnosis' },
      ...over
    },
    secret
  )
}

beforeEach(() => {
  vi.stubEnv('ACUITY_EMBED_ENABLED', 'true')
  vi.stubEnv('ACUITY_EMBED_LAUNCH_SECRET', SECRET)
  vi.stubEnv('ACUITY_EMBED_ALLOWED_ORIGINS', 'https://codex.acuity.institute')
  vi.stubEnv('ACUITY_HANDOFF_SECRET', HANDOFF)
  vi.stubEnv('CODEX_INTERNAL_URL', 'http://codex.internal:5055')
  clearEmbedStateForTests()
  clearAcuityStoreForTests()
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('launch token', () => {
  it('accepts a valid token and parses context', () => {
    const r = verifyLaunchToken(launch())
    expect(r.ok && r.claims.ctx).toEqual({
      kind: 'sphere',
      workspaceId: 'workspace:abc',
      title: 'Gnosis'
    })
  })
  it.each([
    ['bad signature', launch({}, 'x'.repeat(40))],
    ['token expired', launch({ iat: now() - 120, exp: now() - 1 })],
    ['token lifetime invalid', launch({ exp: now() + 3600 })],
    ['wrong issuer/audience', launch({ aud: 'other' })],
    ['invalid ctx', launch({ ctx: { kind: 'sphere' } })],
    ['malformed token', 'abc']
  ])('rejects: %s', (error, token) => {
    expect(verifyLaunchToken(token)).toEqual({ ok: false, error })
  })
  it('rejects alg none', () => {
    const [, body] = launch().split('.')
    const head = Buffer.from('{"alg":"none"}').toString('base64url')
    expect(verifyLaunchToken(`${head}.${body}.`).ok).toBe(false)
  })
})

describe('embed session route', () => {
  async function post(token: string) {
    const { POST } = await import('@/app/api/acuity-search/embed/session/route')
    return POST(
      new Request('http://search/api/acuity-search/embed/session', {
        method: 'POST',
        body: JSON.stringify({ token })
      })
    )
  }
  it('sets a session cookie once and rejects replay', async () => {
    const token = launch()
    const first = await post(token)
    expect(first.status).toBe(200)
    const cookie = first.headers.get('set-cookie') ?? ''
    expect(cookie).toContain(`${EMBED_SESSION_COOKIE_NAME}=`)
    expect(cookie).toContain('HttpOnly')
    expect(cookie).toContain('SameSite=Lax')
    expect(cookie).not.toContain('Secure') // plain http in tests
    const value = decodeURIComponent(cookie.split(';')[0].split('=')[1])
    expect(verifyEmbedSession(value)?.sub).toBe('user:alice')
    expect((await post(token)).status).toBe(401)
  })
  it('marks the cookie Secure; Partitioned behind an HTTPS proxy', async () => {
    const { POST } = await import('@/app/api/acuity-search/embed/session/route')
    const res = await POST(
      new Request('http://search/api/acuity-search/embed/session', {
        method: 'POST',
        headers: { 'x-forwarded-proto': 'https' },
        body: JSON.stringify({ token: launch() })
      })
    )
    expect(res.headers.get('set-cookie')).toContain('Secure; Partitioned')
  })
  it('404s when embed mode is off (standalone unchanged)', async () => {
    vi.stubEnv('ACUITY_EMBED_ENABLED', 'false')
    expect((await post(launch())).status).toBe(404)
  })
  it('frame-ancestors allows only the Codex origin', () => {
    expect(embedFrameAncestors()).toBe(
      'frame-ancestors https://codex.acuity.institute'
    )
    vi.stubEnv('ACUITY_EMBED_ALLOWED_ORIGINS', '')
    expect(embedFrameAncestors()).toBe("frame-ancestors 'none'")
  })
})

describe('handoff', () => {
  it('signs ts.nonce.sha256(body) and sends idempotency key', async () => {
    const fetchMock = vi.fn(
      async (_url: string, _init: RequestInit) =>
        new Response(
          JSON.stringify({ import_id: 'imp1', workspace_id: 'workspace:abc' }),
          { status: 200 }
        )
    )
    const target = { kind: 'sphere' as const, workspaceId: 'workspace:abc' }
    const key = handoffIdempotencyKey('run1', 'ans1', target)
    expect(key).toBe(handoffIdempotencyKey('run1', 'ans1', target))
    expect(key).not.toBe(handoffIdempotencyKey('run1', 'ans2', target))
    const r = await sendHandoffToCodex(
      {
        bundle: { a: 1 },
        codexUserId: 'user:alice',
        target,
        idempotencyKey: key
      },
      process.env,
      fetchMock as unknown as typeof fetch
    )
    expect(r).toMatchObject({ ok: true, importId: 'imp1' })
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('http://codex.internal:5055/api/acuity/search/import')
    const h = init.headers as Record<string, string>
    const body = init.body as string
    expect(h['Idempotency-Key']).toBe(key)
    expect(h['X-Acuity-Signature']).toBe(
      signHandoff(
        body,
        HANDOFF,
        Number(h['X-Acuity-Timestamp']),
        h['X-Acuity-Nonce']
      )
    )
    const expected = crypto
      .createHmac('sha256', HANDOFF)
      .update(
        `${h['X-Acuity-Timestamp']}.${h['X-Acuity-Nonce']}.${sha256Hex(body)}`
      )
      .digest('hex')
    expect(h['X-Acuity-Signature']).toBe(expected)
  })

  it('handoff route enforces ownership and forwards the bundle', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ import_id: 'imp9', workspace_id: 'w' }), {
          status: 200
        })
    )
    vi.stubGlobal('fetch', fetchMock)
    const { signEmbedSession } = await import('../embed')
    saveSearchRun({
      runId: 'run-owned',
      userId: 'codex:user:alice',
      isGuest: false,
      createdAt: '',
      updatedAt: '',
      status: 'completed',
      request: { query: 'q' } as any,
      scope: { policy: 'open', includeDomains: [], excludeDomains: [] } as any,
      providerAttempts: [],
      results: [],
      evidence: [],
      answers: [],
      coverage: [],
      warnings: []
    } as unknown as SearchRunState)
    const { POST } = await import(
      '@/app/api/acuity-search/runs/[id]/handoff/route'
    )
    const call = (sub: string) =>
      POST(
        new Request('http://search/x', {
          method: 'POST',
          headers: {
            cookie: `${EMBED_SESSION_COOKIE_NAME}=${encodeURIComponent(
              signEmbedSession({ sub, ctx: { kind: 'home' } })
            )}`
          },
          body: '{"title":"New sphere"}'
        }),
        { params: Promise.resolve({ id: 'run-owned' }) }
      )
    expect((await call('user:mallory')).status).toBe(404)
    expect(fetchMock).not.toHaveBeenCalled()
    const ok = await call('user:alice')
    expect(ok.status).toBe(200)
    expect(await ok.json()).toMatchObject({ importId: 'imp9' })
    const sent = JSON.parse((fetchMock.mock.calls[0] as any)[1].body)
    expect(sent.target).toEqual({ kind: 'home' })
    expect(sent.title).toBe('New sphere')
    expect(sent.bundle.schemaVersion).toBe('acuity.research-bundle.v1.1')
  })
})
