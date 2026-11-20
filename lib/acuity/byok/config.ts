/**
 * Bring-your-own-key settings. Server env only; nothing here reaches the browser.
 *
 * ACUITY_BYOK_MODE
 *   required (default) — AI features use only the member's own keys, fetched from
 *                        acuity-auth. Acuity's provider keys are never used.
 *   off                — legacy/self-hosted: the deployment's own env keys are used.
 */
export type ByokMode = 'required' | 'off'

export interface ByokConfig {
  mode: ByokMode
  resolverUrl: string | null
  serviceToken: string | null
  profileUrl: string
  cacheMs: number
  openrouterBase: string
  composioBase: string
  userRunsPerMinute: number
  appUrl: string
}

type Env = Record<string, string | undefined>

export function getByokConfig(env: Env = process.env): ByokConfig {
  const mode: ByokMode =
    (env.ACUITY_BYOK_MODE || '').trim().toLowerCase() === 'off'
      ? 'off'
      : 'required'
  const num = (v: string | undefined, d: number, min: number, max: number) => {
    const n = Number(v)
    return Number.isFinite(n) && n > 0 ? Math.min(max, Math.max(min, n)) : d
  }
  return {
    mode,
    resolverUrl: env.ACUITY_BYOK_URL?.trim().replace(/\/+$/, '') || null,
    serviceToken: env.ACUITY_BYOK_SERVICE_TOKEN?.trim() || null,
    profileUrl:
      env.ACUITY_BYOK_PROFILE_URL?.trim() ||
      'https://auth.acuity.institute/account',
    cacheMs: num(env.ACUITY_BYOK_CACHE_MS, 60_000, 0, 300_000),
    openrouterBase: (
      env.OPENROUTER_API_BASE?.trim() || 'https://openrouter.ai/api/v1'
    ).replace(/\/+$/, ''),
    composioBase: (
      env.COMPOSIO_API_BASE?.trim() || 'https://backend.composio.dev/api/v3.1'
    ).replace(/\/+$/, ''),
    userRunsPerMinute: num(env.ACUITY_BYOK_USER_RPM, 20, 1, 600),
    appUrl: (
      env.BETTER_AUTH_URL?.trim() || 'https://search.acuity.institute'
    ).replace(/\/+$/, '')
  }
}

export const isByokRequired = (env: Env = process.env) =>
  getByokConfig(env).mode === 'required'

/** Profile link with a return address back to this app. */
export function profileLink(returnTo?: string, env: Env = process.env) {
  const cfg = getByokConfig(env)
  const u = new URL(cfg.profileUrl)
  u.searchParams.set('return', returnTo || cfg.appUrl + '/')
  u.hash = 'ai-keys'
  return u.toString()
}
