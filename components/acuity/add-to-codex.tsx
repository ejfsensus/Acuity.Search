'use client'

import { useState } from 'react'

export type EmbedTarget =
  | { kind: 'sphere'; workspaceId: string; title?: string }
  | { kind: 'home' }

export interface EmbedProps {
  target: EmbedTarget
  parentOrigin: string | null
}

/**
 * "Add to Codex": asks the Search server to hand the run to Codex
 * (signed, server-to-server), then tells the parent frame by id only.
 * From Home, Codex creates a new sphere named from the (editable) title.
 */
export function AddToCodexButton({
  runId,
  query,
  embed,
  disabled
}: {
  runId: string
  query: string
  embed: EmbedProps
  disabled?: boolean
}) {
  const [state, setState] = useState<'idle' | 'naming' | 'sending' | 'done'>(
    'idle'
  )
  const [title, setTitle] = useState(query.slice(0, 120))
  const [error, setError] = useState<string | null>(null)
  const isHome = embed.target.kind === 'home'

  async function send() {
    setState('sending')
    setError(null)
    try {
      const res = await fetch(`/api/acuity-search/runs/${runId}/handoff`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(isHome ? { title } : {})
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error || `Failed (${res.status})`)
      setState('done')
      if (embed.parentOrigin && window.parent !== window) {
        window.parent.postMessage(
          {
            type: 'acuity-search:imported',
            importId: json.importId,
            workspaceId: json.workspaceId,
            duplicate: Boolean(json.duplicate)
          },
          embed.parentOrigin
        )
      }
    } catch (e) {
      setError((e as Error).message)
      setState(isHome ? 'naming' : 'idle')
    }
  }

  const label =
    state === 'done'
      ? 'Added to Codex'
      : state === 'sending'
        ? 'Adding…'
        : isHome
          ? 'Add to Codex as new sphere'
          : `Add to ${embed.target.kind === 'sphere' && embed.target.title ? embed.target.title : 'this sphere'}`

  return (
    <div className="flex items-center gap-2">
      {state === 'naming' && (
        <input
          aria-label="New sphere name"
          value={title}
          onChange={e => setTitle(e.target.value)}
          maxLength={200}
          className="min-h-11 w-56 rounded-full border border-[#35313c] bg-[#181820] px-3 font-mono text-[12px] text-[#e8e6ef]"
        />
      )}
      <button
        type="button"
        disabled={disabled || state === 'sending' || state === 'done'}
        onClick={() =>
          isHome && state === 'idle' ? setState('naming') : void send()
        }
        className="min-h-11 rounded-full border border-[#7fb7a4]/80 bg-[#7fb7a4]/15 px-4 py-1 font-mono text-[12px] text-[#bfe3d6] hover:bg-[#7fb7a4]/25 disabled:opacity-60"
      >
        {state === 'naming' ? 'Create sphere' : label}
      </button>
      {error && (
        <span role="alert" className="font-mono text-[11px] text-[#e8a0a0]">
          {error}
        </span>
      )}
    </div>
  )
}
