'use client'

import React, { useEffect, useMemo, useRef, useState } from 'react'
import dynamic from 'next/dynamic'

import { IconLogout } from '@tabler/icons-react'

import type { ProviderConfigStatus } from '@/lib/acuity/config'
import type { DomainTopicGroup } from '@/lib/acuity/registry'
import type {
  AnswerPreference,
  DateRangeFilter,
  DiscoveryMode,
  FileTypeFilter,
  ProviderId,
  ResearchDepth,
  SafeSearchLevel,
  ScopePolicy,
  SearchRunState,
  SortOrder
} from '@/lib/acuity/search/contracts'
import {
  initialProgress,
  parseSseChunk,
  reduceProgress,
  type RunProgress
} from '@/lib/acuity/search/progress'
import { sortSourceResults } from '@/lib/acuity/search/rank'

import { signOutEverywhere } from '@/components/sign-out-button'

import {
  AcuityPortalHero,
  CURATED_ENQUIRY_PROMPTS,
  TopicDomainScopePanel
} from './acuity-portal-hero'
import {
  type ClientRegistryEntry,
  DEPTH_DESCRIPTIONS,
  MODE_DESCRIPTIONS,
  SORT_ORDER_LABELS
} from './acuity-types'
import { CitedSourceRibbon, ResultCardsList } from './result-cards'
import { SearchProgress } from './search-progress'

// Heavy, below-the-fold or on-demand UI is split out of the first-load bundle.
const AnswerMarkdown = dynamic(() => import('./answer-markdown'), {
  ssr: false,
  loading: () => (
    <div aria-hidden="true" className="flex flex-col gap-2.5">
      <div className="acuity-shimmer h-3.5 w-11/12 rounded" />
      <div className="acuity-shimmer h-3.5 w-full rounded" />
    </div>
  )
})
const EvidenceDrawer = dynamic(
  () => import('./evidence-drawer').then(m => m.EvidenceDrawer),
  { ssr: false }
)
import { AddToCodexButton, type EmbedProps } from './add-to-codex'

const ShareExportModal = dynamic(
  () => import('./share-export-modal').then(m => m.ShareExportModal),
  { ssr: false }
)

/** Mode-accurate description of what an enquiry actually searches. */
function scopeTagline(
  mode: DiscoveryMode,
  selectedGroupCount: number,
  repositoryCount: number
): string {
  if (mode === 'collections') {
    return selectedGroupCount > 0
      ? `Searching curated repositories in ${selectedGroupCount} topic${selectedGroupCount === 1 ? '' : 's'}`
      : `Searching ${repositoryCount} curated repositories`
  }
  if (mode === 'literature') {
    return 'Searching the open web for texts, translations & editions'
  }
  if (mode === 'sacred-texts') {
    return 'The Library agent reads the Acuity sacred-text library'
  }
  return selectedGroupCount > 0
    ? 'Open web, with your chosen topics weighted first'
    : 'Open web search · curated & scholarly sources ranked first'
}
const LOCAL_STORAGE_HISTORY_KEY = 'acuity.search.history.v1'

export interface AcuityWorkspaceInitialProps {
  topicGroups: DomainTopicGroup[]
  entries: ClientRegistryEntry[]
  crossCuttingTags: string[]
  providerStatuses: Record<ProviderId, ProviderConfigStatus>
  llmMode?: string
  llmConfigured?: boolean
  /** Present only on /embed (inside Codex). */
  embed?: EmbedProps
  /** Sacred Texts mode (Acuity.Agent relay): tab shown only when available. */
  sacredTexts?: { available: boolean; signedIn: boolean }
}

/**
 * Converts [S1], [S2] inline markers into interactive markdown citation links
 * that open the corresponding source in the Evidence Ledger on click.
 */
