import { NextResponse } from 'next/server'

import { resolveRequestActor } from '@/lib/acuity/auth'
import { continueFederatedSearchRun } from '@/lib/acuity/search/federate'
import { getSearchRunForActor, saveSearchRun } from '@/lib/acuity/store'

export async function POST(
  req: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params
  const actor = await resolveRequestActor(req)
  const existingRun = getSearchRunForActor(id, actor.actorId)

  if (!existingRun) {
    return NextResponse.json(
      { error: 'Search run not found or access denied' },
      { status: 404 }
    )
  }

  const updatedRun = await continueFederatedSearchRun(existingRun, {
    userId: actor.actorId,
    isGuest: actor.isGuest,
    signal: req.signal
  })
  saveSearchRun(updatedRun)

  const headers = new Headers()
  if (actor.setCookieHeader) {
    headers.set('Set-Cookie', actor.setCookieHeader)
  }
  return NextResponse.json({ run: updatedRun }, { headers })
}
