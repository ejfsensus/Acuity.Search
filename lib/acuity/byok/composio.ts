import { createHash } from 'node:crypto'

import { getByokConfig } from './config'
import { currentByok } from './context'

export type ComposioSearchTool = 'exa' | 'tavily'

const TOOL_SLUG: Record<ComposioSearchTool, string> = {
  exa: 'EXA_SEARCH',
  tavily: 'TAVILY_SEARCH'
}
const LABEL: Record<ComposioSearchTool, string> = {
  exa: 'Exa',
  tavily: 'Tavily'
}

/** Arguments each Composio tool accepts (native request fields outside these are dropped). */
const ALLOWED_ARGS: Record<ComposioSearchTool, string[]> = {
  exa: [
    'query',
    'numResults',
    'type',
    'contents',
    'includeDomains',
    'excludeDomains',
    'startPublishedDate',
    'endPublishedDate',
    'category'
  ],
  tavily: [
    'query',
    'max_results',
    'search_depth',
    'include_domains',
    'exclude_domains',
    'include_images',
    'include_raw_content'
  ]
}

export type ComposioAccess =
  | { kind: 'env' }
  | { kind: 'composio'; apiKey: string; allowInstant: boolean }
  | { kind: 'skip'; code: string; message: string }

/** How an Exa/Tavily request should be served for the current request. */
export function composioAccess(tool: ComposioSearchTool): ComposioAccess {
  if (getByokConfig().mode === 'off') return { kind: 'env' }
  const cp = currentByok()?.credentials.composio
  if (!cp)
    return {
      kind: 'skip',
      code: `${tool.toUpperCase()}_BYOK_MISSING`,
      message: `${LABEL[tool]} search uses your own Composio key. Add one in your Acuity profile; open search stays free.`
    }
  return { kind: 'composio', apiKey: cp.apiKey, allowInstant: cp.allowInstant }
}

export function toComposioArguments(
  tool: ComposioSearchTool,
  nativeBody: Record<string, unknown>
): Record<string, unknown> {
  const args: Record<string, unknown> = {}
  for (const k of ALLOWED_ARGS[tool]) {
    const v = nativeBody[k]
    if (v === undefined || (Array.isArray(v) && v.length === 0)) continue
    args[k] = v
  }
  // Composio's Exa tool treats include/exclude domains as mutually exclusive.
  if (tool === 'exa' && args.includeDomains && args.excludeDomains)
    delete args.excludeDomains
  return args
}

interface AccountCacheEntry {
  at: number
  id: string | null
}
const accountCache = new Map<string, AccountCacheEntry>()
const ACCOUNT_TTL_MS = 5 * 60_000

export function clearComposioCacheForTests(): void {
  accountCache.clear()
}

const keyHash = (apiKey: string) =>
  createHash('sha256').update(apiKey).digest('hex').slice(0, 24)

async function connectedAccountId(
  tool: ComposioSearchTool,
  apiKey: string,
  fetchFn: typeof fetch,
  signal?: AbortSignal
): Promise<string | null> {
  const cacheId = `${keyHash(apiKey)}:${tool}`
  const hit = accountCache.get(cacheId)
  if (hit && Date.now() - hit.at < ACCOUNT_TTL_MS) return hit.id
  const u = new URL(`${getByokConfig().composioBase}/connected_accounts`)
  u.searchParams.set('toolkit_slugs', tool)
  u.searchParams.set('statuses', 'ACTIVE')
  u.searchParams.set('limit', '1')
  const res = await fetchFn(u, { headers: { 'x-api-key': apiKey }, signal })
  if (res.status === 401 || res.status === 403)
    throw Object.assign(new Error('composio key rejected'), { status: 401 })
  if (!res.ok)
    throw Object.assign(new Error('composio unavailable'), {
      status: res.status
    })
  const body = (await res.json().catch(() => ({}))) as {
    items?: Array<{ id?: string; nanoid?: string }>
  }
  const first = body.items?.[0]
  const id = (first?.id || first?.nanoid || null) as string | null
  accountCache.set(cacheId, { at: Date.now(), id })
  return id
}

