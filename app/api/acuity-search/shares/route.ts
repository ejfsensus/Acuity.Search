import { NextResponse } from 'next/server'

import { ZodError } from 'zod'

import { resolveRequestActor } from '@/lib/acuity/auth'
import { createShareRequestSchema } from '@/lib/acuity/search/contracts'
import { createSelectedOutputShare } from '@/lib/acuity/store'

export async function POST(req: Request) {
  try {
    const actor = await resolveRequestActor(req)
    const body = await req.json()
    const parsed = createShareRequestSchema.parse(body)

    const created = createSelectedOutputShare({
      actorId: actor.actorId,
      request: parsed
    })

    const headers = new Headers()
    if (actor.setCookieHeader) {
      headers.set('Set-Cookie', actor.setCookieHeader)
    }

    return NextResponse.json(
      {
        shareId: created.shareId,
        token: created.rawToken,
        shareUrlPath: created.shareUrlPath,
        snapshot: created.snapshot
      },
      { status: 201, headers }
    )
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json(
        {
          error: error.issues.map(i => i.message).join('; '),
          code: 'INVALID_SHARE_REQUEST'
        },
        { status: 400 }
      )
    }
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : 'Failed to create share link'
      },
      { status: 400 }
    )
  }
}
