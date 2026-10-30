import crypto from 'node:crypto'

import type { AgentRelayConfig } from './config'
import { type AgentChunk, UiStreamParser } from './sse'

export type AgentFailure =
  | 'unavailable'
  | 'limit'
  | 'timeout'
  | 'idle'
  | 'cancelled'
  | 'protocol'

export class AgentRelayError extends Error {
  constructor(
    readonly kind: AgentFailure,
    message: string,
    readonly status?: number
  ) {
    super(message)
    this.name = 'AgentRelayError'
  }
}

export interface AgentRunOutcome {
  chatId: string
  /** 'finished' saw `finish`; 'partial' ended early (timeout/idle/EOF). */
  ending: 'finished' | 'partial' | 'cancelled'
  failure?: AgentFailure
  text: string
  chunks: number
}

/** Opaque per-user id for the Agent's request log (never an email or name). */
export function onBehalfOf(userId: string): string {
  return crypto
    .createHash('sha256')
    .update(`acuity-search:${userId}`)
    .digest('hex')
    .slice(0, 32)
}

function failureForStatus(status: number): AgentRelayError {
  if (status === 429)
    return new AgentRelayError('limit', 'Agent limit reached', status)
  return new AgentRelayError('unavailable', `Agent returned ${status}`, status)
}

export interface RunAgentOptions {
  config: AgentRelayConfig
  question: string
  userId: string
  deadlineMs: number
  signal?: AbortSignal
  onChunk?: (chunk: AgentChunk) => void
  fetchImpl?: typeof fetch
}

/**
 * Creates a chat for the service account and streams one answer.
 * Text is accumulated from `text-delta`; every chunk is passed to `onChunk`.
 */
export async function runAgentQuestion(
  options: RunAgentOptions
): Promise<AgentRunOutcome> {
  const { config } = options
  const doFetch = options.fetchImpl ?? fetch
  const chatId = crypto.randomUUID()
  const message = {
    id: crypto.randomUUID(),
    role: 'user' as const,
    parts: [{ type: 'text' as const, text: options.question }]
  }
  const headers = {
    Authorization: `Bearer ${config.apiKey}`,
    'Content-Type': 'application/json',
    'x-acuity-on-behalf-of': onBehalfOf(options.userId)
  }

  const deadline = AbortSignal.timeout(options.deadlineMs)
  const idle = new AbortController()
  const signals = [
    deadline,
    idle.signal,
    ...(options.signal ? [options.signal] : [])
  ]
  const signal = AbortSignal.any(signals)

  const classify = (): AgentRunOutcome['ending'] =>
    options.signal?.aborted ? 'cancelled' : 'partial'
  const failureKind = (): AgentFailure =>
    options.signal?.aborted
      ? 'cancelled'
      : idle.signal.aborted
        ? 'idle'
        : 'timeout'

  let created: Response
  try {
    created = await doFetch(`${config.apiUrl}/api/chats`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ id: chatId, mode: 'chat', message }),
      signal
    })
  } catch {
    if (signal.aborted)
      throw new AgentRelayError(failureKind(), 'Agent request aborted')
    throw new AgentRelayError('unavailable', 'Agent unreachable')
  }
  if (!created.ok) throw failureForStatus(created.status)

  let response: Response
  try {
    response = await doFetch(`${config.apiUrl}/api/chats/${chatId}`, {
      method: 'POST',
      headers: { ...headers, Accept: 'text/event-stream' },
      body: JSON.stringify({ model: config.model, messages: [message] }),
      signal
    })
  } catch {
    if (signal.aborted)
      throw new AgentRelayError(failureKind(), 'Agent request aborted')
    throw new AgentRelayError('unavailable', 'Agent unreachable')
  }
  if (!response.ok || !response.body)
    throw failureForStatus(response.status || 502)

  const parser = new UiStreamParser()
  const decoder = new TextDecoder()
  const reader = response.body.getReader()
  let text = ''
  let chunks = 0
  let finished = false
  let idleTimer: ReturnType<typeof setTimeout> | undefined
  const armIdle = () => {
    if (idleTimer) clearTimeout(idleTimer)
    idleTimer = setTimeout(() => idle.abort(), config.idleTimeoutMs)
  }
  const handle = (list: AgentChunk[]) => {
    for (const chunk of list) {
      chunks += 1
      if (chunk.type === 'text-delta' && typeof chunk.delta === 'string')
        text += chunk.delta
      if (chunk.type === 'finish') finished = true
      options.onChunk?.(chunk)
    }
  }
  const onAbort = () => reader.cancel().catch(() => {})
  signal.addEventListener('abort', onAbort, { once: true })
  armIdle()
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      armIdle()
      handle(parser.push(decoder.decode(value, { stream: true })))
    }
    handle(parser.end())
  } catch {
    // aborted or network error: fall through to partial
  } finally {
    if (idleTimer) clearTimeout(idleTimer)
    signal.removeEventListener('abort', onAbort)
  }

  if (finished) return { chatId, ending: 'finished', text, chunks }
  const ending = signal.aborted ? classify() : 'partial'
  return {
    chatId,
    ending,
    failure: signal.aborted ? failureKind() : 'protocol',
    text,
    chunks
  }
}

/** One read-back of a chat (no retry): the persisted assistant parts, if any. */
export async function readBackAgentChat(
  config: AgentRelayConfig,
  chatId: string,
  fetchImpl: typeof fetch = fetch
): Promise<Array<{ type: string; [k: string]: unknown }> | null> {
  try {
    const res = await fetchImpl(`${config.apiUrl}/api/chats/${chatId}`, {
      headers: { Authorization: `Bearer ${config.apiKey}` },
      signal: AbortSignal.timeout(15_000)
    })
    if (!res.ok) return null
    const chat = (await res.json()) as {
      messages?: Array<{ role?: string; parts?: unknown }>
    }
    const last = [...(chat.messages ?? [])]
      .reverse()
      .find(m => m.role === 'assistant')
    return Array.isArray(last?.parts)
      ? (last!.parts as Array<{ type: string }>)
      : null
  } catch {
    return null
  }
}
