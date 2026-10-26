import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { loadDomainRegistry } from '@/lib/acuity/registry'

import { AcuitySearchWorkspace } from '@/components/acuity/acuity-search-workspace'
import { toClientRegistryEntries } from '@/components/acuity/acuity-types'
import { CitedSourceRibbon } from '@/components/acuity/result-cards'

describe('AcuitySearchWorkspace UI', () => {
  const registry = loadDomainRegistry()

  it('renders a clean Morphic-inspired default workspace with persistent History drawer toggle, Quick/Deep toggle, no LLM model labels, and Topic Specific domain registry isolation', () => {
    render(
      <AcuitySearchWorkspace
        topicGroups={registry.topicGroups}
        entries={toClientRegistryEntries(registry.entries)}
        crossCuttingTags={registry.crossCuttingTags}
        providerStatuses={{
          searxng: {
            provider: 'searxng',
            enabled: true,
            configured: true,
            status: 'ready',
            message: 'External SearXNG URL configured.'
          },
          brave: {
            provider: 'brave',
            enabled: true,
            configured: true,
            status: 'ready',
            message: 'Brave Search API key configured.'
          },
          tavily: {
            provider: 'tavily',
            enabled: true,
            configured: false,
            status: 'unconfigured',
            message: 'TAVILY_API_KEY is not configured.'
          },
          exa: {
            provider: 'exa',
            enabled: true,
            configured: true,
            status: 'ready',
            message: 'Exa API key configured.'
          }
        }}
        llmMode="openai-compatible"
        llmConfigured={true}
      />
    )

    // Brand identity and public tagline
    expect(screen.getAllByText('.Search').length).toBeGreaterThan(0)
    expect(
      screen.getAllByText('Open enquiry. Wider sources. Traceable answers.')
        .length
    ).toBeGreaterThan(0)

    // No underlying model name is exposed anywhere in the UI
    expect(screen.queryByText(/deepseek/i)).not.toBeInTheDocument()

    // Persistent History drawer toggle
    const historyBtn = screen.getByRole('button', { name: /History/i })
    expect(historyBtn).toBeInTheDocument()
    fireEvent.click(historyBtn)
    expect(screen.getByText('Research History')).toBeInTheDocument()

    // Discovery modes: General, Literature, Topic Specific
    expect(
      screen.getByRole('button', { name: /^General$/i })
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /^Literature$/i })
    ).toBeInTheDocument()
    const topicSpecificBtn = screen.getByRole('button', {
      name: /^Topic Specific$/i
    })
    expect(topicSpecificBtn).toBeInTheDocument()

    // Simple Quick & Deep depth toggles inside the composer
    expect(screen.getByRole('button', { name: /^Quick$/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Deep$/i })).toBeInTheDocument()

    // In General mode, the Topic Specific Domain Registry is hidden to keep the interface clean
    expect(screen.queryByText('Topic Collections')).not.toBeInTheDocument()

    // Clicking Topic Specific reveals the simplified domain scope panel with all 10 topic groups
    fireEvent.click(topicSpecificBtn)
    expect(screen.getByText('Topic Collections')).toBeInTheDocument()
    expect(screen.getByText(/Gnosticism, Hermeticism/i)).toBeInTheDocument()
  })

  it('keeps key sources collapsed behind a Show Key Sources toggle above the LLM output and expands cards when clicked', () => {
    render(
      <CitedSourceRibbon
        results={[
          {
            id: 'src-1',
            citationLabel: 'S1',
            url: 'https://www.cambridge.org/hermetica',
            normalizedUrl: 'https://www.cambridge.org/hermetica',
            hostname: 'www.cambridge.org',
            path: '/hermetica',
            title: 'Hermetica — Brian P. Copenhaver',
            snippet: 'The Greek Corpus Hermeticum and the Latin Asclepius.',
            rrfScore: 0.08,
            firstProviderOrder: 1,
            lane: 'wider-web',
            contentState: 'fulltext-excerpt',
            accessStatus: 'open-access',
            provenance: [
              {
                provider: 'exa',
                providerRank: 1,
                variantId: 'v1',
                executedQuery: 'Corpus Hermeticum',
                scoreContribution: 0.04,
                retrievedAt: '2026-10-25T17:00:00.000Z'
              }
            ],
            evidenceIds: ['ev-1']
          }
        ]}
        citedLabels={['S1']}
        selectedSourceId={null}
        onSelectSource={() => {}}
      />
    )

    const toggleBtn = screen.getByRole('button', {
      name: /Show Key Sources/i
    })
    expect(toggleBtn).toBeInTheDocument()
    // Cards are hidden initially so LLM synthesis is the main visual focus
    expect(
      screen.queryByText('Hermetica — Brian P. Copenhaver')
    ).not.toBeInTheDocument()

    // Clicking toggle reveals the cards
    fireEvent.click(toggleBtn)
    expect(
      screen.getByText('Hermetica — Brian P. Copenhaver')
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /Hide Key Sources/i })
    ).toBeInTheDocument()
  })
})
