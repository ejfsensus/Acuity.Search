import { expect, type Page, test } from '@playwright/test'

function sse(events: object[]): string {
  return events
    .map(
      e =>
        `event: ${(e as { type: string }).type}\ndata: ${JSON.stringify(e)}\n\n`
    )
    .join('')
}

const source = (i: number, hostname: string, title: string, tier: string) => ({
  id: `s${i}`,
  citationLabel: `S${i}`,
  url: `https://${hostname}/p${i}`,
  normalizedUrl: `https://${hostname}/p${i}`,
  title,
  snippet: `${title} snippet`,
  hostname,
  path: `/p${i}`,
  contentState: 'snippet',
  accessStatus: 'open',
  lane: 'wider-web',
  rrfScore: 0.01,
  firstProviderOrder: i,
  provenance: [
    {
      provider: 'searxng',
      providerRank: i,
      variantId: 'v1',
      executedQuery: 'q'
    }
  ],
  evidenceIds: [`e${i}`],
  qualityTier: tier,
  relevance: 1
})

function run(query: string, strength: 'strong' | 'none') {
  const results =
    strength === 'strong'
      ? [
          source(1, 'plato.stanford.edu', 'Gnosticism', 'scholarly'),
          source(2, 'gnosis.org', 'Gospel of Thomas', 'curated'),
          source(3, 'www.pinterest.com', 'Pin', 'low')
        ]
      : [source(1, 'www.instagram.com', 'blorpt', 'low')]
  return {
    runId: 'run-e2e',
    userId: '',
    isGuest: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    status: 'completed',
    request: { query, mode: 'general', depth: 'quick', providers: ['searxng'] },
    scope: {
      policy: 'open',
      targets: [],
      includeDomains: [],
      excludeDomains: []
    },
    plan: {
      variants: [{ id: 'v1', query, kind: 'literal' }],
      suggestedGroups: [],
      cleanedQuery: query
    },
    budget: {
      depth: 'quick',
      maxSearchRequests: 8,
      usedSearchRequests: 1,
      maxVariants: 2,
      usedVariants: 1,
      maxExtractions: 4,
      usedExtractions: 0,
      initialLatencyBudgetMs: 0,
      totalLatencyBudgetMs: 0,
      elapsedMs: 1,
      maxSynthesisTokens: 0
    },
    providerAttempts: [],
    results,
    evidence: results.map(r => ({
      id: r.evidenceIds[0],
      sourceId: r.id,
      citationLabel: r.citationLabel,
      sourceUrl: r.url,
      title: r.title,
      verbatimText: r.snippet,
      sha256: 'x',
      contentState: 'snippet',
      mimeType: 'text/plain',
      byteLength: 1,
      extractedAt: '',
      locator: { kind: 'snippet', value: 'snippet' },
      redirectChain: []
    })),
    answers: [
      {
        id: 'a1',
        versionNumber: 1,
        createdAt: '',
        modelId: null,
        mode: strength === 'strong' ? 'synthesized' : 'results-only',
        markdown:
          strength === 'strong'
            ? 'The kingdom is within [S1][S2].'
            : 'Closest results [S1].',
        citations: {
          valid: true,
          citedLabels: ['S1'],
          resolvedLabels: ['S1'],
          unresolvedLabels: []
        }
      }
    ],
    coverage: [],
    nextContinuationCursor: 0,
    warnings: [],
    evidenceStrength: strength
  }
}

async function stubRuns(page: Page, strength: 'strong' | 'none') {
  await page.route('**/api/acuity-search/runs', async route => {
    if (route.request().method() === 'GET') {
      return route.fulfill({ json: { runs: [] } })
    }
    const { query } = route.request().postDataJSON()
    const r = run(query, strength)
    await new Promise(res => setTimeout(res, 600))
    return route.fulfill({
      status: 200,
      headers: { 'content-type': 'text/event-stream; charset=utf-8' },
      body: sse([
        {
          type: 'run.Accepted',
          runId: r.runId,
          request: r.request,
          scope: r.scope
        },
        { type: 'plan.Created', runId: r.runId, plan: r.plan },
        {
          type: 'provider.Started',
          runId: r.runId,
          provider: 'searxng',
          query
        },
        { type: 'results.Updated', runId: r.runId, results: r.results },
        { type: 'answer.Delta', runId: r.runId, textDelta: 'The kingdom ' },
        { type: 'answer.Completed', runId: r.runId, answer: r.answers[0] },
        { type: 'run.Completed', runId: r.runId, run: r }
      ])
    })
  })
}

test('static assets and SEO routes are served, unknown routes 404', async ({
  request
}) => {
  expect(
    (await request.get('/fonts/Inter.woff2')).headers()['content-type']
  ).toContain('font/woff2')
  expect((await request.get('/robots.txt')).status()).toBe(200)
  expect((await request.get('/sitemap.xml')).status()).toBe(200)
  expect((await request.get('/definitely-not-a-page')).status()).toBe(404)
})

test('home has one h1, one search box, canonical and a visible focus ring', async ({
  page
}) => {
  await page.goto('/')
  await expect(page.locator('h1')).toHaveCount(1)
  await expect(page.locator('input[type=search]')).toHaveCount(1)
  await expect(page.locator('link[rel=canonical]')).toHaveAttribute(
    'href',
    /acuity\.institute/
  )
  await page.locator('input[type=search]').focus()
  await page.keyboard.press('Tab')
  await page.keyboard.press('Shift+Tab')
  const outline = await page
    .locator('input[type=search]')
    .evaluate(e => getComputedStyle(e).outlineStyle)
  expect(outline).toBe('solid')
})

test('streams an enquiry, hides weaker sources behind a toggle', async ({
  page
}) => {
  await stubRuns(page, 'strong')
  await page.goto('/')
  await page
    .locator('input[type=search]')
    .fill('Gospel of Thomas kingdom within')
  await page.locator('input[type=search]').press('Enter')
  await expect(page.getByText('Supporting Evidence & Sources')).toBeVisible()
  await expect(page.getByText('Scholarly').first()).toBeVisible()
  const toggle = page.getByRole('button', { name: /Show 1 weaker source/ })
  await expect(toggle).toBeVisible()
  await toggle.click()
  await expect(page.getByText('Weaker source').first()).toBeVisible()
})

test('shows the no-strong-sources state', async ({ page }) => {
  await stubRuns(page, 'none')
  await page.goto('/')
  await page.locator('input[type=search]').fill('zxqv blorpt')
  await page.locator('input[type=search]').press('Enter')
  await expect(page.getByText('The archives are quiet on this.')).toBeVisible()
})

test('history opens as a dialog and closes with Escape', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: /History/ }).click()
  const dialog = page.getByRole('dialog', { name: 'Research history' })
  await expect(dialog).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
})
