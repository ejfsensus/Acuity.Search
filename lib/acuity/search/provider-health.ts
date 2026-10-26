import type { ProviderId } from '@/lib/acuity/search/contracts'

/**
 * Per-process circuit breaker for search providers.
 *
 * A provider that fails with a *configuration-class* error (e.g. SearXNG
 * returning 403 because `format=json` is disabled) will keep failing on every
 * request. Re-trying it on every variant of every run costs latency and marks
 * every run `partial`. After `FAILURE_THRESHOLD` consecutive hard failures
 * the circuit opens for `OPEN_MS`; while open, the provider is skipped
 * (status `skipped-disabled`) and the run is not degraded by it. After the
 * window a single probe request is let through (half-open).
 */
export const FAILURE_THRESHOLD = 2
export const OPEN_MS = 5 * 60 * 1000

interface CircuitState {
  consecutiveFailures: number
  openedAt: number | null
  lastErrorCode: string | null
}

const circuits = new Map<ProviderId, CircuitState>()

function stateFor(provider: ProviderId): CircuitState {
  let s = circuits.get(provider)
  if (!s) {
    s = { consecutiveFailures: 0, openedAt: null, lastErrorCode: null }
    circuits.set(provider, s)
  }
  return s
}

export function isCircuitOpen(
  provider: ProviderId,
  now: number = Date.now()
): boolean {
  const s = stateFor(provider)
  if (s.openedAt === null) return false
  if (now - s.openedAt >= OPEN_MS) {
    // half-open: allow one probe; a further failure re-opens immediately
    s.openedAt = null
    s.consecutiveFailures = FAILURE_THRESHOLD - 1
    return false
  }
  return true
}

export function recordProviderFailure(
  provider: ProviderId,
  errorCode: string,
  now: number = Date.now()
): void {
  const s = stateFor(provider)
  s.consecutiveFailures += 1
  s.lastErrorCode = errorCode
  if (s.consecutiveFailures >= FAILURE_THRESHOLD && s.openedAt === null) {
    s.openedAt = now
  }
}

export function recordProviderSuccess(provider: ProviderId): void {
  const s = stateFor(provider)
  s.consecutiveFailures = 0
  s.openedAt = null
  s.lastErrorCode = null
}

export function getCircuitSnapshot(provider: ProviderId): {
  open: boolean
  consecutiveFailures: number
  lastErrorCode: string | null
} {
  const s = stateFor(provider)
  return {
    open: s.openedAt !== null && Date.now() - s.openedAt < OPEN_MS,
    consecutiveFailures: s.consecutiveFailures,
    lastErrorCode: s.lastErrorCode
  }
}

/** Test helper. */
export function resetProviderCircuits(): void {
  circuits.clear()
}
