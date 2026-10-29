/** Dependency-free embed flags (safe to import from proxy.ts and the client build). */
type Env = Record<string, string | undefined>

export function isEmbedEnabled(env: Env = process.env): boolean {
  return env.ACUITY_EMBED_ENABLED === 'true'
}

export function embedAllowedOrigins(env: Env = process.env): string[] {
  return (env.ACUITY_EMBED_ALLOWED_ORIGINS || '')
    .split(',')
    .map(o => o.trim().replace(/\/+$/, ''))
    .filter(o => /^https?:\/\/[^\s/'";]+$/.test(o))
}

/** CSP for /embed pages: only the Codex origin(s) may frame them. */
export function embedFrameAncestors(env: Env = process.env): string {
  const origins = embedAllowedOrigins(env)
  return `frame-ancestors ${origins.length ? origins.join(' ') : "'none'"}`
}
