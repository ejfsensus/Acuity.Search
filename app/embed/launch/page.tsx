'use client'

import { useEffect, useState } from 'react'

/**
 * Codex opens /embed/launch#t=<launch token>. The token lives in the fragment
 * so it never reaches logs or Referer; it is exchanged once for an embed
 * session cookie and the fragment is wiped.
 */
export default function EmbedLaunchPage() {
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const hash = new URLSearchParams(window.location.hash.slice(1))
    const token = hash.get('t')
    window.history.replaceState(null, '', window.location.pathname)
    const exchange = token
      ? Promise.resolve(token)
      : Promise.reject(
          new Error('Missing launch token. Open Search from Codex again.')
        )
    exchange
      .then(t =>
        fetch('/api/acuity-search/embed/session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ token: t })
        })
      )
      .then(async res => {
        if (!res.ok) {
          const json = await res.json().catch(() => ({}))
          throw new Error(json.error || `Launch failed (${res.status})`)
        }
        window.location.replace('/embed')
      })
      .catch(e => setError((e as Error).message))
  }, [])

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#0f0f14] p-6 font-mono text-sm text-[#b3b0bd]">
      {error ? (
        <p role="alert" className="text-[#e8a0a0]">
          {error}
        </p>
      ) : (
        <p>Opening Acuity.Search…</p>
      )}
    </main>
  )
}
