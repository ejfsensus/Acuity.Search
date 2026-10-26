'use client'

import React, { useEffect, useMemo, useState } from 'react'

import { math } from '@streamdown/math'
import { defaultRehypePlugins, Streamdown } from 'streamdown'

import type { ProviderConfigStatus } from '@/lib/acuity/config'
import type {
  DomainRegistryEntry,
  DomainTopicGroup
} from '@/lib/acuity/registry'
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
import { sortSourceResults } from '@/lib/acuity/search/rank'

import {
  AcuityEmblem,
  AcuityPortalHero,
  CURATED_ENQUIRY_PROMPTS,
  TopicDomainScopePanel
} from './acuity-portal-hero'
import {
  DEPTH_DESCRIPTIONS,
  MODE_DESCRIPTIONS,
  SORT_ORDER_LABELS
} from './acuity-types'
import { EvidenceDrawer } from './evidence-drawer'
import { CitedSourceRibbon, ResultCardsList } from './result-cards'
import { ShareExportModal } from './share-export-modal'

import 'katex/dist/katex.min.css'

const rehypePlugins = Object.values(defaultRehypePlugins)
const LOCAL_STORAGE_HISTORY_KEY = 'acuity.search.history.v1'

export interface AcuityWorkspaceInitialProps {
  topicGroups: DomainTopicGroup[]
  entries: DomainRegistryEntry[]
  crossCuttingTags: string[]
  providerStatuses: Record<ProviderId, ProviderConfigStatus>
  llmMode?: string
  llmConfigured?: boolean
}

/**
 * Converts [S1], [S2] inline markers into interactive markdown citation links
 * that open the corresponding source in the Evidence Ledger on click.
 */
