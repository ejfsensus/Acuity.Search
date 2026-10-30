import { compileScopeFromSelection } from '@/lib/acuity/registry'
import { SACRED_TEXTS_BUDGETS } from '@/lib/acuity/search/budget'
import type {
  AnswerVersion,
  QueryPlan,
  SearchRequest,
  SearchRunState,
  SearchStreamEvent
} from '@/lib/acuity/search/contracts'
import { verifyAnswerCitations } from '@/lib/acuity/search/evidence'

import { AgentRelayError, readBackAgentChat, runAgentQuestion } from './client'
import { getAgentRelayConfig, isSacredTextsAvailable } from './config'
import {
  type AgentSource,
  mapAgentRun,
  parseAgentSources,
  sourcesFromToolOutput,
  stageLabel
} from './map'
import { tryAcquireAgentSlot } from './semaphore'

export const AGENT_FAILURE_TEXT = [
  'The search finished, but the model service could not complete the synthesis',
  'The model returned an invalid tool response',
  'The response could not be completed'
]

export const SACRED_TEXTS_MESSAGES = {
  unavailable: 'The Library agent is unavailable. Please try again shortly.',
  busy: 'The Library agent is busy. Please try again shortly.',
  limit: 'Daily Library enquiry limit reached.',
  guest: 'Sign in to consult the Library.',
  partial:
    'The Library agent did not finish in time; the passages it read are listed.',
  failedSynthesis:
    'The Library agent read these passages but could not compose an answer. Please retry.'
} as const

export class SacredTextsUnavailableError extends Error {
  constructor(
    message: string,
    readonly retryable = true
  ) {
    super(message)
    this.name = 'SacredTextsUnavailableError'
  }
}

export interface AgentRunOptions {
  runId: string
  userId: string
  isGuest: boolean
  signal?: AbortSignal
  onEvent?: (event: SearchStreamEvent) => void
  fetchImpl?: typeof fetch
}

function emptyPlan(request: SearchRequest): QueryPlan {
  return {
    originalQuery: request.query,
    cleanedQuery: request.query,
    explicitSiteOperators: [],
    variants: [],
    suggestedGroups: []
  }
}

function questionFor(request: SearchRequest): string {
  const depthHint =
    request.depth === 'quick'
      ? 'Answer concisely from the most relevant passages.'
      : 'Research thoroughly across traditions where relevant.'
  return `${request.query}\n\n(${depthHint} Quote passages exactly and name the file or passage you read for each claim.)`
}

