import { NextResponse } from 'next/server'

import { ZodError } from 'zod'

import { SacredTextsUnavailableError } from '@/lib/acuity/agent/run'
import { byokContextForActor, resolveRequestActor } from '@/lib/acuity/auth'
import { getByokConfig } from '@/lib/acuity/byok/config'
import { runWithByok } from '@/lib/acuity/byok/context'
import { ByokKeyRequiredError } from '@/lib/acuity/byok/errors'
import { allowByokRun } from '@/lib/acuity/byok/rate-limit'
import type { SearchStreamEvent } from '@/lib/acuity/search/contracts'
import {
  executeFederatedSearchRun,
  StrictScopeValidationError
} from '@/lib/acuity/search/federate'
import { toPublicEvent, toPublicRun } from '@/lib/acuity/search/public-view'
import {
  ensureStoreReady,
  listSearchRunsForActor,
  registerRunAbortController,
  saveSearchRun,
  unregisterRunAbortController
} from '@/lib/acuity/store'

const KEEPALIVE_MS = 15_000

export async function GET(req: Request) {
  await ensureStoreReady()
  try {
    const actor = await resolveRequestActor(req)
    const runs = listSearchRunsForActor(actor.actorId)
    const headers = new Headers()
    if (actor.setCookieHeader) {
      headers.set('Set-Cookie', actor.setCookieHeader)
    }
    return NextResponse.json({ runs: runs.map(toPublicRun) }, { headers })
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : 'Failed to list search runs'
      },
      { status: 500 }
    )
  }
}

export async function POST(req: Request) {
  await ensureStoreReady()
  try {
    const actor = await resolveRequestActor(req)
    const body = await req.json()
    const wantsStream =
      req.headers.get('accept')?.includes('text/event-stream') ||
      body?.stream === true

    // Sacred Texts mode: signed-in readers only; guests get the teaser and no Agent call.
    if (body?.mode === 'sacred-texts' && actor.isGuest) {
      return NextResponse.json(
        { error: 'Sign in to consult the Library.', code: 'SIGN_IN_REQUIRED' },
        { status: 401 }
      )
    }

    // Open edition: the run may only spend this member's own keys.
    const byok = await byokContextForActor(actor)
    if (
      body?.mode === 'sacred-texts' &&
      byok.required &&
      !byok.credentials.openrouter
    ) {
      const err = new ByokKeyRequiredError('openrouter', byok.profileUrl)
      return NextResponse.json(
        {
          error:
            'The Library consultation runs on your own OpenRouter key. Add one in your Acuity profile to use it.',
          code: err.code,
          profileUrl: byok.profileUrl
        },
        { status: 403 }
      )
    }
    if (
      byok.required &&
      byok.credentials.openrouter &&
      body?.answerPreference !== 'results-only' &&
      !allowByokRun(actor.actorId, getByokConfig().userRunsPerMinute)
    ) {
      return NextResponse.json(
        {
          error:
            'You are sending enquiries very quickly. Please wait a minute and try again.',
          code: 'BYOK_RATE_LIMITED'
        },
        { status: 429, headers: { 'Retry-After': '60' } }
      )
    }

    const runId = `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const abortController = new AbortController()
    registerRunAbortController(runId, abortController)

    req.signal.addEventListener(
      'abort',
      () => {
        abortController.abort()
      },
      { once: true }
    )

    if (wantsStream) {
      const encoder = new TextEncoder()
      const stream = new ReadableStream<Uint8Array>({
        async start(controller) {
          const sendEvent = (event: SearchStreamEvent) => {
            try {
              const payload = `event: ${event.type}\ndata: ${JSON.stringify(toPublicEvent(event))}\n\n`
              controller.enqueue(encoder.encode(payload))
            } catch {}
          }

          // Comment lines keep proxies (Cloudflare ~100 s idle cap) from closing quiet streams.
          const keepalive = setInterval(() => {
            try {
              controller.enqueue(encoder.encode(': keepalive\n\n'))
            } catch {}
          }, KEEPALIVE_MS)

          try {
            const completedRun = await runWithByok(byok, () =>
              executeFederatedSearchRun(body, {
                runId,
                userId: actor.actorId,
                isGuest: actor.isGuest,
                signal: abortController.signal,
                onEvent: sendEvent
              })
            )
            saveSearchRun(completedRun)
          } catch (err) {
            // Scope errors are reader-actionable; anything else stays in logs.
            console.error('[acuity-search] run failed', err)
            const message =
              err instanceof StrictScopeValidationError ||
              err instanceof SacredTextsUnavailableError
                ? err.message
                : 'The enquiry could not be completed. Please try again.'
            sendEvent({
              type: 'run.Error',
              runId,
              error: message,
              retryable:
                err instanceof SacredTextsUnavailableError
                  ? err.retryable
                  : true
            })
          } finally {
            clearInterval(keepalive)
            unregisterRunAbortController(runId)
            try {
              controller.close()
            } catch {}
          }
        }
      })

      const headers = new Headers({
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive'
      })
      if (actor.setCookieHeader) {
        headers.set('Set-Cookie', actor.setCookieHeader)
      }
      return new Response(stream, { status: 200, headers })
    }

    try {
      const runState = await runWithByok(byok, () =>
        executeFederatedSearchRun(body, {
          runId,
          userId: actor.actorId,
          isGuest: actor.isGuest,
          signal: abortController.signal
        })
      )
      saveSearchRun(runState)

      const headers = new Headers()
      if (actor.setCookieHeader) {
        headers.set('Set-Cookie', actor.setCookieHeader)
      }
      return NextResponse.json(
        { run: toPublicRun(runState) },
        { status: 200, headers }
      )
    } finally {
      unregisterRunAbortController(runId)
    }
  } catch (error) {
    if (error instanceof StrictScopeValidationError) {
      return NextResponse.json(
        {
          error: error.message,
          code: 'STRICT_SCOPE_VALIDATION_ERROR'
        },
        { status: 400 }
      )
    }
    if (error instanceof SacredTextsUnavailableError) {
      return NextResponse.json(
        {
          error: error.message,
          code: 'SACRED_TEXTS_UNAVAILABLE',
          retryable: error.retryable
        },
        { status: 503 }
      )
    }
    if (error instanceof ZodError) {
      return NextResponse.json(
        {
          error: error.issues.map(i => i.message).join('; '),
          code: 'INVALID_SEARCH_REQUEST',
          issues: error.issues
        },
        { status: 400 }
      )
    }
    console.error('[acuity-search] run failed', error)
    return NextResponse.json(
      { error: 'The enquiry could not be completed. Please try again.' },
      { status: 500 }
    )
  }
}
