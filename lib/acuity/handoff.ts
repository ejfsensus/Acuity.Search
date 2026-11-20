/**
 * "Add to Codex": signed server-to-server handoff of a research bundle to the
 * Acuity.Codex import endpoint over the private network.
 *
 * Signature = hex HMAC-SHA256(ACUITY_HANDOFF_SECRET, `${ts}.${nonce}.${sha256(body)}`)
 * Codex rejects stale timestamps (>300 s), reused nonces and bad signatures,
 * and treats Idempotency-Key as the dedupe key for the import.
 */
import crypto from 'node:crypto'

import type { EmbedContext } from '@/lib/acuity/embed'

type Env = Record<string, string | undefined>

export const HANDOFF_PATH = '/api/acuity/search/import'

export function sha256Hex(data: string): string {
  return crypto.createHash('sha256').update(data, 'utf8').digest('hex')
}

export function signHandoff(
  body: string,
  secret: string,
  ts: number,
  nonce: string
): string {
  return crypto
    .createHmac('sha256', secret)
    .update(`${ts}.${nonce}.${sha256Hex(body)}`)
    .digest('hex')
}

export function handoffIdempotencyKey(
  runId: string,
  answerVersionId: string | null,
  target: EmbedContext
): string {
  const t = target.kind === 'sphere' ? `sphere:${target.workspaceId}` : 'home'
  return sha256Hex(`${runId}|${answerVersionId ?? 'none'}|${t}`)
}

export interface HandoffResult {
  ok: boolean
  status: number
  importId?: string
  workspaceId?: string
  duplicate?: boolean
  error?: string
}

export async function sendHandoffToCodex(
  options: {
    bundle: unknown
    codexUserId: string
    target: EmbedContext
    title?: string
    idempotencyKey: string
  },
  env: Env = process.env,
  fetchImpl: typeof fetch = fetch
): Promise<HandoffResult> {
  const secret = env.ACUITY_HANDOFF_SECRET?.trim()
  const base = env.CODEX_INTERNAL_URL?.trim().replace(/\/+$/, '')
  if (!secret || secret.length < 32 || !base)
    return { ok: false, status: 503, error: 'Codex handoff is not configured' }

  const body = JSON.stringify({
    bundle: options.bundle,
    codexUserId: options.codexUserId,
    target: options.target,
    title: options.title
  })
  const ts = Math.floor(Date.now() / 1000)
  const nonce = crypto.randomBytes(16).toString('hex')
  let response: Response
  try {
    response = await fetchImpl(`${base}${HANDOFF_PATH}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Acuity-Timestamp': String(ts),
        'X-Acuity-Nonce': nonce,
        'X-Acuity-Signature': signHandoff(body, secret, ts, nonce),
        'Idempotency-Key': options.idempotencyKey
      },
      body,
      signal: AbortSignal.timeout(60_000)
    })
  } catch (error) {
    return {
      ok: false,
      status: 502,
      error: `Codex unreachable: ${(error as Error).message}`
    }
  }
  const json = (await response.json().catch(() => ({}))) as Record<string, any>
  if (!response.ok)
    return {
      ok: false,
      status: response.status,
      error: String(json.detail ?? json.error ?? 'Codex import failed')
    }
  return {
    ok: true,
    status: response.status,
    importId: json.import_id,
    workspaceId: json.workspace_id,
    duplicate: Boolean(json.duplicate)
  }
}
