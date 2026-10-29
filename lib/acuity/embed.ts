/**
 * Embedded mode: Acuity.Search inside an Acuity.Codex iframe.
 *
 * Codex mints a short-lived HS256 launch token (ACUITY_EMBED_LAUNCH_SECRET)
 * and passes it in the URL fragment. /embed/launch exchanges it once (jti is
 * single-use) for an HttpOnly embed session cookie whose actor is
 * `codex:<sub>`. Everything is off unless ACUITY_EMBED_ENABLED=true.
 */
import crypto from 'node:crypto'

import { isEmbedEnabled } from '@/lib/acuity/embed-config'
import { claimLaunchJti, isPgStoreEnabled } from '@/lib/acuity/store-pg'

export {
  embedAllowedOrigins,
  embedFrameAncestors,
  isEmbedEnabled
} from '@/lib/acuity/embed-config'

type Env = Record<string, string | undefined>

export const EMBED_SESSION_COOKIE_NAME = 'acuity_embed_session'
export const LAUNCH_ISSUER = 'acuity-codex'
export const LAUNCH_AUDIENCE = 'acuity-search'
const MAX_LAUNCH_TTL_S = 120
const SESSION_TTL_S = 8 * 60 * 60

export type EmbedContext =
  | { kind: 'sphere'; workspaceId: string; title?: string }
  | { kind: 'home' }

export interface EmbedSession {
  sub: string
  ctx: EmbedContext
  exp: number
}

function launchSecret(env: Env = process.env): string | null {
  const s = env.ACUITY_EMBED_LAUNCH_SECRET?.trim()
  return s && s.length >= 32 ? s : null
}

const b64url = (buf: Buffer | string) => Buffer.from(buf).toString('base64url')

function hmac(secret: string, data: string): Buffer {
  return crypto.createHmac('sha256', secret).update(data).digest()
}

function safeEqual(a: Buffer, b: Buffer): boolean {
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}

/** Test helper / reference implementation of what Codex signs. */
export function signLaunchTokenForTests(
  claims: Record<string, unknown>,
  secret: string
): string {
  const head = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const body = b64url(JSON.stringify(claims))
  return `${head}.${body}.${b64url(hmac(secret, `${head}.${body}`))}`
}

export interface LaunchClaims {
  sub: string
  jti: string
  exp: number
  iat: number
  ctx: EmbedContext
}

export function verifyLaunchToken(
  token: string,
  env: Env = process.env,
  nowS = Math.floor(Date.now() / 1000)
): { ok: true; claims: LaunchClaims } | { ok: false; error: string } {
  const secret = launchSecret(env)
  if (!secret) return { ok: false, error: 'embed launch secret not configured' }
  const parts = token.split('.')
  if (parts.length !== 3) return { ok: false, error: 'malformed token' }
  const [head, body, sig] = parts
  let header: any, claims: any
  try {
    header = JSON.parse(Buffer.from(head, 'base64url').toString('utf8'))
    claims = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'))
  } catch {
    return { ok: false, error: 'malformed token' }
  }
  if (header?.alg !== 'HS256') return { ok: false, error: 'unsupported alg' }
  if (
    !safeEqual(Buffer.from(sig, 'base64url'), hmac(secret, `${head}.${body}`))
  )
    return { ok: false, error: 'bad signature' }
  if (claims.iss !== LAUNCH_ISSUER || claims.aud !== LAUNCH_AUDIENCE)
    return { ok: false, error: 'wrong issuer/audience' }
  if (typeof claims.exp !== 'number' || typeof claims.iat !== 'number')
    return { ok: false, error: 'missing exp/iat' }
  if (claims.exp <= nowS) return { ok: false, error: 'token expired' }
  if (claims.iat > nowS + 30 || claims.exp - claims.iat > MAX_LAUNCH_TTL_S)
    return { ok: false, error: 'token lifetime invalid' }
  if (typeof claims.sub !== 'string' || !/^[\w:.-]{1,128}$/.test(claims.sub))
    return { ok: false, error: 'invalid sub' }
  if (typeof claims.jti !== 'string' || claims.jti.length < 16)
    return { ok: false, error: 'invalid jti' }
  const ctx = claims.ctx
  let parsedCtx: EmbedContext
  if (ctx?.kind === 'home') parsedCtx = { kind: 'home' }
  else if (
    ctx?.kind === 'sphere' &&
    typeof ctx.workspaceId === 'string' &&
    /^[\w:.-]{1,128}$/.test(ctx.workspaceId)
  )
    parsedCtx = {
      kind: 'sphere',
      workspaceId: ctx.workspaceId,
      title: typeof ctx.title === 'string' ? ctx.title.slice(0, 200) : undefined
    }
  else return { ok: false, error: 'invalid ctx' }
  return {
    ok: true,
    claims: {
      sub: claims.sub,
      jti: claims.jti,
      exp: claims.exp,
      iat: claims.iat,
      ctx: parsedCtx
    }
  }
}