function formatInlineCitationsForStreamdown(markdown: string): string {
  return markdown.replace(/\[(S\d+)\](?!\()/g, '[$1](#cite-$1)')
}

function WorkspaceSignOut() {
  const [busy, setBusy] = useState(false)
  return (
    <button
      type="button"
      data-testid="sign-out"
      aria-label="Sign out"
      title="Sign out"
      disabled={busy}
      onClick={async () => {
        setBusy(true)
        try {
          await signOutEverywhere()
        } finally {
          setBusy(false)
        }
      }}
      className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-[#35313c] bg-[#111118] px-3 py-1 font-mono text-[12px] text-[#b3b0bd] transition-colors hover:border-[#d4a843]/60 hover:text-[#fafafa] disabled:opacity-60"
    >
      <IconLogout className="size-4" aria-hidden="true" />
      <span className="hidden sm:inline">Sign out</span>
    </button>
  )
}

export function AcuitySearchWorkspace({
  topicGroups,
  entries,
  providerStatuses,
  embed,
  sacredTexts
}: AcuityWorkspaceInitialProps) {
  const visibleModes: DiscoveryMode[] = sacredTexts?.available
    ? ['general', 'literature', 'collections', 'sacred-texts']
    : ['general', 'literature', 'collections']
  // Primary Discovery Controls (Seamless & Minimal for End User)
  const [query, setQuery] = useState('')
  const [mode, setMode] = useState<DiscoveryMode>('general')
  const [depth, setDepth] = useState<ResearchDepth>('quick')
  const [answerPreference] = useState<AnswerPreference>('answer-with-sources')
  const [selectedProviders] = useState<ProviderId[]>([
    'searxng',
    'brave',
    'tavily',
    'exa'
  ])
  const [sortOrder, setSortOrder] = useState<SortOrder>('combined-relevance')
  const [scopePolicy, setScopePolicy] = useState<ScopePolicy>('open')
  const [dateRange] = useState<DateRangeFilter>('all')
  const [fileType] = useState<FileTypeFilter>('any')
  const [safeSearch] = useState<SafeSearchLevel>(0)

  // Topic Specific Domain Registry Scope
  const [selectedGroupIds, setSelectedGroupIds] = useState<string[]>([])
  const [selectedEntryIds, setSelectedEntryIds] = useState<string[]>([])
  const [starterPriorityOnly, setStarterPriorityOnly] = useState(false)

  // Workspace Layout, History Drawer & Reading Surface State
  const [readingSurface, setReadingSurface] = useState<'void' | 'parchment'>(
    'void'
  )
  const [historyOpen, setHistoryOpen] = useState(false)
  const [ledgerOpen, setLedgerOpen] = useState(false)
  const [shareModalOpen, setShareModalOpen] = useState(false)

  // Search Run Execution & Persistent History State
  const [currentRun, setCurrentRun] = useState<SearchRunState | null>(null)
  const [runHistory, setRunHistory] = useState<SearchRunState[]>([])
  const [selectedSourceId, setSelectedSourceId] = useState<string | null>(null)
  const [isSearching, setIsSearching] = useState(false)
  const [isContinuing, setIsContinuing] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [progress, setProgress] = useState<RunProgress | null>(null)
  const [showWeakerSources, setShowWeakerSources] = useState(false)
  const abortRef = useRef<AbortController | null>(null)
  const historyToggleRef = useRef<HTMLButtonElement | null>(null)
  const historyPanelRef = useRef<HTMLElement | null>(null)

  // History drawer behaves as a modal dialog on small screens: Esc closes it,
  // focus moves into it, and returns to the toggle when it closes.
  useEffect(() => {
    if (!historyOpen) return
    const panel = historyPanelRef.current
    panel?.querySelector<HTMLElement>('button, [tabindex="0"]')?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setHistoryOpen(false)
    }
    window.addEventListener('keydown', onKey)
    const toggle = historyToggleRef.current
    return () => {
      window.removeEventListener('keydown', onKey)
      toggle?.focus()
    }
  }, [historyOpen])

  useEffect(() => {
    if (!ledgerOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setLedgerOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [ledgerOpen])

  // Load persisted search history on mount (from localStorage + server disk store)
  useEffect(() => {
    let mounted = true

    try {
      const cached = window.localStorage.getItem(LOCAL_STORAGE_HISTORY_KEY)
      if (cached) {
        const parsed = JSON.parse(cached)
        if (Array.isArray(parsed) && mounted) {
          setRunHistory(parsed)
        }
      }
    } catch {}

    fetch('/api/acuity-search/runs')
      .then(res => (res.ok ? res.json() : null))
      .then(data => {
        if (!mounted || !data || !Array.isArray(data.runs)) return
        setRunHistory(prev => {
          const map = new Map<string, SearchRunState>()
          for (const r of data.runs as SearchRunState[]) {
            if (r?.runId) map.set(r.runId, r)
          }
          for (const r of prev) {
            if (r?.runId && !map.has(r.runId)) {
              map.set(r.runId, r)
            }
          }
          const merged = Array.from(map.values()).sort(
            (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)
          )
          try {
            window.localStorage.setItem(
              LOCAL_STORAGE_HISTORY_KEY,
              JSON.stringify(merged.slice(0, 50))
            )
          } catch {}
          return merged
        })
      })
      .catch(() => {})

    return () => {
      mounted = false
    }
  }, [])

  const persistHistoryList = (nextList: SearchRunState[]) => {
    setRunHistory(nextList)
    try {
      window.localStorage.setItem(
        LOCAL_STORAGE_HISTORY_KEY,
        JSON.stringify(nextList.slice(0, 50))
      )
    } catch {}
  }

  const handleDeleteHistoryRun = async (runId: string, e: React.MouseEvent) => {
    e.stopPropagation()
    const updated = runHistory.filter(r => r.runId !== runId)
    persistHistoryList(updated)
    if (currentRun?.runId === runId) {
      setCurrentRun(null)
      setSelectedSourceId(null)
    }
    try {
      await fetch(`/api/acuity-search/runs/${runId}`, { method: 'DELETE' })
    } catch {}
  }

  const handleToggleGroup = (groupId: string) => {
    setSelectedGroupIds(prev =>
      prev.includes(groupId)
        ? prev.filter(id => id !== groupId)
        : [...prev, groupId]
    )
  }

  const handleSelectAllGroups = () => {
    setSelectedGroupIds(topicGroups.map(g => g.id))
  }

  const handleClearScope = () => {
    setSelectedGroupIds([])
    setSelectedEntryIds([])
    setStarterPriorityOnly(false)
    if (mode !== 'collections') {
      setScopePolicy('open')
    }
  }

  const executeEnquiry = async (overrideParams?: {
    query?: string
    mode?: DiscoveryMode
    groupIds?: string[]
  }) => {
    const activeQuery = (overrideParams?.query ?? query).trim()
    if (!activeQuery) {
      setErrorMessage('Please enter a research enquiry or text reference.')
      return
    }

    const activeMode = overrideParams?.mode ?? mode
    if (activeMode === 'sacred-texts' && !sacredTexts?.signedIn) {
      setErrorMessage('Sign in to consult the Library.')
      return
    }
    const activeGroups =
      overrideParams?.groupIds ??
      (activeMode === 'collections'
        ? selectedGroupIds.length > 0
          ? selectedGroupIds
          : topicGroups.map(g => g.id)
        : selectedGroupIds)

    // When topic groups are selected, even in general/literature mode,
    // compile collection targets so scope resolution aligns with the user's focus
    const effectiveScopePolicy: ScopePolicy =
      activeMode === 'collections'
        ? 'strict'
        : activeGroups.length > 0
          ? 'collection-and-web-lanes'
          : 'open'

    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setIsSearching(true)
    setErrorMessage(null)
    setShowWeakerSources(false)
    setCurrentRun(null)
    setProgress(initialProgress())

    try {
      const response = await fetch('/api/acuity-search/runs', {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          Accept: 'text/event-stream'
        },
        body: JSON.stringify({
          query: activeQuery,
          mode: activeMode,
          depth,
          answerPreference,
          providers: selectedProviders,
          sortOrder,
          scopePolicy: effectiveScopePolicy,
          collectionGroupIds: activeGroups,
          entryIds: activeMode === 'collections' ? selectedEntryIds : [],
          tags: [],
          starterPriorityOnly:
            activeMode === 'collections' ? starterPriorityOnly : false,
          includeDomains: [],
          excludeDomains: [],
          dateRange,
          fileType,
          safeSearch
        })
      })

      let run: SearchRunState | null = null
      const contentType = response.headers.get('content-type') || ''
      if (!response.ok || !contentType.includes('text/event-stream')) {
        const data = await response.json()
        if (!response.ok) {
          throw new Error(data.error || 'Search execution failed')
        }
        run = data.run as SearchRunState
      } else if (response.body) {
        // Consume the server's progress stream (run.Accepted → run.Completed)
        const reader = response.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''
        let local = initialProgress()
        for (;;) {
          const { value, done } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          const parsed = parseSseChunk(buffer)
          buffer = parsed.rest
          if (parsed.events.length === 0) continue
          for (const ev of parsed.events) local = reduceProgress(local, ev)
          setProgress(local)
          if (local.error) throw new Error(local.error)
        }
        run = local.completedRun
      }
      if (!run) {
        throw new Error('The enquiry ended before any results arrived.')
      }

      setCurrentRun(run)
      const nextHistory = [
        run,
        ...runHistory.filter(item => item.runId !== run.runId)
      ]
      persistHistoryList(nextHistory)
      setSelectedSourceId(run.results[0]?.id ?? null)
    } catch (error) {
      if (controller.signal.aborted) {
        setErrorMessage('Enquiry cancelled.')
      } else {
        setErrorMessage(
          error instanceof Error ? error.message : 'Search request failed'
        )
      }
    } finally {
      if (abortRef.current === controller) abortRef.current = null
      setIsSearching(false)
      setProgress(null)
    }
  }

  const handleCancelEnquiry = () => {
    const runId = progress?.runId
    abortRef.current?.abort()
    if (runId) {
      void fetch(`/api/acuity-search/runs/${runId}/cancel`, {
        method: 'POST'
      }).catch(() => {})
    }
  }

  const handleContinueResearch = async () => {
    if (!currentRun) return
    setIsContinuing(true)
    setErrorMessage(null)
    try {
      const res = await fetch(
        `/api/acuity-search/runs/${currentRun.runId}/continue`,
        {
          method: 'POST'
        }
      )
      const data = await res.json()
      if (!res.ok) {
        throw new Error(data.error || 'Continue research failed')
      }
      const updated: SearchRunState = data.run
      setCurrentRun(updated)
      const nextHistory = runHistory.map(r =>
        r.runId === updated.runId ? updated : r
      )
      persistHistoryList(nextHistory)
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : 'Failed to continue research'
      )
    } finally {
      setIsContinuing(false)
    }
  }

  const sortedResults = useMemo(() => {
    if (!currentRun) return []
    return sortSourceResults(currentRun.results, sortOrder)
  }, [currentRun, sortOrder])
  const weakerResults = useMemo(
    () => sortedResults.filter(r => r.qualityTier === 'low'),
    [sortedResults]
  )
  const visibleResults = useMemo(
    () =>
      showWeakerSources
        ? sortedResults
        : sortedResults.filter(r => r.qualityTier !== 'low'),
    [sortedResults, showWeakerSources]
  )
  const evidenceStrength = currentRun?.evidenceStrength ?? 'strong'

  const selectedSource = useMemo(() => {
    if (!currentRun || !selectedSourceId) return null
    return currentRun.results.find(r => r.id === selectedSourceId) ?? null
  }, [currentRun, selectedSourceId])

  const selectedEvidence = useMemo(() => {
    if (!currentRun || !selectedSource) return []
    return currentRun.evidence.filter(e => e.sourceId === selectedSource.id)
  }, [currentRun, selectedSource])

  const latestAnswer = currentRun?.answers[currentRun.answers.length - 1]

  const formattedAnswerMarkdown = useMemo(() => {
    if (!latestAnswer?.markdown) return ''
    return formatInlineCitationsForStreamdown(latestAnswer.markdown)
  }, [latestAnswer?.markdown])

  const activeProviderReadyCount = useMemo(() => {
    return Object.values(providerStatuses).filter(s => s.configured).length
  }, [providerStatuses])

  const handleCitationBadgeClick = (citationLabel: string) => {
    if (!currentRun) return
    const target = currentRun.results.find(
      r => r.citationLabel.toUpperCase() === citationLabel.toUpperCase()
    )
    if (target) {
      setSelectedSourceId(target.id)
      setLedgerOpen(true)
    }
  }

  return (
    <div className="acuity-workspace flex h-full min-h-0 w-full min-w-0 flex-col overflow-x-hidden bg-[#09090f] text-[#fafafa]">
      {/* Minimalist Top Bar */}
      <header className="z-20 shrink-0 border-b border-[#35313c]/40 bg-[#09090f]/85 px-3 py-2.5 backdrop-blur-md sm:px-4 md:px-6">
        <div className="mx-auto flex max-w-[1480px] flex-wrap items-center justify-between gap-2 sm:gap-3">
          {/* Left: Brand Identity & Persistent History Drawer Toggle */}
          <div className="flex items-center gap-1.5 sm:gap-2">
            <button
              type="button"
              onClick={() => {
                setCurrentRun(null)
                setErrorMessage(null)
                setLedgerOpen(false)
              }}
              aria-label="Acuity.Search — new enquiry"
              className="flex min-h-11 items-center gap-1.5 rounded-full border border-[#35313c]/80 bg-[#111118] px-2.5 py-1 text-left transition-colors hover:border-[#d4a843] sm:px-3 sm:py-1.5"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/brand-mark.png"
                alt=""
                width={28}
                height={28}
                className="size-7 shrink-0 rounded-md"
              />
              <span className="font-serif text-sm font-medium tracking-tight text-[#fafafa] sm:text-base">
                Acuity<span className="text-[#d4a843]">.Search</span>
              </span>
            </button>

            <button
              ref={historyToggleRef}
              type="button"
              onClick={() => setHistoryOpen(prev => !prev)}
              aria-expanded={historyOpen}
              aria-controls="acuity-history-panel"
              className={`inline-flex min-h-11 items-center gap-1.5 rounded-full border px-3 py-1 font-mono text-[12px] transition-colors sm:px-3 sm:py-1.5 ${
                historyOpen
                  ? 'border-[#d4a843] bg-[#d4a843]/15 text-[#e8c96a]'
                  : 'border-[#35313c] bg-[#111118] text-[#b3b0bd] hover:border-[#d4a843]/60 hover:text-[#fafafa]'
              }`}
            >
              <span>History</span>
              {runHistory.length > 0 && (
                <span className="rounded-full bg-[#d4a843]/20 px-1.5 py-0.5 font-mono text-[12px] text-[#e8c96a]">
                  {runHistory.length}
                </span>
              )}
            </button>
          </div>

          {/* Centre: Clean 3-Mode Pill Switcher (General · Literature · Topic Specific) */}
          <nav
            aria-label="Discovery modes"
            className="order-3 flex w-full justify-center rounded-full border border-[#35313c] bg-[#111118] p-1 shadow-sm sm:order-2 sm:w-auto"
          >
            {visibleModes.map(m => {
              const active = mode === m
              return (
                <button
                  key={m}
                  type="button"
                  onClick={() => {
                    setMode(m)
                    if (m === 'collections') {
                      setScopePolicy('strict')
                    } else {
                      setScopePolicy('open')
                    }
                  }}
                  aria-pressed={active}
                  className={`min-h-11 flex-1 rounded-full px-3 py-1.5 font-mono text-[12px] transition-all sm:flex-initial sm:px-4 sm:text-xs ${
                    active
                      ? 'bg-[#d4a843] font-semibold text-[#09090f] shadow-xs'
                      : 'text-[#b3b0bd] hover:text-[#fafafa]'
                  }`}
                >
                  {MODE_DESCRIPTIONS[m].label}
                </button>
              )
            })}
          </nav>

          {/* Right: Surface & Evidence Ledger Drawer Toggle */}
          <div className="order-2 flex items-center gap-1.5 sm:order-3 sm:gap-2">
            {currentRun && (
              <button
                type="button"
                onClick={() =>
                  setReadingSurface(prev =>
                    prev === 'void' ? 'parchment' : 'void'
                  )
                }
                aria-pressed={readingSurface === 'parchment'}
                className="inline-flex min-h-11 items-center rounded-full border border-[#35313c] bg-[#111118] px-3 py-1 font-mono text-[12px] text-[#b3b0bd] hover:border-[#d4a843] hover:text-[#e8c96a]"
                title="Toggle Void / Warm Parchment reading surface"
              >
                {readingSurface === 'void' ? 'Parchment' : 'Void'}
              </button>
            )}

            <button
              type="button"
              onClick={() => setLedgerOpen(prev => !prev)}
              aria-expanded={ledgerOpen}
              className={`inline-flex min-h-11 items-center gap-1.5 rounded-full border px-3 py-1 font-mono text-[12px] transition-colors sm:px-3 sm:py-1 ${
                ledgerOpen
                  ? 'border-[#d4a843] bg-[#d4a843]/15 text-[#e8c96a]'
                  : 'border-[#35313c] bg-[#111118] text-[#b3b0bd] hover:border-[#d4a843]/60 hover:text-[#fafafa]'
              }`}
            >
              <span
                className={`size-1.5 rounded-full ${
                  currentRun ? 'bg-[#4ca771]' : 'bg-[#d4a843]'
                }`}
              />
              <span className="hidden sm:inline">Evidence</span> Ledger
              {currentRun ? ` (${currentRun.evidence.length})` : ''}
            </button>
            {!embed && <WorkspaceSignOut />}
          </div>
        </div>
      </header>

      {/* Main Workspace Container: Collapsible History Drawer + Focused Centre Canvas + Collapsible Evidence Ledger */}
      <div className="relative mx-auto flex min-h-0 w-full max-w-[1480px] flex-1 overflow-hidden">
        {/* Left Collapsible Drawer: Persistent Search History */}
        {historyOpen && (
          <aside
            id="acuity-history-panel"
            ref={historyPanelRef}
            aria-label="Research history"
            role="dialog"
            aria-modal="false"
            className="fixed inset-y-0 left-0 z-50 flex w-[86vw] max-w-80 shrink-0 flex-col border-r border-[#35313c] bg-[#111118] shadow-2xl md:static md:z-auto md:w-80 md:shadow-none"
          >
            <div className="flex items-center justify-between border-b border-[#35313c]/70 px-4 py-3">
              <div>
                <h2 className="font-serif text-lg font-medium text-[#fafafa]">
                  Research History
                </h2>
                <p className="font-mono text-[12px] text-[#a29db0]">
                  Persisted locally ({runHistory.length}{' '}
                  {runHistory.length === 1 ? 'enquiry' : 'enquiries'})
                </p>
              </div>
              <button
                type="button"
                onClick={() => setHistoryOpen(false)}
                aria-label="Close history"
                className="min-h-11 rounded-lg border border-[#35313c] bg-[#181820] px-3 py-1 font-mono text-[12px] text-[#b3b0bd] hover:border-[#d4a843] hover:text-[#fafafa]"
              >
                Close <span aria-hidden="true">✕</span>
              </button>
            </div>

            <div className="flex flex-1 flex-col gap-2 overflow-y-auto p-3">
              <button
                type="button"
                onClick={() => {
                  setCurrentRun(null)
                  setQuery('')
                  setErrorMessage(null)
                  setHistoryOpen(false)
                }}
                className="flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl border border-[#d4a843]/60 bg-[#d4a843]/15 px-3 py-2 font-mono text-xs font-medium text-[#e8c96a] transition-colors hover:bg-[#d4a843]/25"
              >
                + New Enquiry
              </button>

              {runHistory.length === 0 ? (
                <div className="mt-4 rounded-xl border border-[#35313c]/60 bg-[#09090f]/60 p-4 text-center text-xs text-[#8e899c]">
                  Your completed enquiries and verified evidence ledgers will be
                  saved here automatically.
                </div>
              ) : (
                runHistory.map(item => {
                  const isCurrent = currentRun?.runId === item.runId
                  return (
                    <div
                      key={item.runId}
                      className={`group relative flex min-h-[52px] flex-col justify-between rounded-xl border text-left transition-all ${
                        isCurrent
                          ? 'border-[#d4a843] bg-[#d4a843]/15 text-[#fafafa]'
                          : 'border-[#35313c]/70 bg-[#09090f]/75 text-[#b3b0bd] hover:border-[#d4a843]/50 hover:text-[#fafafa]'
                      }`}
                    >
                      <button
                        type="button"
                        aria-current={isCurrent ? 'true' : undefined}
                        onClick={() => {
                          setCurrentRun(item)
                          setQuery(item.request.query)
                          setMode(item.request.mode)
                          setDepth(item.request.depth)
                          setSelectedSourceId(item.results[0]?.id ?? null)
                          setHistoryOpen(false)
                        }}
                        className="flex w-full flex-col rounded-xl p-2.5 pr-12 text-left"
                      >
                        <span className="line-clamp-2 text-[13px] font-medium leading-snug text-[#fafafa]">
                          {item.request.query}
                        </span>
                        <span className="mt-1.5 flex w-full items-center justify-between font-mono text-[12px] text-[#a29db0]">
                          <span>
                            {MODE_DESCRIPTIONS[item.request.mode].label} ·{' '}
                            {DEPTH_DESCRIPTIONS[item.request.depth].label}
                          </span>
                          <span className="text-[#d4a843]">
                            {item.results.length} sources
                          </span>
                        </span>
                      </button>
                      <button
                        type="button"
                        onClick={e => handleDeleteHistoryRun(item.runId, e)}
                        title="Delete from history"
                        aria-label={`Delete “${item.request.query}” from history`}
                        className="absolute top-0 right-0 inline-flex min-h-11 min-w-11 items-center justify-center rounded font-mono text-[12px] text-[#a29db0] opacity-80 transition-opacity hover:opacity-100 hover:text-[#e58c8c] focus-visible:opacity-100 md:opacity-0 md:group-hover:opacity-100"
                      >
                        <span aria-hidden="true">✕</span>
                      </button>
                    </div>
                  )
                })
              )}
            </div>
          </aside>
        )}

        {/* Backdrop for history drawer on mobile portrait */}
        {historyOpen && (
          <div
            onClick={() => setHistoryOpen(false)}
            className="fixed inset-0 z-40 bg-black/60 backdrop-blur-xs md:hidden"
            aria-hidden="true"
          />
        )}

        {/* Centre Pane: Morphic-Clean Portal & Reader */}
        <section
          aria-label="Research Enquiry and Results"
          className="flex min-w-0 flex-1 flex-col overflow-y-auto px-3 py-4 sm:px-6 md:px-8 md:py-6"
        >
          <div
            className={`mx-auto flex w-full flex-col ${
              !currentRun ? 'my-auto max-w-3xl pb-12' : 'max-w-3xl'
            }`}
          >
            {/* Portal Hero (Displayed when no run is active) */}
            <AcuityPortalHero
              mode={mode}
              topicGroups={topicGroups}
              selectedGroupIds={selectedGroupIds}
              onToggleGroup={handleToggleGroup}
              onSelectExampleQuery={(exQuery, exMode, exGroups) => {
                setQuery(exQuery)
                setMode(exMode)
                if (exGroups) setSelectedGroupIds(exGroups)
                void executeEnquiry({
                  query: exQuery,
                  mode: exMode,
                  groupIds: exGroups
                })
              }}
              compact={Boolean(currentRun)}
            />

            {/* Morphic-Inspired Unified Composer Box */}
            <form
              onSubmit={e => {
                e.preventDefault()
                void executeEnquiry()
              }}
              role="search"
              className="acuity-searchbox relative w-full rounded-3xl border border-[#35313c]/90 bg-[#111118]/95 p-3.5 shadow-[0_12px_48px_rgba(0,0,0,0.55)] transition-colors"
            >
              {mode === 'sacred-texts' && (
                <p
                  role="note"
                  className="mb-2 rounded-lg border border-[#35313c] bg-[#111118]/80 px-3 py-2 text-[13px] leading-relaxed text-[#b3b0bd]"
                >
                  {sacredTexts?.signedIn
                    ? 'The Library agent reads the Acuity sacred-text library and answers with cited passages. Deep enquiries can take a few minutes.'
                    : 'Sign in to consult the Library. The Library agent answers from the Acuity sacred-text library with cited passages.'}
                </p>
              )}
              <label htmlFor="acuity-enquiry" className="sr-only">
                Ask Acuity
              </label>
              <input
                id="acuity-enquiry"
                type="search"
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder={MODE_DESCRIPTIONS[mode].placeholder}
                enterKeyHint="search"
                className="min-h-11 w-full rounded-xl bg-transparent px-2.5 pt-1 pb-3 text-base text-[#fafafa] placeholder:text-[#a29db0]"
              />

              {/* Seamless Bottom Pill Bar Inside Composer (Quick vs Deep + Submit Arrow) */}
              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[#35313c]/40 pt-2.5">
                <div className="flex flex-wrap items-center gap-2.5">
                  {/* Quick vs Deep Pill Toggle */}
                  <div
                    role="group"
                    aria-label="Search depth"
                    className="inline-flex items-center rounded-full border border-[#35313c] bg-[#09090f] p-0.5"
                  >
                    {(['quick', 'research'] as const).map(d => {
                      const active = depth === d
                      return (
                        <button
                          key={d}
                          type="button"
                          onClick={() => setDepth(d)}
                          aria-pressed={active}
                          title={DEPTH_DESCRIPTIONS[d].detail}
                          className={`min-h-11 min-w-16 rounded-full px-4 py-1 font-mono text-[13px] transition-all ${
                            active
                              ? 'bg-[#d4a843] font-semibold text-[#09090f]'
                              : 'text-[#b3b0bd] hover:text-[#fafafa]'
                          }`}
                        >
                          {DEPTH_DESCRIPTIONS[d].label}
                        </button>
                      )
                    })}
                  </div>

                  {/* Subtle Active Scope / Provider Readiness Indicator (No LLM model names exposed) */}
                  <span className="font-mono text-[12px] text-[#a29db0]">
                    {scopeTagline(
                      mode,
                      selectedGroupIds.length,
                      entries.length
                    )}
                  </span>
                </div>

                {/* Submit Pill Button */}
                <button
                  type="submit"
                  disabled={isSearching}
                  className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-[#d4a843] bg-[#d4a843] px-5 py-1.5 font-mono text-[13px] font-semibold text-[#09090f] transition-all hover:bg-[#e8c96a] disabled:opacity-50"
                >
                  <span>{isSearching ? 'Enquiring…' : 'Enquire'}</span>
                  <span aria-hidden="true" className="text-sm leading-none">
                    ↑
                  </span>
                </button>
              </div>
            </form>

            {/* Topic Specific Simplified Domain Scope Panel (ONLY shown when Topic Specific mode is active) */}
            {mode === 'collections' && (
              <TopicDomainScopePanel
                topicGroups={topicGroups}
                entries={entries}
                selectedGroupIds={selectedGroupIds}
                starterPriorityOnly={starterPriorityOnly}
                onToggleGroup={handleToggleGroup}
                onSelectAllGroups={handleSelectAllGroups}
                onClearScope={handleClearScope}
                onToggleStarterPriority={() =>
                  setStarterPriorityOnly(prev => !prev)
                }
              />
            )}

            {/* Starter Exemplar Pills (Morphic-style below input when idle) */}
            {!currentRun && !isSearching && (
              <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
                {CURATED_ENQUIRY_PROMPTS.map(item => (
                  <button
                    key={item.label}
                    type="button"
                    onClick={() => {
                      setQuery(item.query)
                      setMode(item.mode)
                      if (item.groupIds) setSelectedGroupIds(item.groupIds)
                      void executeEnquiry({
                        query: item.query,
                        mode: item.mode,
                        groupIds: item.groupIds
                      })
                    }}
                    className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-[#35313c]/80 bg-[#111118]/80 px-4 py-1.5 text-[13px] text-[#b3b0bd] transition-all hover:border-[#d4a843]/60 hover:bg-[#181820] hover:text-[#e8c96a]"
                  >
                    <span className="font-mono text-[12px] text-[#d4a843]">
                      {item.category}
                    </span>
                    <span>{item.label}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Error Banner */}
          {errorMessage && (
            <div
              role="alert"
              className="mx-auto mt-4 w-full max-w-3xl rounded-xl border border-[#d16060] bg-[#d16060]/15 p-3.5 font-mono text-xs text-[#e58c8c]"
            >
              {errorMessage}
            </div>
          )}

          {/* Live progress while the enquiry streams */}
          {isSearching && progress && (
            <SearchProgress
              progress={progress}
              depth={depth}
              onCancel={handleCancelEnquiry}
            />
          )}

          {/* Active Search Run Output */}
          {currentRun && (
            <div className="mx-auto mt-5 flex w-full max-w-3xl flex-col gap-5 pb-16">
              {/* Topic Specific Suggestion Pill (When running in General mode and query matches a curated topic) */}
              {currentRun.plan.suggestedGroups.length > 0 &&
                currentRun.request.mode === 'general' && (
                  <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-[#7c5ce0]/40 bg-[#7c5ce0]/10 px-4 py-2.5 text-xs">
                    <div>
                      <span className="font-mono text-[12px] text-[#c7b8f5]">
                        Relevant Topic Domain:{' '}
                      </span>
                      <span className="text-[#fafafa]">
                        {currentRun.plan.suggestedGroups
                          .map(g => g.title)
                          .join(' · ')}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        const ids = currentRun.plan.suggestedGroups.map(
                          g => g.groupId
                        )
                        setSelectedGroupIds(ids)
                        setMode('collections')
                        setScopePolicy('strict')
                        void executeEnquiry({
                          query: currentRun.request.query,
                          mode: 'collections',
                          groupIds: ids
                        })
                      }}
                      className="min-h-11 rounded-full border border-[#d4a843] bg-[#d4a843]/20 px-4 py-1 font-mono text-[12px] text-[#e8c96a] hover:bg-[#d4a843]/30"
                    >
                      Focus on this topic →
                    </button>
                  </div>
                )}

              {/* Weak / no strong sources state */}
              {evidenceStrength !== 'strong' && (
                <div
                  role="status"
                  className="rounded-2xl border border-[#d9a05b]/40 bg-[#d9a05b]/10 px-4 py-3.5"
                >
                  <p className="font-serif text-lg text-[#fafafa]">
                    {evidenceStrength === 'none'
                      ? 'The archives are quiet on this.'
                      : 'Only a few strong sources answered this.'}
                  </p>
                  <p className="mt-1 text-[14px] leading-relaxed text-[#d8d4e2]">
                    {evidenceStrength === 'none'
                      ? 'No reliable source matched closely enough to compose a narrative. Try rephrasing, adding a tradition or text name, or searching the curated repositories.'
                      : 'Treat this overview as a starting point. Searching the curated repositories may surface deeper material.'}
                  </p>
                  {currentRun.request.mode !== 'collections' && (
                    <button
                      type="button"
                      onClick={() => {
                        setMode('collections')
                        setScopePolicy('strict')
                        void executeEnquiry({
                          query: currentRun.request.query,
                          mode: 'collections'
                        })
                      }}
                      className="mt-3 inline-flex min-h-11 items-center rounded-full border border-[#d4a843] bg-[#d4a843]/15 px-4 font-mono text-[12px] text-[#e8c96a] hover:bg-[#d4a843]/25"
                    >
                      Search the curated repositories →
                    </button>
                  )}
                </div>
              )}

              {/* Show / Hide Key Sources Toggle Directly Above the LLM Synthesis Output */}
              <CitedSourceRibbon
                results={visibleResults}
                citedLabels={latestAnswer?.citations.citedLabels ?? []}
                selectedSourceId={selectedSourceId}
                onSelectSource={id => {
                  setSelectedSourceId(id)
                  setLedgerOpen(true)
                }}
              />

              {/* Formatted Markdown Synthesis Card (Main Visual Interface) */}
              {latestAnswer && (
                <div
                  className={`rounded-3xl border p-6 shadow-xl md:p-8 ${
                    readingSurface === 'parchment'
                      ? 'border-[#d3c7ad] bg-[#f4efe2] text-[#27241c]'
                      : 'border-[#35313c]/90 bg-[#111118] text-[#fafafa]'
                  }`}
                >
                  <div className="mb-5 flex flex-wrap items-center justify-between gap-2 border-b border-[#35313c]/50 pb-3.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-serif text-xl font-medium">
                        {latestAnswer.mode === 'synthesized'
                          ? 'Research Synthesis'
                          : 'Evidence Overview'}
                      </span>
                      <span className="rounded-full border border-[#d4a843]/50 bg-[#d4a843]/15 px-2.5 py-0.5 font-mono text-[12px] text-[#e8c96a]">
                        {currentRun.request.depth === 'research'
                          ? 'Deep Retrieval'
                          : 'Quick Pass'}{' '}
                        · {currentRun.results.length} sources
                      </span>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setLedgerOpen(prev => !prev)}
                        className="min-h-11 whitespace-nowrap rounded-full border border-[#35313c] bg-[#181820] px-4 py-1 font-mono text-[12px] text-[#b3b0bd] hover:border-[#d4a843] hover:text-[#e8c96a]"
                      >
                        {ledgerOpen ? 'Hide Ledger' : 'Inspect Ledger'}
                      </button>
                      <button
                        type="button"
                        onClick={() => setShareModalOpen(true)}
                        className="min-h-11 whitespace-nowrap rounded-full border border-[#d4a843]/80 bg-[#d4a843]/15 px-4 py-1 font-mono text-[12px] text-[#e8c96a] hover:bg-[#d4a843]/25"
                      >
                        Share / Export
                      </button>
                      {embed && (
                        <AddToCodexButton
                          runId={currentRun.runId}
                          query={currentRun.request.query}
                          embed={embed}
                          disabled={
                            currentRun.status !== 'completed' &&
                            currentRun.status !== 'partial'
                          }
                        />
                      )}
                    </div>
                  </div>

                  {/* Rich Typography Markdown Renderer with Interactive [S1] Citation Badges */}
                  <div
                    data-surface={readingSurface}
                    className={`prose max-w-none leading-relaxed ${
                      readingSurface === 'parchment'
                        ? 'prose-stone max-w-[68ch] font-serif text-[19px] leading-[1.7] text-[#2a2218]'
                        : 'prose-invert prose-neutral text-[15px] text-[#e6e4ed]'
                    }`}
                  >
                    {latestAnswer.disclosureNote && (
                      <p className="not-prose mb-4 rounded-xl border border-[#35313c]/60 px-3.5 py-2 font-mono text-[12px] opacity-80">
                        {latestAnswer.disclosureNote}
                      </p>
                    )}
                    <AnswerMarkdown
                      markdown={formattedAnswerMarkdown}
                      onCitation={handleCitationBadgeClick}
                    />
                  </div>

                  {latestAnswer.citations.unbackedClaimsWarning && (
                    <div className="mt-4 rounded-xl border border-[#d4a843]/60 bg-[#d4a843]/10 px-3.5 py-2 font-mono text-[12px] text-[#e8c96a]">
                      Verification notice:{' '}
                      {latestAnswer.citations.unbackedClaimsWarning}
                    </div>
                  )}
                </div>
              )}

              {/* Supporting Sources Section (Curated & Paginated, Never a 75-Card Wall) */}
              <div className="pt-2">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2 border-b border-[#35313c]/60 pb-2.5">
                  <div>
                    <h2 className="font-serif text-xl font-medium text-[#fafafa]">
                      Supporting Evidence & Sources
                    </h2>
                    <p className="font-mono text-[12px] text-[#a29db0]">
                      {currentRun.evidence.length} verified excerpts · Select
                      any source to view original text in the Ledger
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    <label className="flex items-center gap-1.5 font-mono text-xs text-[#b3b0bd]">
                      <span>Order:</span>
                      <select
                        aria-label="Sort results order"
                        value={sortOrder}
                        onChange={e =>
                          setSortOrder(e.target.value as SortOrder)
                        }
                        className="min-h-11 rounded-full border border-[#35313c] bg-[#111118] px-3 py-1 font-mono text-[13px] text-[#fafafa]"
                      >
                        {(
                          [
                            'combined-relevance',
                            'provider-order',
                            'newest'
                          ] as const
                        ).map(ord => (
                          <option key={ord} value={ord}>
                            {SORT_ORDER_LABELS[ord]}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                </div>

                <ResultCardsList
                  results={visibleResults}
                  citedLabels={latestAnswer?.citations.citedLabels ?? []}
                  mode={currentRun.request.mode}
                  selectedSourceId={selectedSourceId}
                  onSelectSource={id => {
                    setSelectedSourceId(id)
                    setLedgerOpen(true)
                  }}
                  readingSurface={readingSurface}
                />
                {weakerResults.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setShowWeakerSources(v => !v)}
                    aria-expanded={showWeakerSources}
                    className="mt-3 inline-flex min-h-11 items-center rounded-full border border-[#35313c] bg-[#111118] px-4 font-mono text-[12px] text-[#b3b0bd] hover:border-[#d4a843] hover:text-[#e8c96a]"
                  >
                    {showWeakerSources
                      ? 'Hide weaker sources'
                      : `Show ${weakerResults.length} weaker source${weakerResults.length === 1 ? '' : 's'}`}
                  </button>
                )}
              </div>
            </div>
          )}
        </section>

        {/* Right Pane: Verbatim Evidence & Provenance Ledger (Responsive Drawer on mobile portrait) */}
        {ledgerOpen && (
          <>
            <div
              onClick={() => setLedgerOpen(false)}
              className="fixed inset-0 z-35 bg-black/60 backdrop-blur-xs lg:hidden"
              aria-hidden="true"
            />
            <aside
              aria-label="Evidence Ledger and Diagnostics"
              className="fixed inset-y-0 right-0 z-40 flex w-full max-w-[92vw] shrink-0 flex-col border-l border-[#35313c] bg-[#111118]/98 shadow-2xl sm:max-w-md lg:static lg:z-auto lg:w-96 lg:shadow-none xl:w-[420px]"
            >
              <div className="flex items-center justify-between border-b border-[#35313c]/70 px-4 py-2.5">
                <h2 className="font-mono text-[12px] uppercase tracking-wider text-[#d4a843]">
                  Evidence & Provenance Ledger
                </h2>
                <button
                  type="button"
                  onClick={() => setLedgerOpen(false)}
                  aria-label="Close ledger"
                  className="min-h-11 rounded-lg border border-[#35313c] bg-[#181820] px-3 py-1 font-mono text-[12px] text-[#b3b0bd] hover:border-[#d4a843] hover:text-[#fafafa]"
                >
                  Close <span aria-hidden="true">✕</span>
                </button>
              </div>
              <div className="min-h-0 flex-1 overflow-hidden">
                <EvidenceDrawer
                  run={currentRun}
                  selectedSource={selectedSource}
                  selectedEvidence={selectedEvidence}
                  onSelectSource={id => setSelectedSourceId(id)}
                  onContinueResearch={handleContinueResearch}
                  continuing={isContinuing}
                />
              </div>
            </aside>
          </>
        )}
      </div>

      {/* Share & Export Modal */}
      {currentRun && (
        <ShareExportModal
          run={currentRun}
          open={shareModalOpen}
          onClose={() => setShareModalOpen(false)}
        />
      )}
    </div>
  )
}
