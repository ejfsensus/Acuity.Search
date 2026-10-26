import type {
  ProviderId,
  SearchRunState,
  SearchStreamEvent,
  SourceResult
} from '@/lib/acuity/search/contracts'

/**
 * Client-side model of a streamed run. Stages map 1:1 to the server's SSE
 * events from federate.ts so the UI can show truthful progress instead of a
 * bare "Searching..." label.
 */
export type RunStage =
  | 'opening'
  | 'searching'
  | 'reading'
  | 'composing'
  | 'verifying'
  | 'done'

export const STAGE_ORDER: RunStage[] = [
  'opening',
  'searching',
  'reading',
  'composing',
  'verifying',
  'done'
]

export const STAGE_LABELS: Record<Exclude<RunStage, 'done'>, string> = {
  opening: 'Opening the archives',
  searching: 'Searching sources',
  reading: 'Reading pages',
  composing: 'Composing',
  verifying: 'Verifying citations'
}

export interface RunProgress {
  runId: string | null
  stage: RunStage
  providersStarted: number
  providersCompleted: number
  providerSet: ProviderId[]
  variantQueries: string[]
  results: SourceResult[]
  extractionsCompleted: number
  extractionsPlanned: number
  answerText: string
  completedRun: SearchRunState | null
  error: string | null
}

export function initialProgress(): RunProgress {
  return {
    runId: null,
    stage: 'opening',
    providersStarted: 0,
    providersCompleted: 0,
    providerSet: [],
    variantQueries: [],
    results: [],
    extractionsCompleted: 0,
    extractionsPlanned: 0,
    answerText: '',
    completedRun: null,
    error: null
  }
}

function advance(current: RunStage, next: RunStage): RunStage {
  return STAGE_ORDER.indexOf(next) > STAGE_ORDER.indexOf(current)
    ? next
    : current
}

export function reduceProgress(
  state: RunProgress,
  event: SearchStreamEvent
): RunProgress {
  switch (event.type) {
    case 'run.Accepted':
      return {
        ...state,
        runId: event.runId,
        providerSet: event.request.providers
      }
    case 'plan.Created':
      return {
        ...state,
        variantQueries: event.plan.variants.map(v => v.query),
        stage: advance(state.stage, 'searching')
      }
    case 'provider.Started':
      return {
        ...state,
        providersStarted: state.providersStarted + 1,
        stage: advance(state.stage, 'searching')
      }
    case 'provider.Completed':
      return { ...state, providersCompleted: state.providersCompleted + 1 }
    case 'results.Updated': {
      const planned = Math.min(
        event.results.filter(r => r.qualityTier !== 'low').length ||
          event.results.length,
        4
      )
      return {
        ...state,
        results: event.results,
        extractionsPlanned: Math.max(state.extractionsPlanned, planned),
        stage: advance(state.stage, 'reading')
      }
    }
    case 'extraction.Completed':
      return { ...state, extractionsCompleted: state.extractionsCompleted + 1 }
    case 'answer.Delta':
      return {
        ...state,
        answerText: state.answerText + event.textDelta,
        stage: advance(state.stage, 'composing')
      }
    case 'answer.Completed':
      return { ...state, stage: advance(state.stage, 'verifying') }
    case 'run.Completed':
      return {
        ...state,
        completedRun: event.run,
        results: event.run.results,
        stage: 'done'
      }
    case 'run.Error':
      return { ...state, error: event.error }
    default:
      return state
  }
}

/** 0..1 progress for the gold arch line. */
export function progressFraction(p: RunProgress): number {
  const base: Record<RunStage, number> = {
    opening: 0.04,
    searching: 0.1,
    reading: 0.45,
    composing: 0.65,
    verifying: 0.92,
    done: 1
  }
  let f = base[p.stage]
  if (p.stage === 'searching' && p.providersStarted > 0) {
    f += 0.3 * (p.providersCompleted / Math.max(1, p.providersStarted))
  }
  if (p.stage === 'reading' && p.extractionsPlanned > 0) {
    f += 0.18 * Math.min(1, p.extractionsCompleted / p.extractionsPlanned)
  }
  if (p.stage === 'composing') {
    f += Math.min(0.25, p.answerText.length / 6000)
  }
  return Math.min(1, f)
}

/**
 * Incremental Server-Sent Events parser. Feed it decoded text chunks; it
 * returns complete events and keeps the unfinished tail in `rest`.
 */
export function parseSseChunk(buffer: string): {
  events: SearchStreamEvent[]
  rest: string
} {
  const events: SearchStreamEvent[] = []
  const normalised = buffer.replace(/\r\n/g, '\n')
  const blocks = normalised.split('\n\n')
  const rest = blocks.pop() ?? ''
  for (const block of blocks) {
    const dataLines = block
      .split('\n')
      .filter(l => l.startsWith('data:'))
      .map(l => l.slice(5).trimStart())
    if (dataLines.length === 0) continue
    try {
      events.push(JSON.parse(dataLines.join('\n')) as SearchStreamEvent)
    } catch {
      // ignore malformed block
    }
  }
  return { events, rest }
}