/** Sacred Texts mode: one relayed Acuity.Agent run mapped onto a normal SearchRunState. */
export async function executeAgentRun(
  request: SearchRequest,
  options: AgentRunOptions
): Promise<SearchRunState> {
  const config = getAgentRelayConfig()
  if (!isSacredTextsAvailable(config)) {
    throw new SacredTextsUnavailableError(
      SACRED_TEXTS_MESSAGES.unavailable,
      false
    )
  }
  if (options.isGuest)
    throw new SacredTextsUnavailableError(SACRED_TEXTS_MESSAGES.guest, false)
  const release = tryAcquireAgentSlot(config.maxConcurrency)
  if (!release)
    throw new SacredTextsUnavailableError(SACRED_TEXTS_MESSAGES.busy)

  const nowIso = new Date().toISOString()
  const startedAt = Date.now()
  const scope = compileScopeFromSelection({
    policy: 'open',
    collectionGroupIds: [],
    entryIds: [],
    tags: [],
    starterPriorityOnly: false,
    includeDomains: [],
    excludeDomains: []
  })
  const plan = emptyPlan(request)
  const totalBudget = Math.min(
    SACRED_TEXTS_BUDGETS[request.depth].totalLatencyBudgetMs,
    request.depth === 'quick' ? config.quickTimeoutMs : config.timeoutMs
  )
  const { runId } = options
  options.onEvent?.({ type: 'run.Accepted', runId, request, scope })
  options.onEvent?.({
    type: 'agent.Stage',
    runId,
    label: 'Consulting the Library…'
  })

  const streamed: AgentSource[] = []
  let structured: AgentSource[] | null = null
  let lastStage = ''
  const warnings: string[] = []
  try {
    let outcome
    try {
      outcome = await runAgentQuestion({
        config,
        question: questionFor(request),
        userId: options.userId,
        deadlineMs: totalBudget,
        signal: options.signal,
        fetchImpl: options.fetchImpl,
        onChunk: chunk => {
          if (chunk.type === 'tool-input-available') {
            const label = stageLabel(chunk.toolName, chunk.input)
            if (label !== lastStage) {
              lastStage = label
              options.onEvent?.({ type: 'agent.Stage', runId, label })
            }
          } else if (
            chunk.type === 'tool-output-available' &&
            !chunk.preliminary
          ) {
            // tool name is on the matching input chunk; sacred-text output is self-describing
            const found = sourcesFromToolOutput('sacred-text-mcp', chunk.output)
            if (found.length) {
              streamed.push(...found)
              options.onEvent?.({
                type: 'results.Updated',
                runId,
                results: mapAgentRun({
                  sources: streamed,
                  answer: '',
                  question: request.query
                }).results
              })
            }
          } else if (
            chunk.type === 'text-delta' &&
            typeof chunk.delta === 'string'
          ) {
            if (lastStage !== 'Composing answer') {
              lastStage = 'Composing answer'
              options.onEvent?.({
                type: 'agent.Stage',
                runId,
                label: lastStage
              })
            }
            options.onEvent?.({
              type: 'answer.Delta',
              runId,
              textDelta: chunk.delta
            })
          } else if (chunk.type === 'data-sources') {
            const parsed = parseAgentSources(chunk.data)
            if (parsed.length) structured = parsed
          }
        }
      })
    } catch (error) {
      if (error instanceof AgentRelayError) {
        if (error.kind === 'limit')
          throw new SacredTextsUnavailableError(
            SACRED_TEXTS_MESSAGES.limit,
            false
          )
        if (error.kind === 'cancelled') return cancelledRun()
        throw new SacredTextsUnavailableError(SACRED_TEXTS_MESSAGES.unavailable)
      }
      throw error
    }

    let answerText = outcome.text
    if (outcome.ending === 'partial' && !structured) {
      // No blind retry: one read-back in case the Agent finished and persisted it.
      const parts = await readBackAgentChat(
        config,
        outcome.chatId,
        options.fetchImpl
      )
      if (parts) {
        const text = parts
          .filter(p => p.type === 'text')
          .map(p => String(p.text ?? ''))
          .join('')
        const data = parts.find(p => p.type === 'data-sources')
        if (data) structured = parseAgentSources(data.data)
        if (structured && text.trim()) {
          answerText = text
          outcome = { ...outcome, ending: 'finished' as const }
        }
      }
    }

    const sources: AgentSource[] = structured ?? streamed
    if (!structured && streamed.length)
      warnings.push(
        'Source labels were inferred; the Library agent sent no source list.'
      )
    const synthesisFailed =
      AGENT_FAILURE_TEXT.some(t => answerText.includes(t)) || !answerText.trim()
    const mapped = mapAgentRun({
      sources,
      answer: synthesisFailed ? '' : answerText,
      question: request.query
    })
    const partial = outcome.ending !== 'finished'
    if (partial) warnings.push(SACRED_TEXTS_MESSAGES.partial)

    const citations = verifyAnswerCitations(
      mapped.markdown,
      mapped.results,
      mapped.evidence
    )
    const answer: AnswerVersion = {
      id: `${runId}-answer-1`,
      versionNumber: 1,
      createdAt: new Date().toISOString(),
      modelId: null,
      mode:
        synthesisFailed || partial ? 'fallback-results-only' : 'synthesized',
      markdown: synthesisFailed ? '' : mapped.markdown,
      citations,
      disclosureNote: synthesisFailed
        ? SACRED_TEXTS_MESSAGES.failedSynthesis
        : 'Answered by Acuity.Agent from the Acuity Library.'
    }
    options.onEvent?.({
      type: 'results.Updated',
      runId,
      results: mapped.results
    })
    for (const evidence of mapped.evidence)
      options.onEvent?.({ type: 'extraction.Completed', runId, evidence })
    options.onEvent?.({ type: 'answer.Completed', runId, answer })

    const status: SearchRunState['status'] =
      outcome.ending === 'cancelled'
        ? 'cancelled'
        : partial || synthesisFailed
          ? mapped.results.length
            ? 'partial'
            : 'failed'
          : 'completed'
    const run = buildRun(status, mapped.results, mapped.evidence, [answer], {
      agentMs: Date.now() - startedAt,
      totalMs: Date.now() - startedAt
    })
    options.onEvent?.({ type: 'run.Completed', runId, run })
    return run
  } finally {
    release()
  }

  function buildRun(
    status: SearchRunState['status'],
    results: SearchRunState['results'],
    evidence: SearchRunState['evidence'],
    answers: AnswerVersion[],
    timings: Record<string, number>
  ): SearchRunState {
    return {
      runId,
      userId: options.userId,
      isGuest: options.isGuest,
      createdAt: nowIso,
      updatedAt: new Date().toISOString(),
      status,
      request,
      scope,
      plan,
      budget: {
        depth: request.depth,
        maxSearchRequests: 0,
        usedSearchRequests: 0,
        maxVariants: 0,
        usedVariants: 0,
        maxExtractions: 0,
        usedExtractions: 0,
        initialLatencyBudgetMs: totalBudget,
        totalLatencyBudgetMs: totalBudget,
        elapsedMs: Date.now() - startedAt,
        maxSynthesisTokens: 0
      },
      providerAttempts: [],
      results,
      evidence,
      answers,
      coverage: [],
      nextContinuationCursor: 0,
      warnings,
      evidenceStrength: results.length ? 'strong' : 'none',
      timings
    }
  }

  function cancelledRun(): SearchRunState {
    const mapped = mapAgentRun({
      sources: streamed,
      answer: '',
      question: request.query
    })
    const run = buildRun('cancelled', mapped.results, mapped.evidence, [], {
      totalMs: Date.now() - startedAt
    })
    options.onEvent?.({ type: 'run.Completed', runId, run })
    return run
  }
}
