import { NextResponse } from 'next/server'

import { resolveRequestActor } from '@/lib/acuity/auth'
import {
  cancelSearchRunForActor,
  ensureStoreReady,
  getSearchRunForActor
} from '@/lib/acuity/store'

export async function POST(
  req: Request,
  context: { params: Promise<{ id: string }> }
) {
  await ensureStoreReady()
  const { id } = await context.params
  const actor = await resolveRequestActor(req)
  const outcome = cancelSearchRunForActor(id, actor.actorId)

  if (outcome.status === 'not-found' || outcome.status === 'forbidden') {
    return NextResponse.json(
      { error: 'Search run not found or access denied' },
      { status: 404 }
    )
  }

  const updatedRun = getSearchRunForActor(id, actor.actorId)
  return NextResponse.json({
    cancelled: true,
    run: updatedRun
  })
}
