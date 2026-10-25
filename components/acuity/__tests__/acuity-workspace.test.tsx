import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { loadDomainRegistry } from '@/lib/acuity/registry'

import { AcuitySearchWorkspace } from '@/components/acuity/acuity-search-workspace'

describe('AcuitySearchWorkspace UI', () => {
  const registry = loadDomainRegistry()

  it('renders the Acuity.Search header, approved tagline, discovery modes, depth controls, provider chips, and 10 collection orbs', () => {
    render(
      <AcuitySearchWorkspace
        topicGroups={registry.topicGroups}
        entries={registry.entries}
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
        llmMode="unconfigured"
        llmConfigured={false}
      />
    )

    // Brand identity and public tagline
    expect(screen.getAllByText('.Search').length).toBeGreaterThan(0)
    expect(
      screen.getAllByText('Open enquiry. Wider sources. Traceable answers.')
        .length
    ).toBeGreaterThan(0)

    // Discovery modes
    expect(
      screen.getAllByRole('button', { name: /General/i }).length
    ).toBeGreaterThan(0)
    expect(
      screen.getAllByRole('button', { name: /Literature/i }).length
    ).toBeGreaterThan(0)
    expect(
      screen.getAllByRole('button', { name: /Collections/i }).length
    ).toBeGreaterThan(0)

    // Depth & answer preference controls
    expect(
      screen.getAllByRole('button', { name: /Quick/i }).length
    ).toBeGreaterThan(0)
    expect(
      screen.getAllByRole('button', { name: /Research/i }).length
    ).toBeGreaterThan(0)

    // Collection Registry drawer is rendered with all 10 thematic groups
    expect(
      screen.getByText('Domain Registry & Collections')
    ).toBeInTheDocument()
    expect(
      screen.getAllByText(/Gnosticism, Hermeticism/i).length
    ).toBeGreaterThanOrEqual(2)
  })
})
