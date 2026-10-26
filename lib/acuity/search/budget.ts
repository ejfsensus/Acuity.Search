import type {
  BudgetSnapshot,
  ProviderId,
  ResearchDepth
} from '@/lib/acuity/search/contracts'

export interface DepthBudgetSpec {
  depth: ResearchDepth
  maxSearchRequests: number
  maxVariants: number
  maxExtractions: number
  initialLatencyBudgetMs: number
  totalLatencyBudgetMs: number
  maxSynthesisTokens: number
  /** Stop waiting for slower providers once any have returned (ms from start). */
  providerPhaseDeadlineMs: number
  /** Stop waiting for page extraction (ms after extraction starts). */
  extractionPhaseDeadlineMs: number
}

export const DEPTH_BUDGETS: Record<ResearchDepth, DepthBudgetSpec> = {
  quick: {
    depth: 'quick',
    maxSearchRequests: 8,
    maxVariants: 2,
    maxExtractions: 4,
    initialLatencyBudgetMs: 12000,
    totalLatencyBudgetMs: 60000,
    maxSynthesisTokens: 2000,
    providerPhaseDeadlineMs: 5000,
    extractionPhaseDeadlineMs: 4000
  },
  research: {
    depth: 'research',
    maxSearchRequests: 24,
    maxVariants: 6,
    maxExtractions: 12,
    initialLatencyBudgetMs: 35000,
    totalLatencyBudgetMs: 150000,
    maxSynthesisTokens: 6000,
    providerPhaseDeadlineMs: 15000,
    extractionPhaseDeadlineMs: 12000
  }
}

export const CONCURRENCY_LIMITS = {
  maxGlobalProviderRequests: 6,
  maxPerProviderRequests: 2,
  maxPerOriginExtractions: 2
} as const

export class RunBudgetTracker {
  private readonly spec: DepthBudgetSpec
  private readonly startedAt: number
  private usedSearchRequests = 0
  private usedVariants = 0
  private usedExtractions = 0

  constructor(depth: ResearchDepth, initialUsed?: Partial<BudgetSnapshot>) {
    this.spec = DEPTH_BUDGETS[depth]
    this.startedAt = Date.now()
    if (initialUsed) {
      this.usedSearchRequests = initialUsed.usedSearchRequests ?? 0
      this.usedVariants = initialUsed.usedVariants ?? 0
      this.usedExtractions = initialUsed.usedExtractions ?? 0
    }
  }

  canSpendSearchRequest(): boolean {
    return (
      this.usedSearchRequests < this.spec.maxSearchRequests &&
      this.getElapsedMs() < this.spec.totalLatencyBudgetMs
    )
  }

  trySpendSearchRequest(): boolean {
    if (!this.canSpendSearchRequest()) return false
    this.usedSearchRequests += 1
    return true
  }

  recordVariantUsed(count = 1): void {
    this.usedVariants = Math.min(
      this.spec.maxVariants,
      this.usedVariants + count
    )
  }

  canSpendExtraction(): boolean {
    return (
      this.usedExtractions < this.spec.maxExtractions &&
      this.getElapsedMs() < this.spec.totalLatencyBudgetMs
    )
  }

  trySpendExtraction(): boolean {
    if (!this.canSpendExtraction()) return false
    this.usedExtractions += 1
    return true
  }

  getElapsedMs(): number {
    return Date.now() - this.startedAt
  }

  snapshot(): BudgetSnapshot {
    return {
      depth: this.spec.depth,
      maxSearchRequests: this.spec.maxSearchRequests,
      usedSearchRequests: this.usedSearchRequests,
      maxVariants: this.spec.maxVariants,
      usedVariants: this.usedVariants,
      maxExtractions: this.spec.maxExtractions,
      usedExtractions: this.usedExtractions,
      initialLatencyBudgetMs: this.spec.initialLatencyBudgetMs,
      totalLatencyBudgetMs: this.spec.totalLatencyBudgetMs,
      elapsedMs: this.getElapsedMs(),
      maxSynthesisTokens: this.spec.maxSynthesisTokens
    }
  }
}

export class Semaphore {
  private active = 0
  private readonly queue: Array<() => void> = []

  constructor(private readonly maxConcurrency: number) {}

  async acquire(signal?: AbortSignal): Promise<() => void> {
    if (signal?.aborted) {
      throw new Error('Operation cancelled before acquiring concurrency slot')
    }

    if (this.active < this.maxConcurrency) {
      this.active += 1
      return this.createRelease()
    }

    return new Promise<() => void>((resolve, reject) => {
      const onAbort = () => {
        const idx = this.queue.indexOf(wake)
        if (idx !== -1) this.queue.splice(idx, 1)
        reject(
          new Error('Operation cancelled while waiting for concurrency slot')
        )
      }

      const wake = () => {
        signal?.removeEventListener('abort', onAbort)
        this.active += 1
        resolve(this.createRelease())
      }

      signal?.addEventListener('abort', onAbort, { once: true })
      this.queue.push(wake)
    })
  }

  private createRelease(): () => void {
    let released = false
    return () => {
      if (released) return
      released = true
      this.active -= 1
      const next = this.queue.shift()
      if (next) next()
    }
  }
}

export class FederationConcurrencyPool {
  private readonly globalSemaphore = new Semaphore(
    CONCURRENCY_LIMITS.maxGlobalProviderRequests
  )
  private readonly providerSemaphores: Record<ProviderId, Semaphore> = {
    searxng: new Semaphore(CONCURRENCY_LIMITS.maxPerProviderRequests),
    brave: new Semaphore(CONCURRENCY_LIMITS.maxPerProviderRequests),
    tavily: new Semaphore(CONCURRENCY_LIMITS.maxPerProviderRequests),
    exa: new Semaphore(CONCURRENCY_LIMITS.maxPerProviderRequests)
  }
  private readonly originSemaphores = new Map<string, Semaphore>()

  async runProviderCall<T>(
    provider: ProviderId,
    fn: () => Promise<T>,
    signal?: AbortSignal
  ): Promise<T> {
    const releaseGlobal = await this.globalSemaphore.acquire(signal)
    try {
      const releaseProvider =
        await this.providerSemaphores[provider].acquire(signal)
      try {
        return await fn()
      } finally {
        releaseProvider()
      }
    } finally {
      releaseGlobal()
    }
  }

  async runOriginExtraction<T>(
    origin: string,
    fn: () => Promise<T>,
    signal?: AbortSignal
  ): Promise<T> {
    let originSem = this.originSemaphores.get(origin)
    if (!originSem) {
      originSem = new Semaphore(CONCURRENCY_LIMITS.maxPerOriginExtractions)
      this.originSemaphores.set(origin, originSem)
    }
    const release = await originSem.acquire(signal)
    try {
      return await fn()
    } finally {
      release()
    }
  }
}