/** Finds the first array of result-like objects (with a url) in a tool payload. */
export function extractResults(payload: unknown, depth = 0): any[] {
  if (depth > 4 || payload == null) return []
  if (typeof payload === 'string') {
    try {
      return extractResults(JSON.parse(payload), depth + 1)
    } catch {
      return []
    }
  }
  if (Array.isArray(payload)) {
    return payload.some(i => i && typeof i === 'object' && 'url' in i)
      ? payload
      : []
  }
  if (typeof payload === 'object') {
    const o = payload as Record<string, unknown>
    for (const key of ['results', 'response_data', 'data', 'response']) {
      const found = extractResults(o[key], depth + 1)
      if (found.length) return found
    }
  }
  return []
}

function jsonResponse(status: number, body: unknown, statusText = '') {
  return new Response(JSON.stringify(body), {
    status,
    statusText,
    headers: { 'content-type': 'application/json' }
  })
}

/**
 * Runs Exa or Tavily through the member's Composio project and returns a
 * Response shaped like the provider's native API (`{ results: [...] }`), so the
 * existing adapters keep their parsing, scope checks and ranking.
 * Status codes: 401 key rejected, 424 tool not connected, 502 tool failure.
 */
export async function composioSearch(
  tool: ComposioSearchTool,
  access: Extract<ComposioAccess, { kind: 'composio' }>,
  nativeBody: Record<string, unknown>,
  signal?: AbortSignal,
  fetchFn: typeof fetch = fetch
): Promise<Response> {
  let accountId: string | null
  try {
    accountId = await connectedAccountId(tool, access.apiKey, fetchFn, signal)
  } catch (e) {
    const status = (e as { status?: number }).status ?? 502
    return jsonResponse(
      status === 401 ? 401 : 502,
      { results: [] },
      status === 401 ? 'Composio key rejected' : 'Composio unavailable'
    )
  }
  if (!accountId && !access.allowInstant)
    return jsonResponse(
      424,
      { results: [] },
      `${LABEL[tool]} is not connected in your Composio project`
    )
  const res = await fetchFn(
    `${getByokConfig().composioBase}/tools/execute/${TOOL_SLUG[tool]}`,
    {
      method: 'POST',
      headers: {
        'x-api-key': access.apiKey,
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        connected_account_id: accountId ?? 'instant_account',
        arguments: toComposioArguments(tool, nativeBody)
      }),
      signal
    }
  )
  if (res.status === 401 || res.status === 403)
    return jsonResponse(401, { results: [] }, 'Composio key rejected')
  if (res.status === 429)
    return jsonResponse(429, { results: [] }, 'Composio rate limit')
  if (!res.ok)
    return jsonResponse(502, { results: [] }, `Composio HTTP ${res.status}`)
  const body = (await res.json().catch(() => ({}))) as {
    successful?: boolean
    data?: unknown
  }
  if (body.successful === false)
    return jsonResponse(502, { results: [] }, `${LABEL[tool]} tool failed`)
  return jsonResponse(200, { results: extractResults(body.data ?? body) })
}

/** Member-facing explanation for a non-OK Composio-shaped response. */
export function composioFailureMessage(
  tool: ComposioSearchTool,
  status: number
): string {
  if (status === 401)
    return 'Composio did not accept your key. Check or replace it in your Acuity profile.'
  if (status === 424)
    return `${LABEL[tool]} is not connected in your Composio project. Connect it at platform.composio.dev, or allow instant accounts in your Acuity profile.`
  if (status === 429)
    return `${LABEL[tool]} is rate-limited in your Composio project just now.`
  return `${LABEL[tool]} could not be reached through Composio just now.`
}
