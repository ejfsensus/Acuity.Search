/** Process-wide cap on concurrent Agent runs. Over the cap callers get "busy", not a queue. */
let active = 0

export function tryAcquireAgentSlot(max: number): (() => void) | null {
  if (active >= max) return null
  active += 1
  let released = false
  return () => {
    if (released) return
    released = true
    active = Math.max(0, active - 1)
  }
}

export function activeAgentRuns(): number {
  return active
}
