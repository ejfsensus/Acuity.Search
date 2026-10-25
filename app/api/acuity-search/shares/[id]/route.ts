import { NextResponse } from 'next/server'

import { resolveRequestActor } from '@/lib/acuity/auth'
import { resolveShareByRawToken, revokeShareForActor } from '@/lib/acuity/store'

export async function GET(
  _req: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id: token } = await context.params
  const resolved = resolveShareByRawToken(token)

  if (resolved.status === 'not-found') {
    return NextResponse.json(
      { error: 'Shared research snapshot not found' },
      { status: 404 }
    )
  }

  if (resolved.status === 'revoked' || resolved.status === 'expired') {
    return NextResponse.json(
      {
        error:
          resolved.status === 'revoked'
            ? 'This shared research snapshot has been revoked by its owner.'
            : 'This shared research snapshot has expired.',
        status: resolved.status
      },
      { status: 410 }
    )
  }

  return NextResponse.json({
    status: 'active',
    share: resolved.snapshot
  })
}

export async function DELETE(
  req: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params
  const actor = await resolveRequestActor(req)
  const outcome = revokeShareForActor(id, actor.actorId)

  if (outcome.status === 'not-found' || outcome.status === 'forbidden') {
    return NextResponse.json(
      { error: 'Share not found or access denied' },
      { status: 404 }
    )
  }

  return NextResponse.json({
    revoked: true,
    shareId: id
  })
}
