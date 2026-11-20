import { createHash } from 'node:crypto'

import { type ByokConfig, getByokConfig } from './config'

export interface ByokCredentials {
  openrouter: { apiKey: string; llmModel: string } | null
  composio: { apiKey: string; allowInstant: boolean } | null
}

export interface ByokIdentity {
  email?: string | null
  subject?: string | null
}

export type ResolveOutcome =
  | { status: 'ok'; credentials: ByokCredentials }
  | { status: 'unavailable' }

interface CacheEntry {
  at: number
  credentials: ByokCredentials
}

// In-memory only, short-lived, keyed by a hash of the identity. Never logged.
const cache = new Map<string, CacheEntry>()

const cacheKey = (id: ByokIdentity) =>
  createHash('sha256')
    .update(`${id.subject ?? ''}|${(id.email ?? '').toLowerCase()}`)
    .digest('hex')

export function clearByokCache(): void {
  cache.clear()
}

/** Forget a member's cached keys (e.g. after the provider rejected one). */
export function invalidateByok(id: ByokIdentity): void {
  cache.delete(cacheKey(id))
}

const EMPTY: ByokCredentials = { openrouter: null, composio: null }

/**
 * Fetches the member's keys from acuity-auth over the private network.
 * Returns `unavailable` (never throws) when the resolver cannot be reached, so
 * free paths keep working.
 */
export async function resolveByokCredentials(
  identity: ByokIdentity,
  options: { config?: ByokConfig; fetchImpl?: typeof fetch } = {}
): Promise<ResolveOutcome> {
  const cfg = options.config ?? getByokConfig()
  if (!identity.email && !identity.subject)
    return { status: 'ok', credentials: EMPTY }
  if (!cfg.resolverUrl || !cfg.serviceToken) return { status: 'unavailable' }

  const key = cacheKey(identity)
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < cfg.cacheMs)
    return { status: 'ok', credentials: hit.credentials }

  try {
    const res = await (options.fetchImpl ?? fetch)(
      `${cfg.resolverUrl}/internal/byok/resolve`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${cfg.serviceToken}`,
          'content-type': 'application/json'
        },
        body: JSON.stringify(
          identity.subject
            ? { subject: identity.subject }
            : { email: identity.email }
        ),
        signal: AbortSignal.timeout(4000),
        cache: 'no-store'
      }
    )
    if (!res.ok) return { status: 'unavailable' }
    const body = (await res.json()) as Record<string, any>
    const or = body.openrouter
    const cp = body.composio
    const credentials: ByokCredentials = {
      openrouter:
        or && typeof or.apiKey === 'string' && or.apiKey
          ? {
              apiKey: or.apiKey,
              llmModel: String(or.llmModel || '').trim() || 'openrouter/auto'
            }
          : null,
      composio:
        cp && typeof cp.apiKey === 'string' && cp.apiKey
          ? { apiKey: cp.apiKey, allowInstant: Boolean(cp.allowInstant) }
          : null
    }
    cache.set(key, { at: Date.now(), credentials })
    if (cache.size > 2000) {
      const cutoff = Date.now() - cfg.cacheMs
      for (const [k, v] of cache) if (v.at < cutoff) cache.delete(k)
    }
    return { status: 'ok', credentials }
  } catch {
    return { status: 'unavailable' }
  }
}
