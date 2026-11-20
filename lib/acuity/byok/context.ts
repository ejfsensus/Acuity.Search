import { AsyncLocalStorage } from 'node:async_hooks'

import { getByokConfig, profileLink } from './config'
import {
  type ByokCredentials,
  type ByokIdentity,
  resolveByokCredentials
} from './resolver'

/**
 * Per-request key context. Provider adapters and the model registry read the
 * member's credentials from here instead of process env, so a run can only
 * ever spend the keys of the member who started it.
 */
export interface ByokContext {
  required: boolean
  identity: ByokIdentity | null
  credentials: ByokCredentials
  /** acuity-auth could not be reached; treat as "no keys" but say so. */
  resolverUnavailable: boolean
  profileUrl: string
}

const storage = new AsyncLocalStorage<ByokContext>()

const NONE: ByokCredentials = { openrouter: null, composio: null }

export function currentByok(): ByokContext | undefined {
  return storage.getStore()
}

export function runWithByok<T>(ctx: ByokContext, fn: () => T): T {
  return storage.run(ctx, fn)
}

/**
 * Binds the context to the rest of the current request (used by the long chat
 * handler, where wrapping the whole body in runWithByok is impractical).
 */
export function enterByok(ctx: ByokContext): void {
  storage.enterWith(ctx)
}

export async function buildByokContext(
  identity: ByokIdentity | null,
  options: { fetchImpl?: typeof fetch; returnTo?: string } = {}
): Promise<ByokContext> {
  const cfg = getByokConfig()
  const profileUrl = profileLink(options.returnTo)
  if (cfg.mode === 'off')
    return {
      required: false,
      identity,
      credentials: NONE,
      resolverUnavailable: false,
      profileUrl
    }
  if (!identity || (!identity.email && !identity.subject))
    return {
      required: true,
      identity: null,
      credentials: NONE,
      resolverUnavailable: false,
      profileUrl
    }
  const outcome = await resolveByokCredentials(identity, {
    fetchImpl: options.fetchImpl
  })
  return {
    required: true,
    identity,
    credentials: outcome.status === 'ok' ? outcome.credentials : NONE,
    resolverUnavailable: outcome.status === 'unavailable',
    profileUrl
  }
}

/** Public, key-free summary for the browser. */
export function byokPublicStatus(ctx: ByokContext | undefined) {
  if (!ctx || !ctx.required)
    return { required: false, llm: true, webSearch: true, profileUrl: null }
  return {
    required: true,
    signedIn: Boolean(ctx.identity),
    llm: Boolean(ctx.credentials.openrouter),
    webSearch: Boolean(ctx.credentials.composio),
    model: ctx.credentials.openrouter?.llmModel ?? null,
    resolverUnavailable: ctx.resolverUnavailable,
    profileUrl: ctx.profileUrl
  }
}