const memoryJtis = new Map<string, number>()

/** Single-use launch ids: Postgres when available, else process memory. */
export async function claimJti(jti: string, expS: number): Promise<boolean> {
  if (isPgStoreEnabled()) return claimLaunchJti(jti, new Date(expS * 1000))
  const now = Date.now() / 1000
  for (const [k, v] of memoryJtis) if (v < now) memoryJtis.delete(k)
  if (memoryJtis.has(jti)) return false
  memoryJtis.set(jti, expS)
  return true
}

export function clearEmbedStateForTests(): void {
  memoryJtis.clear()
}

function sessionKey(env: Env): string | null {
  const s = launchSecret(env)
  return s ? `embed-session:${s}` : null
}

export function signEmbedSession(
  session: Omit<EmbedSession, 'exp'>,
  env: Env = process.env,
  nowS = Math.floor(Date.now() / 1000)
): string {
  const key = sessionKey(env)
  if (!key) throw new Error('embed launch secret not configured')
  const body = b64url(JSON.stringify({ ...session, exp: nowS + SESSION_TTL_S }))
  return `${body}.${b64url(hmac(key, body))}`
}

export function verifyEmbedSession(
  value: string | null | undefined,
  env: Env = process.env,
  nowS = Math.floor(Date.now() / 1000)
): EmbedSession | null {
  if (!value || !isEmbedEnabled(env)) return null
  const key = sessionKey(env)
  if (!key) return null
  const [body, sig] = value.split('.')
  if (!body || !sig) return null
  if (!safeEqual(Buffer.from(sig, 'base64url'), hmac(key, body))) return null
  try {
    const parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'))
    if (typeof parsed.exp !== 'number' || parsed.exp <= nowS) return null
    if (typeof parsed.sub !== 'string') return null
    return parsed as EmbedSession
  } catch {
    return null
  }
}

export function embedSessionCookie(
  value: string,
  env: Env = process.env
): string {
  const secure = env.NODE_ENV === 'production'
  // codex.* and search.* are same-site subdomains, so Lax is sent in the
  // iframe; Partitioned keeps it in CHIPS storage if browsers partition anyway.
  return `${EMBED_SESSION_COOKIE_NAME}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL_S}${secure ? '; Secure; Partitioned' : ''}`
}

export function readCookie(header: string | null, name: string): string | null {
  if (!header) return null
  for (const pair of header.split(';')) {
    const i = pair.indexOf('=')
    if (i > 0 && pair.slice(0, i).trim() === name)
      return decodeURIComponent(pair.slice(i + 1).trim())
  }
  return null
}

export function embedSessionFromRequest(req?: Request): EmbedSession | null {
  if (!req || !isEmbedEnabled()) return null
  return verifyEmbedSession(
    readCookie(req.headers.get('cookie'), EMBED_SESSION_COOKIE_NAME)
  )
}
