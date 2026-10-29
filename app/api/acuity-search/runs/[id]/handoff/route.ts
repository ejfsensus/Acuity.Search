import { NextResponse } from 'next/server'

import { embedSessionFromRequest, isEmbedEnabled } from '@/lib/acuity/embed'
import { exportRunToResearchBundle } from '@/lib/acuity/export'
import { handoffIdempotencyKey, sendHandoffToCodex } from '@/lib/acuity/handoff'
import { ensureStoreReady, getSearchRunForActor } from '@/lib/acuity/store'
import { isPgStoreEnabled, recordHandoff } from '@/lib/acuity/store-pg'

export const dynamic = 'force-dynamic'

/** "Add to Codex": owner-only, idempotent, signed server-to-server handoff. */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!isEmbedEnabled())
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  await ensureStoreReady()
  const session = embedSessionFromRequest(req)
  if (!session)
    return NextResponse.json(
      { error: 'Open Search from Codex to add results' },
      { status: 401 }
    )
  const { id } = await params
  const actorId = `codex:${session.sub}`
  const run = getSearchRunForActor(id, actorId)
  if (!run)
    return NextResponse.json({ error: 'Run not found' }, { status: 404 })
  if (run.status !== 'completed' && run.status !== 'partial')
    return NextResponse.json(
      { error: 'Wait for the run to finish' },
      { status: 409 }
    )
  const body = (await req.json().catch(() => ({}))) as { title?: string }
  const title =
    typeof body.title === 'string' && body.title.trim()
      ? body.title.trim().slice(0, 200)
      : undefined
  const answer = run.answers[run.answers.length - 1] ?? null
  const idempotencyKey = handoffIdempotencyKey(
    run.runId,
    answer?.id ?? null,
    session.ctx
  )
  const result = await sendHandoffToCodex({
    bundle: exportRunToResearchBundle(run),
    codexUserId: session.sub,
    target: session.ctx,
    title,
    idempotencyKey
  })
  if (isPgStoreEnabled())
    await recordHandoff({
      id: idempotencyKey,
      runId: run.runId,
      actorId,
      codexImportId: result.importId ?? null,
      status: result.ok
        ? result.duplicate
          ? 'duplicate'
          : 'imported'
        : 'failed'
    }).catch(() => undefined)
  if (!result.ok)
    return NextResponse.json({ error: result.error }, { status: result.status })
  return NextResponse.json({
    importId: result.importId,
    workspaceId: result.workspaceId,
    duplicate: result.duplicate
  })
}
