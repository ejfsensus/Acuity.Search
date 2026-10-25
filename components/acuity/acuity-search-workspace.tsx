'use client'

import React, { useMemo, useState } from 'react'

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

import { AcuityEmblem, AcuityPortalHero } from './acuity-portal-hero'
import {
  DEPTH_DESCRIPTIONS,
  MODE_DESCRIPTIONS,
  PROVIDER_DISPLAY_NAMES,
  SORT_ORDER_LABELS
} from './acuity-types'
import { CollectionDrawer } from './collection-drawer'
import { EvidenceDrawer } from './evidence-drawer'
import { ResultCardsList } from './result-cards'
import { ShareExportModal } from './share-export-modal'

export interface AcuityWorkspaceInitialProps {
  topicGroups: DomainTopicGroup[]
  entries: DomainRegistryEntry[]
  crossCuttingTags: string[]
  providerStatuses: Record<ProviderId, ProviderConfigStatus>
  llmMode: string
  llmConfigured: boolean
}

export function AcuitySearchWorkspace({
  topicGroups,
  entries,
  crossCuttingTags,
  providerStatuses,
  llmMode,
  llmConfigured
}: AcuityWorkspaceInitialProps) {
  // Primary Discovery Controls
  const [query, setQuery] = useState('')
  const [mode, setMode] = useState<DiscoveryMode>('general')
  const [depth, setDepth] = useState<ResearchDepth>('quick')
  const [answerPreference, setAnswerPreference] = useState<AnswerPreference>(
    'answer-with-sources'
  )
  const [selectedProviders, setSelectedProviders] = useState<ProviderId[]>([
    'searxng',
    'brave',
    'tavily',
    'exa'
  ])
  const [sortOrder, setSortOrder] = useState<SortOrder>('combined-relevance')
  const [scopePolicy, setScopePolicy] = useState<ScopePolicy>('open')
  const [dateRange, setDateRange] = useState<DateRangeFilter>('all')
  const [fileType, setFileType] = useState<FileTypeFilter>('any')
  const [safeSearch, setSafeSearch] = useState<SafeSearchLevel>(0)

  // Collection & Domain Scope Selection
  const [selectedGroupIds, setSelectedGroupIds] = useState<string[]>([])
  const [selectedEntryIds, setSelectedEntryIds] = useState<string[]>([])
  const [selectedTags, setSelectedTags] = useState<string[]>([])
  const [starterPriorityOnly, setStarterPriorityOnly] = useState(false)
  const [customIncludeDomains, setCustomIncludeDomains] = useState('')
  const [customExcludeDomains, setCustomExcludeDomains] = useState('')

  // Workspace Layout & Reading Surface State
  const [readingSurface, setReadingSurface] = useState<'void' | 'parchment'>(
    'void'
  )
  const [mobilePane, setMobilePane] = useState<
    'enquiry' | 'collections' | 'evidence'
  >('enquiry')
  const [leftPaneOpen, setLeftPaneOpen] = useState(true)
  const [rightPaneOpen, setRightPaneOpen] = useState(true)
  const [shareModalOpen, setShareModalOpen] = useState(false)

  // Search Run Execution State
  const [currentRun, setCurrentRun] = useState<SearchRunState | null>(null)
  const [runHistory, setRunHistory] = useState<SearchRunState[]>([])
  const [selectedSourceId, setSelectedSourceId] = useState<string | null>(null)
  const [isSearching, setIsSearching] = useState(false)
  const [isContinuing, setIsContinuing] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const handleToggleProvider = (prov: ProviderId) => {
    setSelectedProviders(prev => {
      if (prev.includes(prov)) {
        if (prev.length === 1) return prev // Keep at least 1 selected
        return prev.filter(p => p !== prov)
      }
      return [...prev, prov]
    })
  }

  const handleToggleGroup = (groupId: string) => {
    setSelectedGroupIds(prev => {
      const next = prev.includes(groupId)
        ? prev.filter(id => id !== groupId)
        : [...prev, groupId]
      if (next.length > 0 && mode === 'general' && scopePolicy === 'open') {
        setScopePolicy('strict')
      }
      return next
    })
  }

  const handleToggleEntry = (entryId: string) => {
    setSelectedEntryIds(prev =>
      prev.includes(entryId)
        ? prev.filter(id => id !== entryId)
        : [...prev, entryId]
    )
  }

  const handleToggleTag = (tag: string) => {
    setSelectedTags(prev =>
      prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag]
    )
  }

  const handleClearScope = () => {
    setSelectedGroupIds([])
    setSelectedEntryIds([])
    setSelectedTags([])
    setStarterPriorityOnly(false)
    setCustomIncludeDomains('')
    setCustomExcludeDomains('')
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
    const activeGroups = overrideParams?.groupIds ?? selectedGroupIds
    const effectiveScopePolicy: ScopePolicy =
      activeMode === 'collections'
        ? 'strict'
        : activeGroups.length > 0 ||
            selectedEntryIds.length > 0 ||
            customIncludeDomains.trim().length > 0
          ? scopePolicy === 'open'
            ? activeMode === 'literature'
              ? 'collection-and-web-lanes'
              : 'strict'
            : scopePolicy
          : scopePolicy

    setIsSearching(true)
    setErrorMessage(null)

    try {
      const includeList = customIncludeDomains
        .split(',')
        .map(s => s.trim())
        .filter(Boolean)
      const excludeList = customExcludeDomains
        .split(',')
        .map(s => s.trim())
        .filter(Boolean)

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
          entryIds: selectedEntryIds,
          tags: selectedTags,
          starterPriorityOnly,
          includeDomains: includeList,
          excludeDomains: excludeList,
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
      setRunHistory(prev => [
        run,
        ...prev.filter(item => item.runId !== run.runId)
      ])
      setSelectedSourceId(run.results[0]?.id ?? null)
      setMobilePane('enquiry')
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
      setRunHistory(prev =>
        prev.map(r => (r.runId === updated.runId ? updated : r))
      )
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

  return (
    <div className="flex h-full min-h-0 w-full min-w-0 flex-col overflow-x-hidden bg-[#09090f] text-[#fafafa]">
      {/* Top Floating Pill Navigation Bar */}
      <header className="z-20 shrink-0 border-b border-[#35313c]/70 bg-[#09090f]/90 px-3 py-2.5 backdrop-blur-md md:px-5">
        <div className="mx-auto flex max-w-[1600px] flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={() => {
                setCurrentRun(null)
                setErrorMessage(null)
              }}
              className="flex items-center gap-2 rounded-full border border-[#35313c] bg-[#111118] px-3 py-1.5 text-left transition-colors hover:border-[#d4a843]"
            >
              <AcuityEmblem className="size-6" />
              <div>
                <span className="font-serif text-base font-medium tracking-tight text-[#fafafa]">
                  Acuity<span className="text-[#d4a843]">.Search</span>
                </span>
              </div>
            </button>

            <span className="hidden font-mono text-[11px] text-[#8e899c] xl:inline">
              Open enquiry. Wider sources. Traceable answers.
            </span>
          </div>

          {/* Primary Discovery Mode Pill Switcher */}
          <nav
            aria-label="Discovery modes"
            className="flex items-center rounded-full border border-[#35313c] bg-[#111118] p-1"
          >
            {(['general', 'literature', 'collections'] as const).map(m => {
              const active = mode === m
              return (
                <button
                  key={m}
                  type="button"
                  onClick={() => {
                    setMode(m)
                    if (m === 'collections') setScopePolicy('strict')
                  }}
                  aria-pressed={active}
                  className={`rounded-full px-3 py-1 font-mono text-xs transition-colors ${
                    active
                      ? 'bg-[#d4a843] font-semibold text-[#09090f]'
                      : 'text-[#b3b0bd] hover:text-[#fafafa]'
                  }`}
                >
                  {MODE_DESCRIPTIONS[m].label}
                </button>
              )
            })}
          </nav>

          {/* Right Action Controls: Reading Surface & Pane Toggles */}
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() =>
                setReadingSurface(prev =>
                  prev === 'void' ? 'parchment' : 'void'
                )
              }
              className="rounded-full border border-[#35313c] bg-[#111118] px-2.5 py-1 font-mono text-[11px] text-[#b3b0bd] hover:border-[#d4a843] hover:text-[#e8c96a]"
              title="Toggle Void / Warm Parchment reading surface"
            >
              Surface: {readingSurface === 'void' ? 'Void' : 'Parchment'}
            </button>

            <button
              type="button"
              onClick={() => setLeftPaneOpen(prev => !prev)}
              className="hidden rounded-full border border-[#35313c] bg-[#111118] px-2.5 py-1 font-mono text-[11px] text-[#b3b0bd] hover:border-[#d4a843] lg:inline-flex"
            >
              {leftPaneOpen ? 'Hide Registry' : 'Registry (110)'}
            </button>

            <button
              type="button"
              onClick={() => setRightPaneOpen(prev => !prev)}
              className="hidden rounded-full border border-[#35313c] bg-[#111118] px-2.5 py-1 font-mono text-[11px] text-[#b3b0bd] hover:border-[#d4a843] lg:inline-flex"
            >
              {rightPaneOpen ? 'Hide Ledger' : 'Evidence Ledger'}
            </button>
          </div>
        </div>

        {/* Mobile Tab Switcher (Zero Horizontal Overflow at 360px) */}
        <div className="mt-2 flex items-center gap-1 border-t border-[#35313c]/60 pt-2 lg:hidden">
          <button
            type="button"
            onClick={() => setMobilePane('enquiry')}
            className={`flex-1 rounded-lg py-1 font-mono text-[11px] ${
              mobilePane === 'enquiry'
                ? 'bg-[#d4a843]/20 text-[#e8c96a]'
                : 'text-[#8e899c]'
            }`}
          >
            Enquiry & Sources
          </button>
          <button
            type="button"
            onClick={() => setMobilePane('collections')}
            className={`flex-1 rounded-lg py-1 font-mono text-[11px] ${
              mobilePane === 'collections'
                ? 'bg-[#d4a843]/20 text-[#e8c96a]'
                : 'text-[#8e899c]'
            }`}
          >
            Collections (110)
          </button>
          <button
            type="button"
            onClick={() => setMobilePane('evidence')}
            className={`flex-1 rounded-lg py-1 font-mono text-[11px] ${
              mobilePane === 'evidence'
                ? 'bg-[#d4a843]/20 text-[#e8c96a]'
                : 'text-[#8e899c]'
            }`}
          >
            Evidence Ledger
          </button>
        </div>
      </header>

      {/* Main 3-Pane Desktop / Responsive Mobile Workspace */}
      <div className="mx-auto flex min-h-0 w-full max-w-[1600px] flex-1 overflow-hidden">
        {/* Left Pane: Collection & Domain Registry + Private Run History */}
        <aside
          aria-label="Collections and Registry"
          className={`${
            mobilePane === 'collections' ? 'flex w-full' : 'hidden'
          } ${
            leftPaneOpen ? 'lg:flex lg:w-80 xl:w-88' : 'lg:hidden'
          } shrink-0 flex-col border-r border-[#35313c] bg-[#111118]/90`}
        >
          {runHistory.length > 0 && (
            <div className="border-b border-[#35313c] p-3">
              <div className="mb-1.5 font-mono text-[10px] uppercase tracking-wider text-[#d4a843]">
                Session Research Runs ({runHistory.length})
              </div>
              <div className="flex max-h-28 flex-col gap-1 overflow-y-auto">
                {runHistory.map(item => (
                  <button
                    key={item.runId}
                    type="button"
                    onClick={() => {
                      setCurrentRun(item)
                      setSelectedSourceId(item.results[0]?.id ?? null)
                      setMobilePane('enquiry')
                    }}
                    className={`flex items-center justify-between rounded-lg border px-2 py-1 text-left text-xs ${
                      currentRun?.runId === item.runId
                        ? 'border-[#d4a843] bg-[#d4a843]/15 text-[#fafafa]'
                        : 'border-[#35313c] bg-[#09090f] text-[#b3b0bd]'
                    }`}
                  >
                    <span className="truncate pr-2">{item.request.query}</span>
                    <span className="shrink-0 font-mono text-[10px] text-[#8e899c]">
                      {item.results.length} src
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="min-h-0 flex-1 overflow-hidden">
            <CollectionDrawer
              topicGroups={topicGroups}
              entries={entries}
              crossCuttingTags={crossCuttingTags}
              selectedGroupIds={selectedGroupIds}
              selectedEntryIds={selectedEntryIds}
              selectedTags={selectedTags}
              starterPriorityOnly={starterPriorityOnly}
              customIncludeDomains={customIncludeDomains}
              customExcludeDomains={customExcludeDomains}
              onToggleGroup={handleToggleGroup}
              onToggleEntry={handleToggleEntry}
              onToggleTag={handleToggleTag}
              onToggleStarterPriority={() =>
                setStarterPriorityOnly(prev => !prev)
              }
              onChangeCustomInclude={setCustomIncludeDomains}
              onChangeCustomExclude={setCustomExcludeDomains}
              onClearAllScope={handleClearScope}
            />
          </div>
        </aside>

        {/* Centre Pane: Portal Hero, Enquiry Composer, Synthesized Answer & Ranked Sources */}
        <section
          aria-label="Research Enquiry and Results"
          className={`${
            mobilePane === 'enquiry' ? 'flex' : 'hidden lg:flex'
          } min-w-0 flex-1 flex-col overflow-y-auto px-3 py-4 md:px-6`}
        >
          <AcuityPortalHero
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

          {/* Search Composer & Discovery Controls */}
          <form
            onSubmit={e => {
              e.preventDefault()
              void executeEnquiry()
            }}
            className="mx-auto mt-2 w-full max-w-4xl rounded-2xl border border-[#35313c] bg-[#111118] p-3.5 shadow-xl"
          >
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs text-[#b3b0bd]">
              <span>{MODE_DESCRIPTIONS[mode].subtitle}</span>
              <span className="font-mono text-[11px] text-[#d4a843]">
                {DEPTH_DESCRIPTIONS[depth].badge}
              </span>
            </div>

            <div className="flex flex-col gap-2 sm:flex-row">
              <input
                type="search"
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="Enter an enquiry, manuscript title, tradition, translator, or archival topic..."
                aria-label="Research enquiry input"
                className="min-w-0 flex-1 rounded-xl border border-[#35313c] bg-[#09090f] px-3.5 py-2.5 text-sm text-[#fafafa] placeholder:text-[#8e899c] focus:border-[#d4a843] focus:outline-none"
              />
              <button
                type="submit"
                disabled={isSearching}
                className="shrink-0 rounded-xl border border-[#d4a843] bg-[#d4a843] px-5 py-2.5 font-mono text-xs font-semibold uppercase tracking-wider text-[#09090f] transition-colors hover:bg-[#e8c96a] disabled:opacity-50"
              >
                {isSearching ? 'Searching...' : 'Execute Enquiry'}
              </button>
            </div>

            {/* Depth, Answer Preference, Scope Policy & Provider Controls */}
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-[#35313c]/70 pt-2.5 text-xs">
              {/* Depth Switch */}
              <div className="flex items-center gap-1">
                <span className="font-mono text-[11px] text-[#8e899c]">
                  Depth:
                </span>
                {(['quick', 'research'] as const).map(d => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => setDepth(d)}
                    aria-pressed={depth === d}
                    className={`rounded-lg border px-2 py-1 font-mono text-[11px] ${
                      depth === d
                        ? 'border-[#d4a843] bg-[#d4a843]/20 text-[#e8c96a]'
                        : 'border-[#35313c] bg-[#09090f] text-[#b3b0bd]'
                    }`}
                  >
                    {DEPTH_DESCRIPTIONS[d].label}
                  </button>
                ))}
              </div>

              {/* Answer Preference Switch */}
              <div className="flex items-center gap-1">
                <span className="font-mono text-[11px] text-[#8e899c]">
                  Output:
                </span>
                <button
                  type="button"
                  onClick={() => setAnswerPreference('answer-with-sources')}
                  aria-pressed={answerPreference === 'answer-with-sources'}
                  className={`rounded-lg border px-2 py-1 font-mono text-[11px] ${
                    answerPreference === 'answer-with-sources'
                      ? 'border-[#d4a843] bg-[#d4a843]/20 text-[#e8c96a]'
                      : 'border-[#35313c] bg-[#09090f] text-[#b3b0bd]'
                  }`}
                >
                  Answer + Sources
                </button>
                <button
                  type="button"
                  onClick={() => setAnswerPreference('results-only')}
                  aria-pressed={answerPreference === 'results-only'}
                  className={`rounded-lg border px-2 py-1 font-mono text-[11px] ${
                    answerPreference === 'results-only'
                      ? 'border-[#d4a843] bg-[#d4a843]/20 text-[#e8c96a]'
                      : 'border-[#35313c] bg-[#09090f] text-[#b3b0bd]'
                  }`}
                >
                  Results Only
                </button>
              </div>

              {/* Scope Policy Selector */}
              <div className="flex items-center gap-1">
                <span className="font-mono text-[11px] text-[#8e899c]">
                  Scope:
                </span>
                <select
                  aria-label="Scope policy"
                  value={scopePolicy}
                  onChange={e => setScopePolicy(e.target.value as ScopePolicy)}
                  className="rounded-lg border border-[#35313c] bg-[#09090f] px-2 py-1 font-mono text-[11px] text-[#fafafa]"
                >
                  <option value="open">Open Web</option>
                  <option value="strict">Strict Collection Scope</option>
                  <option value="collection-and-web-lanes">
                    Collection + Web Lanes
                  </option>
                </select>
              </div>
            </div>

            {/* Provider Participation & Filters Row */}
            <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 border-t border-[#35313c]/50 pt-2.5 text-xs">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="font-mono text-[11px] text-[#8e899c]">
                  Providers:
                </span>
                {(['searxng', 'brave', 'tavily', 'exa'] as const).map(prov => {
                  const active = selectedProviders.includes(prov)
                  const st = providerStatuses[prov]
                  return (
                    <button
                      key={prov}
                      type="button"
                      onClick={() => handleToggleProvider(prov)}
                      aria-pressed={active}
                      title={st?.message}
                      className={`inline-flex items-center gap-1.5 rounded-lg border px-2 py-1 font-mono text-[11px] ${
                        active
                          ? 'border-[#d4a843]/80 bg-[#181820] text-[#fafafa]'
                          : 'border-[#35313c] bg-[#09090f]/50 text-[#8e899c]'
                      }`}
                    >
                      <span
                        className={`size-1.5 rounded-full ${
                          st?.configured ? 'bg-[#4ca771]' : 'bg-[#d4a843]'
                        }`}
                      />
                      {PROVIDER_DISPLAY_NAMES[prov]}
                    </button>
                  )
                })}
              </div>

              {/* Date Range, File Type & SafeSearch */}
              <div className="flex flex-wrap items-center gap-1.5 font-mono text-[11px]">
                <select
                  aria-label="Date range filter"
                  value={dateRange}
                  onChange={e =>
                    setDateRange(e.target.value as DateRangeFilter)
                  }
                  className="rounded-lg border border-[#35313c] bg-[#09090f] px-2 py-1 text-[#b3b0bd]"
                >
                  <option value="all">All time</option>
                  <option value="day">Past 24h</option>
                  <option value="week">Past week</option>
                  <option value="month">Past month</option>
                  <option value="year">Past year</option>
                </select>

                <select
                  aria-label="File type filter"
                  value={fileType}
                  onChange={e => setFileType(e.target.value as FileTypeFilter)}
                  className="rounded-lg border border-[#35313c] bg-[#09090f] px-2 py-1 text-[#b3b0bd]"
                >
                  <option value="any">Any format</option>
                  <option value="pdf">PDF only</option>
                  <option value="html">HTML only</option>
                  <option value="epub">EPUB only</option>
                </select>

                <select
                  aria-label="Provider SafeSearch setting"
                  value={safeSearch}
                  onChange={e =>
                    setSafeSearch(Number(e.target.value) as SafeSearchLevel)
                  }
                  className="rounded-lg border border-[#35313c] bg-[#09090f] px-2 py-1 text-[#b3b0bd]"
                >
                  <option value={0}>SafeSearch: 0 (Unfiltered default)</option>
                  <option value={1}>SafeSearch: 1 (Moderate)</option>
                  <option value={2}>SafeSearch: 2 (Strict)</option>
                </select>
              </div>
            </div>

            {/* Active Status Banner for LLM / Selected Collections */}
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2 font-mono text-[11px] text-[#8e899c]">
              <span>
                Synthesis Engine:{' '}
                <strong className="text-[#b3b0bd]">
                  {llmConfigured
                    ? `${llmMode} (configured)`
                    : 'Unconfigured (Search & Evidence Ledger active)'}
                </strong>
              </span>
              {(selectedGroupIds.length > 0 ||
                selectedEntryIds.length > 0 ||
                starterPriorityOnly) && (
                <span className="text-[#e8c96a]">
                  Scope: {selectedGroupIds.length} groups ·{' '}
                  {selectedEntryIds.length} pinned sources
                  {starterPriorityOnly ? ' · 20 Starter Priority' : ''}
                </span>
              )}
            </div>
          </form>

          {/* Error Banner */}
          {errorMessage && (
            <div
              role="alert"
              className="mx-auto mt-4 w-full max-w-4xl rounded-xl border border-[#d16060] bg-[#d16060]/15 p-3.5 font-mono text-xs text-[#e58c8c]"
            >
              {errorMessage}
            </div>
          )}

          {/* Active Search Run Output */}
          {currentRun && (
            <div className="mx-auto mt-6 flex w-full max-w-4xl flex-col gap-5 pb-12">
              {/* Warnings / Scope Disclosures */}
              {currentRun.warnings.length > 0 && (
                <div className="rounded-xl border border-[#d4a843]/40 bg-[#181820]/90 p-3 font-mono text-[11px] text-[#b3b0bd]">
                  <div className="mb-1 text-[#e8c96a]">
                    Provider & Scope Disclosures:
                  </div>
                  <ul className="list-inside list-disc space-y-0.5">
                    {currentRun.warnings.map((w, i) => (
                      <li key={i}>{w}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Topic Group Suggestions (Never silently applied in General mode) */}
              {currentRun.plan.suggestedGroups.length > 0 &&
                currentRun.request.mode === 'general' && (
                  <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[#7c5ce0]/50 bg-[#7c5ce0]/10 px-3.5 py-2.5 text-xs">
                    <div>
                      <span className="font-mono text-[11px] text-[#c7b8f5]">
                        Suggested Acuity Collections:{' '}
                      </span>
                      <span className="text-[#fafafa]">
                        {currentRun.plan.suggestedGroups
                          .map(
                            g =>
                              `${g.title} (${Math.round(g.confidence * 100)}%)`
                          )
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
                      className="rounded-lg border border-[#d4a843] bg-[#d4a843]/20 px-2.5 py-1 font-mono text-[11px] text-[#e8c96a] hover:bg-[#d4a843]/30"
                    >
                      Re-run in Suggested Collections →
                    </button>
                  </div>
                )}

              {/* Answer / Evidence Synthesis Card */}
              {latestAnswer && (
                <div
                  className={`rounded-2xl border p-5 ${
                    readingSurface === 'parchment'
                      ? 'border-[#d3c7ad] bg-[#f4efe2] text-[#27241c]'
                      : 'border-[#35313c] bg-[#111118] text-[#fafafa]'
                  }`}
                >
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2 border-b border-[#35313c]/50 pb-2.5">
                    <div className="flex items-center gap-2">
                      <span className="font-serif text-xl font-medium">
                        {latestAnswer.mode === 'synthesized'
                          ? 'Traceable Synthesis'
                          : 'Traceable Evidence Overview'}
                      </span>
                      <span className="rounded-full border border-[#d4a843]/50 bg-[#d4a843]/15 px-2.5 py-0.5 font-mono text-[10px] text-[#e8c96a]">
                        {latestAnswer.mode}
                      </span>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setShareModalOpen(true)}
                        className="rounded-lg border border-[#d4a843] bg-[#d4a843]/20 px-3 py-1 font-mono text-xs text-[#e8c96a] hover:bg-[#d4a843]/30"
                      >
                        Share / Export Bundle
                      </button>
                    </div>
                  </div>

                  <div className="whitespace-pre-wrap text-sm leading-relaxed">
                    {latestAnswer.markdown}
                  </div>

                  {latestAnswer.citations.unbackedClaimsWarning && (
                    <div className="mt-3 rounded-lg border border-[#d4a843]/60 bg-[#d4a843]/10 px-3 py-2 font-mono text-[11px] text-[#e8c96a]">
                      Citation Verification Notice:{' '}
                      {latestAnswer.citations.unbackedClaimsWarning}
                    </div>
                  )}
                </div>
              )}

              {/* Results Header & Ordering Controls */}
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#35313c] pb-2.5">
                <div>
                  <h2 className="font-serif text-xl font-medium text-[#fafafa]">
                    Retrieved Sources ({sortedResults.length})
                  </h2>
                  <p className="font-mono text-[11px] text-[#8e899c]">
                    Scope: {currentRun.scope.policy} ·{' '}
                    {currentRun.evidence.length} hashed evidence items
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <label className="flex items-center gap-1.5 font-mono text-xs text-[#b3b0bd]">
                    <span>Order:</span>
                    <select
                      aria-label="Sort results order"
                      value={sortOrder}
                      onChange={e => setSortOrder(e.target.value as SortOrder)}
                      className="rounded-lg border border-[#35313c] bg-[#111118] px-2.5 py-1 font-mono text-xs text-[#fafafa]"
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

              {/* Ranked Source Cards */}
              <ResultCardsList
                results={sortedResults}
                mode={currentRun.request.mode}
                selectedSourceId={selectedSourceId}
                onSelectSource={id => {
                  setSelectedSourceId(id)
                  setRightPaneOpen(true)
                }}
                readingSurface={readingSurface}
              />
            </div>
          )}
        </section>

        {/* Right Pane: Verbatim Evidence Ledger & Provider Execution Matrix */}
        <aside
          aria-label="Evidence Ledger and Diagnostics"
          className={`${mobilePane === 'evidence' ? 'flex w-full' : 'hidden'} ${
            rightPaneOpen ? 'lg:flex lg:w-88 xl:w-96' : 'lg:hidden'
          } shrink-0 flex-col border-l border-[#35313c] bg-[#111118]/90`}
        >
          <EvidenceDrawer
            run={currentRun}
            selectedSource={selectedSource}
            selectedEvidence={selectedEvidence}
            onSelectSource={id => setSelectedSourceId(id)}
            onContinueResearch={handleContinueResearch}
            continuing={isContinuing}
          />
        </aside>
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
