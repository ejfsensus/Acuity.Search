import { NextResponse } from 'next/server'

import { resolveRequestActor } from '@/lib/acuity/auth'
import { getSearchRunForActor } from '@/lib/acuity/store'

export async function GET(
  req: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params
  const actor = await resolveRequestActor(req)
  const run = getSearchRunForActor(id, actor.actorId)

  if (!run) {
    return NextResponse.json(
      { error: 'Search run not found or access denied' },
      { status: 404 }
    )
  }

  const headers = new Headers()
  if (actor.setCookieHeader) {
    headers.set('Set-Cookie', actor.setCookieHeader)
  }
  return NextResponse.json({ run }, { headers })
}
