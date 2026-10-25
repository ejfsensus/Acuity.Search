import { NextResponse } from 'next/server'

import { ZodError } from 'zod'

import { resolveRequestActor } from '@/lib/acuity/auth'
import type { SearchStreamEvent } from '@/lib/acuity/search/contracts'
import {
  executeFederatedSearchRun,
  StrictScopeValidationError
} from '@/lib/acuity/search/federate'
import {
  listSearchRunsForActor,
  registerRunAbortController,
  saveSearchRun,
  unregisterRunAbortController
} from '@/lib/acuity/store'

export async function GET(req: Request) {
  try {
    const actor = await resolveRequestActor(req)
    const runs = listSearchRunsForActor(actor.actorId)
    const headers = new Headers()
    if (actor.setCookieHeader) {
      headers.set('Set-Cookie', actor.setCookieHeader)
    }
    return NextResponse.json({ runs }, { headers })
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
  try {
    const actor = await resolveRequestActor(req)
    const body = await req.json()
    const wantsStream =
      req.headers.get('accept')?.includes('text/event-stream') ||
      body?.stream === true

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
              const payload = `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`
              controller.enqueue(encoder.encode(payload))
            } catch {}
          }

          try {
            const completedRun = await executeFederatedSearchRun(body, {
              runId,
              userId: actor.actorId,
              isGuest: actor.isGuest,
              signal: abortController.signal,
              onEvent: sendEvent
            })
            saveSearchRun(completedRun)
          } catch (err) {
            const message =
              err instanceof Error ? err.message : 'Search execution failed'
            sendEvent({
              type: 'run.Error',
              runId,
              error: message
            })
          } finally {
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
      const runState = await executeFederatedSearchRun(body, {
        runId,
        userId: actor.actorId,
        isGuest: actor.isGuest,
        signal: abortController.signal
      })
      saveSearchRun(runState)

      const headers = new Headers()
      if (actor.setCookieHeader) {
        headers.set('Set-Cookie', actor.setCookieHeader)
      }
      return NextResponse.json({ run: runState }, { status: 200, headers })
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
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : 'Failed to execute search'
      },
      { status: 500 }
    )
  }
}
