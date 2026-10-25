import crypto from 'node:crypto'

import { getAcuityConfig } from '@/lib/acuity/config'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { isAnonymousMode } from '@/lib/auth/provider'

export const GUEST_SESSION_COOKIE_NAME = 'acuity_guest_session'

export interface ResolvedActorIdentity {
  actorId: string
  isGuest: boolean
  setCookieHeader?: string
}

export function signGuestSessionToken(guestId: string, secret: string): string {
  const cleanId = guestId.replace(/[^a-zA-Z0-9_-]/g, '')
  const mac = crypto
    .createHmac('sha256', secret)
    .update(`acuity-guest:${cleanId}`)
    .digest('hex')
  return `${cleanId}.${mac}`
}

export function verifyGuestSessionToken(
  token: string | undefined | null,
  secret: string
): string | null {
  if (!token || typeof token !== 'string') return null
  const parts = token.split('.')
  if (parts.length !== 2) return null
  const [guestId, providedMac] = parts
  if (!guestId || !/^[a-zA-Z0-9_-]{8,64}$/.test(guestId)) return null
  if (!providedMac || !/^[a-f0-9]{64}$/i.test(providedMac)) return null

  const expectedMac = crypto
    .createHmac('sha256', secret)
    .update(`acuity-guest:${guestId}`)
    .digest('hex')

  const providedBuf = Buffer.from(providedMac.toLowerCase(), 'hex')
  const expectedBuf = Buffer.from(expectedMac.toLowerCase(), 'hex')
  if (providedBuf.length !== expectedBuf.length) return null

  if (!crypto.timingSafeEqual(providedBuf, expectedBuf)) {
    return null
  }
  return `guest:${guestId}`
}

function parseCookieHeader(
  cookieHeader: string | null,
  name: string
): string | null {
  if (!cookieHeader) return null
  const pairs = cookieHeader.split(';')
  for (const pair of pairs) {
    const eqIdx = pair.indexOf('=')
    if (eqIdx === -1) continue
    const k = pair.slice(0, eqIdx).trim()
    if (k === name) {
      return decodeURIComponent(pair.slice(eqIdx + 1).trim())
    }
  }
  return null
}

/**
 * Validates that public multi-user deployments never use a shared
 * `ANONYMOUS_USER_ID` (`ENABLE_AUTH=false`).
 */
export function validateMultiUserReadiness(
  env: Record<string, string | undefined> = process.env
): { ready: boolean; error?: string } {
  const publicMultiUser = env.ACUITY_SEARCH_PUBLIC_MULTI_USER === 'true'
  const authDisabled =
    env.ENABLE_AUTH === 'false' || env.AUTH_PROVIDER === 'none'

  if (publicMultiUser && authDisabled) {
    return {
      ready: false,
      error:
        'Public multi-user deployment cannot run with ENABLE_AUTH=false or AUTH_PROVIDER=none because shared ANONYMOUS_USER_ID violates tenant isolation.'
    }
  }

  return { ready: true }
}

/**
 * Resolves the current actor identity for an API request.
 * - Authenticated users receive their real user ID (`isGuest: false`).
 * - Unauthenticated visitors receive a cryptographically isolated `guest:<id>`
 *   identity backed by an `HttpOnly; SameSite=Lax` signed cookie — never a
 *   shared `anonymous-user` bucket.
 */
export async function resolveRequestActor(
  req?: Request
): Promise<ResolvedActorIdentity> {
  const config = getAcuityConfig()

  const readiness = validateMultiUserReadiness()
  if (!readiness.ready) {
    throw new Error(readiness.error)
  }

  // Try authenticated user first (when not in anonymous mode)
  if (!isAnonymousMode()) {
    try {
      const user = await getCurrentUser()
      if (user?.id) {
        return {
          actorId: user.id,
          isGuest: false
        }
      }
    } catch {
      // Fall through to isolated guest session
    }
  }

  // Check explicit test/request header or signed cookie for isolated guest session
  const cookieHeader = req?.headers.get('cookie') ?? null
  const existingToken = parseCookieHeader(
    cookieHeader,
    GUEST_SESSION_COOKIE_NAME
  )
  const verifiedGuest = verifyGuestSessionToken(
    existingToken,
    config.security.guestCookieSecret
  )

  if (verifiedGuest) {
    return {
      actorId: verifiedGuest,
      isGuest: true
    }
  }

  // Issue a new isolated guest session token
  const rawId = crypto.randomBytes(16).toString('hex')
  const signedToken = signGuestSessionToken(
    rawId,
    config.security.guestCookieSecret
  )
  const secureFlag = process.env.NODE_ENV === 'production' ? '; Secure' : ''
  const setCookieHeader = `${GUEST_SESSION_COOKIE_NAME}=${encodeURIComponent(signedToken)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000${secureFlag}`

  return {
    actorId: `guest:${rawId}`,
    isGuest: true,
    setCookieHeader
  }
}
