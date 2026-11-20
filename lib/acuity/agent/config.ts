/**
 * Sacred Texts mode: server-side relay to Acuity.Agent. Server env only — the
 * key and the Agent host never reach the browser.
 */
export interface AgentRelayConfig {
  enabled: boolean
  configured: boolean
  apiUrl: string
  apiKey: string
  model: string
  timeoutMs: number
  quickTimeoutMs: number
  idleTimeoutMs: number
  maxConcurrency: number
}

function int(name: string, fallback: number, min: number, max: number): number {
  const raw = Number.parseInt(process.env[name] || '', 10)
  return Number.isFinite(raw) ? Math.min(max, Math.max(min, raw)) : fallback
}

export function getAgentRelayConfig(): AgentRelayConfig {
  const apiUrl = (process.env.ACUITY_AGENT_API_URL || '')
    .trim()
    .replace(/\/+$/, '')
  const apiKey = (process.env.ACUITY_AGENT_API_KEY || '').trim()
  const enabled = process.env.ACUITY_SEARCH_SACRED_TEXTS_ENABLED === 'true'
  const timeoutMs = int('ACUITY_AGENT_TIMEOUT_MS', 480_000, 10_000, 900_000)
  return {
    enabled,
    configured: Boolean(apiUrl && apiKey && /^https?:\/\//.test(apiUrl)),
    apiUrl,
    apiKey,
    model: (process.env.ACUITY_AGENT_MODEL || 'deepseek-flash').trim(),
    timeoutMs,
    quickTimeoutMs: Math.min(
      timeoutMs,
      int('ACUITY_AGENT_QUICK_TIMEOUT_MS', 300_000, 10_000, 900_000)
    ),
    idleTimeoutMs: int('ACUITY_AGENT_IDLE_TIMEOUT_MS', 90_000, 5_000, 300_000),
    maxConcurrency: int('ACUITY_AGENT_MAX_CONCURRENCY', 2, 1, 20)
  }
}

/** True when the Sacred Texts tab should be offered. */
export function isSacredTextsAvailable(
  config = getAgentRelayConfig()
): boolean {
  return config.enabled && config.configured
}
