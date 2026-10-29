import { NextResponse } from 'next/server'

import {
  claimJti,
  embedSessionCookie,
  isEmbedEnabled,
  signEmbedSession,
  verifyLaunchToken
} from '@/lib/acuity/embed'

export const dynamic = 'force-dynamic'

/** Exchanges a single-use Codex launch token for an embed session cookie. */
export async function POST(req: Request) {
  if (!isEmbedEnabled())
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const { token } = (await req.json().catch(() => ({}))) as { token?: string }
  if (!token || typeof token !== 'string')
    return NextResponse.json({ error: 'token required' }, { status: 400 })
  const verified = verifyLaunchToken(token)
  if (!verified.ok)
    return NextResponse.json({ error: verified.error }, { status: 401 })
  const { claims } = verified
  if (!(await claimJti(claims.jti, claims.exp)))
    return NextResponse.json({ error: 'token already used' }, { status: 401 })
  const session = signEmbedSession({ sub: claims.sub, ctx: claims.ctx })
  const res = NextResponse.json({ ok: true, ctx: claims.ctx })
  res.headers.append('Set-Cookie', embedSessionCookie(session))
  res.headers.set('Cache-Control', 'no-store')
  return res
}
