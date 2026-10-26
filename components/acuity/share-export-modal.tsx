'use client'

import React, { useState } from 'react'

import type { SearchRunState } from '@/lib/acuity/search/contracts'

interface ShareExportModalProps {
  run: SearchRunState
  open: boolean
  onClose: () => void
}

export function ShareExportModal({
  run,
  open,
  onClose
}: ShareExportModalProps) {
  const [title, setTitle] = useState(
    () => `Acuity Research: ${run.request.query.slice(0, 80)}`
  )
  const [includeQuery, setIncludeQuery] = useState(true)
  const [includeAnswer, setIncludeAnswer] = useState(true)
  const [selectedSourceIds, setSelectedSourceIds] = useState<string[]>(() =>
    run.results.map(r => r.id)
  )
  const [expiresInDays, setExpiresInDays] = useState<number | null>(30)
  const [creatingShare, setCreatingShare] = useState(false)
  const [createdShare, setCreatedShare] = useState<{
    shareId: string
    shareUrlPath: string
    revoked?: boolean
  } | null>(null)
  const [statusMessage, setStatusMessage] = useState<string | null>(null)

  if (!open) return null

  const latestAnswer = run.answers[run.answers.length - 1]

  const handleToggleSource = (sourceId: string) => {
    setSelectedSourceIds(prev =>
      prev.includes(sourceId)
        ? prev.filter(id => id !== sourceId)
        : [...prev, sourceId]
    )
  }

  const handleCopyWithSources = async () => {
    const lines: string[] = [
      `# ${run.request.query}`,
      ``,
      latestAnswer?.markdown || '',
      ``,
      `## Sources`,
      ...run.results
        .filter(r => selectedSourceIds.includes(r.id))
        .map(r => `- [${r.citationLabel}] ${r.title} — ${r.url}`)
    ]
    try {
      await navigator.clipboard.writeText(lines.join('\n'))
      setStatusMessage('Copied answer and selected citations to clipboard.')
    } catch {
      setStatusMessage('Clipboard write failed.')
    }
  }

  const handleCreateShare = async () => {
    if (selectedSourceIds.length === 0) {
      setStatusMessage('Select at least one source to include in the snapshot.')
      return
    }
    setCreatingShare(true)
    setStatusMessage(null)
    try {
      const response = await fetch('/api/acuity-search/shares', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          runId: run.runId,
          title,
          includeQuery,
          includeAnswerVersionId:
            includeAnswer && latestAnswer ? latestAnswer.id : undefined,
          selectedSourceIds,
          selectedEvidenceIds: run.evidence
            .filter(e => selectedSourceIds.includes(e.sourceId))
            .map(e => e.id),
          expiresInDays
        })
      })
      const data = await response.json()
      if (!response.ok) {
        throw new Error(data.error || 'Failed to create share snapshot')
      }
      setCreatedShare({
        shareId: data.shareId,
        shareUrlPath: data.shareUrlPath
      })
      setStatusMessage('Shareable research link created.')
    } catch (error) {
      setStatusMessage(
        error instanceof Error ? error.message : 'Share creation failed'
      )
    } finally {
      setCreatingShare(false)
    }
  }

  const handleRevokeShare = async () => {
    if (!createdShare) return
    try {
      const res = await fetch(
        `/api/acuity-search/shares/${createdShare.shareId}`,
        {
          method: 'DELETE'
        }
      )
      if (res.ok) {
        setCreatedShare({ ...createdShare, revoked: true })
        setStatusMessage('Share snapshot revoked immediately.')
      }
    } catch {
      setStatusMessage('Failed to revoke share snapshot.')
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Share and Export Research"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-xs"
    >
      <div className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-[#35313c] bg-[#111118] text-[#fafafa] shadow-2xl">
        <div className="flex items-center justify-between border-b border-[#35313c] px-5 py-3.5">
          <div>
            <h2 className="font-serif text-xl font-medium text-[#fafafa]">
              Portable Export & Selected-Output Share
            </h2>
            <p className="font-mono text-[11px] text-[#8e899c]">
              Private conversation history is never exposed automatically.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-[#35313c] px-2.5 py-1 font-mono text-xs text-[#b3b0bd] hover:border-[#d4a843] hover:text-[#fafafa]"
          >
            Close
          </button>
        </div>

        <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-5 text-xs">
          {/* Direct Export Actions */}
          <div className="rounded-xl border border-[#35313c] bg-[#181820] p-3.5">
            <div className="mb-2 font-mono text-[11px] uppercase tracking-wider text-[#d4a843]">
              1. Portable Research Exports
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={handleCopyWithSources}
                className="rounded-xl border border-[#35313c] bg-[#09090f] px-3 py-2 font-mono text-xs text-[#fafafa] hover:border-[#d4a843]"
              >
                Copy with Sources
              </button>
              <a
                href={`/api/acuity-search/runs/${run.runId}/export?format=markdown`}
                download={`acuity-research-${run.runId}.md`}
                className="rounded-xl border border-[#35313c] bg-[#09090f] px-3 py-2 font-mono text-xs text-[#fafafa] hover:border-[#d4a843]"
              >
                Download Markdown (.md)
              </a>
              <a
                href={`/api/acuity-search/runs/${run.runId}/export?format=json`}
                download={`acuity-bundle-${run.runId}.json`}
                className="rounded-xl border border-[#d4a843]/60 bg-[#d4a843]/15 px-3 py-2 font-mono text-xs text-[#e8c96a] hover:bg-[#d4a843]/25"
              >
                Download JSON Bundle (acuity.research-bundle.v1)
              </a>
              <span
                title="Automatic Codex ingestion is disabled in MVP; use the acuity.research-bundle.v1 JSON export for handoff."
                className="inline-flex cursor-not-allowed items-center rounded-xl border border-[#35313c]/60 bg-[#09090f]/40 px-3 py-2 font-mono text-xs text-[#8e899c]"
              >
                Send to Acuity.Codex (Planned · Use v1 Bundle)
              </span>
            </div>
          </div>

          {/* Selected-Output Share Snapshot Builder */}
          <div className="rounded-xl border border-[#35313c] bg-[#181820] p-3.5">
            <div className="mb-2 font-mono text-[11px] uppercase tracking-wider text-[#d4a843]">
              2. Create Unlisted Selected-Output Snapshot
            </div>

            <label className="flex flex-col gap-1">
              <span className="font-mono text-[11px] text-[#b3b0bd]">
                Snapshot Title
              </span>
              <input
                type="text"
                value={title}
                onChange={e => setTitle(e.target.value)}
                className="rounded-lg border border-[#35313c] bg-[#09090f] px-3 py-1.5 text-xs text-[#fafafa] focus:border-[#d4a843] focus:outline-none"
              />
            </label>

            <div className="mt-3 flex flex-wrap gap-4">
              <label className="flex items-center gap-2 text-xs text-[#b3b0bd]">
                <input
                  type="checkbox"
                  checked={includeQuery}
                  onChange={e => setIncludeQuery(e.target.checked)}
                  className="accent-[#d4a843]"
                />
                Include original query text
              </label>
              <label className="flex items-center gap-2 text-xs text-[#b3b0bd]">
                <input
                  type="checkbox"
                  checked={includeAnswer}
                  onChange={e => setIncludeAnswer(e.target.checked)}
                  className="accent-[#d4a843]"
                />
                Include synthesized answer
              </label>
            </div>

            <div className="mt-3">
              <label className="flex items-center gap-2 font-mono text-[11px] text-[#b3b0bd]">
                <span>Snapshot Expiry:</span>
                <select
                  value={
                    expiresInDays === null ? 'never' : String(expiresInDays)
                  }
                  onChange={e =>
                    setExpiresInDays(
                      e.target.value === 'never' ? null : Number(e.target.value)
                    )
                  }
                  className="rounded border border-[#35313c] bg-[#09090f] px-2 py-1 text-xs text-[#fafafa]"
                >
                  <option value="7">7 days</option>
                  <option value="30">30 days (Default)</option>
                  <option value="90">90 days</option>
                  <option value="never">No automatic expiry</option>
                </select>
              </label>
            </div>

            <div className="mt-3">
              <div className="mb-1 font-mono text-[11px] text-[#b3b0bd]">
                Select Sources to Include ({selectedSourceIds.length} of{' '}
                {run.results.length})
              </div>
              <div className="max-h-40 space-y-1 overflow-y-auto rounded-lg border border-[#35313c] bg-[#09090f] p-2">
                {run.results.map(src => (
                  <label
                    key={src.id}
                    className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 hover:bg-[#181820]"
                  >
                    <input
                      type="checkbox"
                      checked={selectedSourceIds.includes(src.id)}
                      onChange={() => handleToggleSource(src.id)}
                      className="accent-[#d4a843]"
                    />
                    <span className="font-mono text-[11px] text-[#e8c96a]">
                      [{src.citationLabel}]
                    </span>
                    <span className="truncate text-xs text-[#fafafa]">
                      {src.title}
                    </span>
                    <span className="ml-auto font-mono text-[10px] text-[#8e899c]">
                      {src.hostname}
                    </span>
                  </label>
                ))}
              </div>
            </div>

            <div className="mt-3 flex items-center gap-2">
              <button
                type="button"
                onClick={handleCreateShare}
                disabled={creatingShare || selectedSourceIds.length === 0}
                className="rounded-xl border border-[#d4a843] bg-[#d4a843] px-4 py-2 font-mono text-xs font-semibold text-[#09090f] hover:bg-[#e8c96a] disabled:opacity-50"
              >
                {creatingShare
                  ? 'Creating Snapshot...'
                  : 'Create Unlisted Share Link'}
              </button>
            </div>

            {createdShare && (
              <div className="mt-3 rounded-xl border border-[#4ca771]/50 bg-[#09090f] p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="font-mono text-xs text-[#4ca771]">
                    {createdShare.revoked
                      ? 'Snapshot Revoked'
                      : `Unlisted URL: ${createdShare.shareUrlPath}`}
                  </div>
                  {!createdShare.revoked && (
                    <div className="flex items-center gap-2">
                      <a
                        href={createdShare.shareUrlPath}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="rounded border border-[#35313c] px-2 py-1 font-mono text-[11px] text-[#e8c96a] hover:border-[#d4a843]"
                      >
                        Open Snapshot ↗
                      </a>
                      <button
                        type="button"
                        onClick={handleRevokeShare}
                        className="rounded border border-[#d16060]/60 bg-[#d16060]/15 px-2 py-1 font-mono text-[11px] text-[#e58c8c] hover:bg-[#d16060]/25"
                      >
                        Revoke Link
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {statusMessage && (
            <div className="rounded-lg border border-[#35313c] bg-[#09090f] px-3 py-2 font-mono text-xs text-[#e8c96a]">
              {statusMessage}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
