/** Small per-member sliding window for AI runs (protects members' own keys and the app). */
const hits = new Map<string, number[]>()

export function allowByokRun(
  memberKey: string,
  perMinute: number,
  now = Date.now()
): boolean {
  const list = (hits.get(memberKey) ?? []).filter(t => now - t < 60_000)
  if (list.length >= perMinute) {
    hits.set(memberKey, list)
    return false
  }
  list.push(now)
  hits.set(memberKey, list)
  if (hits.size > 5000)
    for (const [k, v] of hits)
      if (!v.some(t => now - t < 60_000)) hits.delete(k)
  return true
}

export function resetByokRateLimitForTests(): void {
  hits.clear()
}