function formatInlineCitationsForStreamdown(markdown: string): string {
  return markdown.replace(/\[(S\d+)\](?!\()/g, '[$1](#cite-$1)')
}

export function AcuitySearchWorkspace({
  topicGroups,
  entries,
  providerStatuses
}: AcuityWorkspaceInitialProps) {
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

    setIsSearching(true)
    setErrorMessage(null)

    try {
      const response = await fetch('/api/acuity-search/runs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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

      const data = await response.json()
      if (!response.ok) {
        throw new Error(data.error || 'Search execution failed')
      }

      const run: SearchRunState = data.run
      setCurrentRun(run)
      const nextHistory = [
        run,
        ...runHistory.filter(item => item.runId !== run.runId)
      ]
      persistHistoryList(nextHistory)
      setSelectedSourceId(run.results[0]?.id ?? null)
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : 'Search request failed'
      )
    } finally {
      setIsSearching(false)
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
    <div className="flex h-full min-h-0 w-full min-w-0 flex-col overflow-x-hidden bg-[#09090f] text-[#fafafa]">
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
              className="flex min-h-[40px] items-center gap-1.5 rounded-full border border-[#35313c]/80 bg-[#111118] px-2.5 py-1 text-left transition-colors hover:border-[#d4a843] sm:px-3 sm:py-1.5"
            >
              <AcuityEmblem className="size-5 shrink-0" />
              <span className="font-serif text-sm font-medium tracking-tight text-[#fafafa] sm:text-base">
                Acuity<span className="text-[#d4a843]">.Search</span>
              </span>
            </button>

            <button
              type="button"
              onClick={() => setHistoryOpen(prev => !prev)}
              aria-pressed={historyOpen}
              className={`inline-flex min-h-[40px] items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-[11px] transition-colors sm:px-3 sm:py-1.5 ${
                historyOpen
                  ? 'border-[#d4a843] bg-[#d4a843]/15 text-[#e8c96a]'
                  : 'border-[#35313c] bg-[#111118] text-[#b3b0bd] hover:border-[#d4a843]/60 hover:text-[#fafafa]'
              }`}
            >
              <span>History</span>
              {runHistory.length > 0 && (
                <span className="rounded-full bg-[#d4a843]/20 px-1.5 py-0.2 font-mono text-[10px] text-[#e8c96a]">
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
            {(['general', 'literature', 'collections'] as const).map(m => {
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
                  className={`flex-1 rounded-full px-2.5 py-1.5 font-mono text-[11px] transition-all sm:flex-initial sm:px-3.5 sm:py-1 sm:text-xs ${
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
                className="hidden rounded-full border border-[#35313c] bg-[#111118] px-3 py-1 font-mono text-[11px] text-[#b3b0bd] hover:border-[#d4a843] hover:text-[#e8c96a] md:inline-flex"
                title="Toggle Void / Warm Parchment reading surface"
              >
                {readingSurface === 'void' ? 'Parchment' : 'Void'}
              </button>
            )}

            <button
              type="button"
              onClick={() => setLedgerOpen(prev => !prev)}
              aria-pressed={ledgerOpen}
              className={`inline-flex min-h-[40px] items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-[11px] transition-colors sm:px-3 sm:py-1 ${
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
          </div>
        </div>
      </header>

      {/* Main Workspace Container: Collapsible History Drawer + Focused Centre Canvas + Collapsible Evidence Ledger */}
      <div className="relative mx-auto flex min-h-0 w-full max-w-[1480px] flex-1 overflow-hidden">
        {/* Left Collapsible Drawer: Persistent Search History */}
        {historyOpen && (
          <aside
            aria-label="Search History"
            className="absolute inset-y-0 left-0 z-30 flex w-72 shrink-0 flex-col border-r border-[#35313c] bg-[#111118]/95 shadow-2xl backdrop-blur-md md:static md:w-80 md:shadow-none"
          >
            <div className="flex items-center justify-between border-b border-[#35313c]/70 px-4 py-3">
              <div>
                <h3 className="font-serif text-base font-medium text-[#fafafa]">
                  Research History
                </h3>
                <p className="font-mono text-[10px] text-[#8e899c]">
                  Persisted locally ({runHistory.length}{' '}
                  {runHistory.length === 1 ? 'enquiry' : 'enquiries'})
                </p>
              </div>
              <button
                type="button"
                onClick={() => setHistoryOpen(false)}
                className="min-h-[32px] rounded-lg border border-[#35313c] bg-[#181820] px-2.5 py-1 font-mono text-[11px] text-[#b3b0bd] hover:border-[#d4a843] hover:text-[#fafafa]"
              >
                Close ✕
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
                      role="button"
                      tabIndex={0}
                      onClick={() => {
                        setCurrentRun(item)
                        setQuery(item.request.query)
                        setMode(item.request.mode)
                        setDepth(item.request.depth)
                        setSelectedSourceId(item.results[0]?.id ?? null)
                        setHistoryOpen(false)
                      }}
                      onKeyDown={e => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          setCurrentRun(item)
                          setQuery(item.request.query)
                          setMode(item.request.mode)
                          setDepth(item.request.depth)
                          setSelectedSourceId(item.results[0]?.id ?? null)
                          setHistoryOpen(false)
                        }
                      }}
                      className={`group flex min-h-[52px] flex-col justify-between rounded-xl border p-2.5 text-left transition-all ${
                        isCurrent
                          ? 'border-[#d4a843] bg-[#d4a843]/15 text-[#fafafa]'
                          : 'border-[#35313c]/70 bg-[#09090f]/75 text-[#b3b0bd] hover:border-[#d4a843]/50 hover:text-[#fafafa]'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <span className="line-clamp-2 text-xs font-medium leading-snug text-[#fafafa]">
                          {item.request.query}
                        </span>
                        <button
                          type="button"
                          onClick={e => handleDeleteHistoryRun(item.runId, e)}
                          title="Delete from history"
                          className="min-h-[28px] min-w-[28px] shrink-0 rounded px-1 font-mono text-[10px] text-[#8e899c] opacity-70 transition-opacity hover:opacity-100 hover:text-[#e58c8c] md:opacity-0 md:group-hover:opacity-100"
                        >
                          ✕
                        </button>
                      </div>
                      <div className="mt-1.5 flex items-center justify-between font-mono text-[10px] text-[#8e899c]">
                        <span>
                          {MODE_DESCRIPTIONS[item.request.mode].label} ·{' '}
                          {DEPTH_DESCRIPTIONS[item.request.depth].label}
                        </span>
                        <span className="text-[#d4a843]">
                          {item.results.length} sources
                        </span>
                      </div>
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
            className="fixed inset-0 z-20 bg-black/60 backdrop-blur-xs md:hidden"
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
              className="relative w-full rounded-3xl border border-[#35313c]/90 bg-[#111118]/95 p-3.5 shadow-[0_12px_48px_rgba(0,0,0,0.55)] transition-colors focus-within:border-[#d4a843]/70"
            >
              <input
                type="search"
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder={MODE_DESCRIPTIONS[mode].placeholder}
                aria-label="Research enquiry input"
                className="w-full bg-transparent px-2.5 pt-1 pb-3 text-base text-[#fafafa] placeholder:text-[#8e899c] focus:outline-none"
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
                          className={`rounded-full px-3 py-1 font-mono text-xs transition-all ${
                            active
                              ? 'bg-[#d4a843] font-semibold text-[#09090f]'
                              : 'text-[#8e899c] hover:text-[#fafafa]'
                          }`}
                        >
                          {DEPTH_DESCRIPTIONS[d].label}
                        </button>
                      )
                    })}
                  </div>

                  {/* Subtle Active Scope / Provider Readiness Indicator (No LLM model names exposed) */}
                  <span className="hidden font-mono text-[11px] text-[#8e899c] sm:inline">
                    {DEPTH_DESCRIPTIONS[depth].badge} · Searching verified
                    archives & web indexes
                  </span>
                </div>

                {/* Submit Pill Button */}
                <button
                  type="submit"
                  disabled={isSearching}
                  aria-label="Execute Enquiry"
                  className="inline-flex items-center gap-1.5 rounded-full border border-[#d4a843] bg-[#d4a843] px-4 py-1.5 font-mono text-xs font-semibold text-[#09090f] transition-all hover:bg-[#e8c96a] disabled:opacity-50"
                >
                  <span>{isSearching ? 'Searching...' : 'Enquire'}</span>
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
            {!currentRun && (
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
                    className="inline-flex items-center gap-1.5 rounded-full border border-[#35313c]/80 bg-[#111118]/80 px-3.5 py-1.5 text-xs text-[#b3b0bd] transition-all hover:border-[#d4a843]/60 hover:bg-[#181820] hover:text-[#e8c96a]"
                  >
                    <span className="font-mono text-[10px] text-[#d4a843]">
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

          {/* Active Search Run Output */}
          {currentRun && (
            <div className="mx-auto mt-5 flex w-full max-w-3xl flex-col gap-5 pb-16">
              {/* Topic Specific Suggestion Pill (When running in General mode and query matches a curated topic) */}
              {currentRun.plan.suggestedGroups.length > 0 &&
                currentRun.request.mode === 'general' && (
                  <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-[#7c5ce0]/40 bg-[#7c5ce0]/10 px-4 py-2.5 text-xs">
                    <div>
                      <span className="font-mono text-[11px] text-[#c7b8f5]">
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
                      className="rounded-full border border-[#d4a843] bg-[#d4a843]/20 px-3 py-1 font-mono text-[11px] text-[#e8c96a] hover:bg-[#d4a843]/30"
                    >
                      Focus on this topic →
                    </button>
                  </div>
                )}

              {/* Show / Hide Key Sources Toggle Directly Above the LLM Synthesis Output */}
              <CitedSourceRibbon
                results={sortedResults}
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
                      <span className="rounded-full border border-[#d4a843]/50 bg-[#d4a843]/15 px-2.5 py-0.5 font-mono text-[10px] text-[#e8c96a]">
                        {currentRun.request.depth === 'research'
                          ? 'Deep Retrieval'
                          : 'Quick Pass'}{' '}
                        · {currentRun.results.length} sources
                      </span>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setLedgerOpen(prev => !prev)}
                        className="rounded-full border border-[#35313c] bg-[#181820] px-3 py-1 font-mono text-[11px] text-[#b3b0bd] hover:border-[#d4a843] hover:text-[#e8c96a]"
                      >
                        {ledgerOpen ? 'Hide Ledger' : 'Inspect Ledger'}
                      </button>
                      <button
                        type="button"
                        onClick={() => setShareModalOpen(true)}
                        className="rounded-full border border-[#d4a843]/80 bg-[#d4a843]/15 px-3 py-1 font-mono text-[11px] text-[#e8c96a] hover:bg-[#d4a843]/25"
                      >
                        Share / Export
                      </button>
                    </div>
                  </div>

                  {/* Rich Typography Markdown Renderer with Interactive [S1] Citation Badges */}
                  <div
                    className={`prose max-w-none text-sm leading-relaxed ${
                      readingSurface === 'parchment'
                        ? 'prose-stone text-[#27241c]'
                        : 'prose-invert prose-neutral text-[#e6e4ed]'
                    }`}
                  >
                    <Streamdown
                      mode="static"
                      plugins={{ math }}
                      rehypePlugins={rehypePlugins}
                      components={{
                        a: ({ href, children, ...props }) => {
                          if (href && href.startsWith('#cite-')) {
                            const label = href.replace('#cite-', '')
                            return (
                              <button
                                type="button"
                                onClick={() => handleCitationBadgeClick(label)}
                                title={`View excerpt for ${label}`}
                                className="mx-0.5 inline-flex items-center rounded border border-[#d4a843]/60 bg-[#d4a843]/15 px-1.5 py-0.2 font-mono text-[11px] font-semibold text-[#e8c96a] transition-colors hover:bg-[#d4a843] hover:text-[#09090f]"
                              >
                                {children}
                              </button>
                            )
                          }
                          return (
                            <a
                              href={href}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-[#e8c96a] underline underline-offset-4 hover:text-[#d4a843]"
                              {...props}
                            >
                              {children}
                            </a>
                          )
                        }
                      }}
                    >
                      {formattedAnswerMarkdown}
                    </Streamdown>
                  </div>

                  {latestAnswer.citations.unbackedClaimsWarning && (
                    <div className="mt-4 rounded-xl border border-[#d4a843]/60 bg-[#d4a843]/10 px-3.5 py-2 font-mono text-[11px] text-[#e8c96a]">
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
                    <p className="font-mono text-[11px] text-[#8e899c]">
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
                        className="rounded-full border border-[#35313c] bg-[#111118] px-3 py-1 font-mono text-xs text-[#fafafa]"
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
                  results={sortedResults}
                  citedLabels={latestAnswer?.citations.citedLabels ?? []}
                  mode={currentRun.request.mode}
                  selectedSourceId={selectedSourceId}
                  onSelectSource={id => {
                    setSelectedSourceId(id)
                    setLedgerOpen(true)
                  }}
                  readingSurface={readingSurface}
                />
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
                <span className="font-mono text-[11px] uppercase tracking-wider text-[#d4a843]">
                  Evidence & Provenance Ledger
                </span>
                <button
                  type="button"
                  onClick={() => setLedgerOpen(false)}
                  className="min-h-[32px] rounded-lg border border-[#35313c] bg-[#181820] px-2.5 py-1 font-mono text-[11px] text-[#b3b0bd] hover:border-[#d4a843] hover:text-[#fafafa]"
                >
                  Close ✕
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
