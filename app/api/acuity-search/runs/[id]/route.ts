import { NextResponse } from 'next/server'

import { resolveRequestActor } from '@/lib/acuity/auth'
import { toPublicRun } from '@/lib/acuity/search/public-view'
import {
  deleteSearchRunForActor,
  ensureStoreReady,
  getSearchRunForActor
} from '@/lib/acuity/store'

export async function GET(
  req: Request,
  context: { params: Promise<{ id: string }> }
) {
  await ensureStoreReady()
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
  return NextResponse.json({ run: toPublicRun(run) }, { headers })
}

export async function DELETE(
  req: Request,
  context: { params: Promise<{ id: string }> }
) {
  await ensureStoreReady()
  const { id } = await context.params
  const actor = await resolveRequestActor(req)
  const deleted = deleteSearchRunForActor(id, actor.actorId)

  if (!deleted) {
    return NextResponse.json(
      { error: 'Search run not found or access denied' },
      { status: 404 }
    )
  }

  const headers = new Headers()
  if (actor.setCookieHeader) {
    headers.set('Set-Cookie', actor.setCookieHeader)
  }
  return NextResponse.json({ deleted: true, runId: id }, { headers })
}
