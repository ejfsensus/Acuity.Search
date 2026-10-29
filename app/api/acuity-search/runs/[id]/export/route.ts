import { NextResponse } from 'next/server'

import { resolveRequestActor } from '@/lib/acuity/auth'
import {
  exportRunToMarkdown,
  exportRunToResearchBundle
} from '@/lib/acuity/export'
import { ensureStoreReady, getSearchRunForActor } from '@/lib/acuity/store'

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

  const { searchParams } = new URL(req.url)
  const format = (searchParams.get('format') || 'json').toLowerCase()

  if (format === 'markdown' || format === 'md') {
    const markdown = exportRunToMarkdown(run)
    return new Response(markdown, {
      status: 200,
      headers: {
        'Content-Type': 'text/markdown; charset=utf-8',
        'Content-Disposition': `attachment; filename="acuity-research-${run.runId}.md"`
      }
    })
  }

  const bundle = exportRunToResearchBundle(run)
  return new Response(JSON.stringify(bundle, null, 2), {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="acuity-bundle-${run.runId}.json"`
    }
  })
}
