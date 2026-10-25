# Acuity.Search — Architecture, Security & Operations Guide

## 1. Product Purpose & Epistemic Standard

**Acuity.Search** (`"Open enquiry. Wider sources. Traceable answers."`) is a standalone research application in the Acuity Institute ecosystem. It is designed for serious inquiry into spiritual traditions, esoteric literature, consciousness research, manuscript archives, public/FOIA records, and institutional governance.

### Epistemic Integrity Rules

1. **Untrusted Evidence Boundary:** Every retrieved search snippet and extracted document passage is treated strictly as untrusted data to be analyzed, never as system instructions.
2. **Six-Way Epistemic Distinction:** Synthesis explicitly distinguishes between:
   - What a primary text or author states
   - How a tradition interprets that text
   - What historical or declassified records establish (e.g., that an agency filed a document vs. whether every claim inside it is validated)
   - What empirical studies report
   - Disputed or minority hypotheses
   - Analytical synthesis connecting the sources
3. **No Silent Fabrication or Editorial Blacklisting:** Missing primary passages, metadata-only catalogue records, and un-OCR'd scans are disclosed honestly. No opaque domain blacklists (such as upstream's `instagram.com` cloud exclusion) are applied by default.

---

## 2. System Architecture

### 2.1 Discovery Modes & Controls

- **Modes (`DiscoveryMode`):**
  - `general` — Open multi-provider discovery.
  - `literature` — Edition-aware discovery preserving distinct translators and editions (e.g., Copenhaver vs. Mead translations of the _Corpus Hermeticum_) and classifying holdings (`HTML`, `PDF`, `EPUB`, `Catalogue`, `Scan`) and access (`open-access`, `access-unknown`, `login-required`, `metadata-only`).
  - `collections` — Strict domain-group discovery across the 110-source Acuity Domain Registry.
- **Depth (`ResearchDepth`):**
  - `quick` — Up to 8 provider search requests, 2 query variants, 4 full-text extractions, 12s initial / 60s total budget.
  - `research` — Up to 24 provider search requests, 6 query variants (including transliteration and archival expansions), 12 full-text extractions, 35s initial / 150s total budget.
- **Answer Preference (`AnswerPreference`):**
  - `answer-with-sources` — Synthesizes a cited overview when an LLM is configured, or falls back cleanly to `fallback-results-only` when `ACUITY_SEARCH_LLM_MODE=unconfigured` or when model output fails.
  - `results-only` — Deterministic evidence summary and full source/evidence ledger with zero LLM calls.

### 2.2 Strict Host, Path, Redirect & Canonical Scope Engine (`lib/acuity/search/scope.ts`)

- **Host Matching (`matchesHostScope`):** Normalizes hostnames with IDNA/punycode ASCII conversion (`domainToASCII`). Matches only the exact normalized hostname or its explicit `www.` alias when `includeWwwAlias: true`. Rejects lookalike domains (`gnosis.org.evil.test`, `evilgnosis.org`) and unconfigured subdomains (`sub.gnosis.org`).
- **Segment-Aware Path Matching (`matchesPathPrefix`):** Decodes percent-encoding up to twice and resolves dot-segments (`..`) before comparison so `/readingroom` matches `/readingroom` and `/readingroom/docs/a.pdf`, while rejecting `/readingroom-other/a.pdf`, `/jobs`, and `/readingroom/../jobs`.
- **Exclusions Override Inclusions:** Any excluded domain or path rule takes precedence over included targets. If exclusions remove every target in a `strict` scope, `validateStrictScopeReadiness` throws `StrictScopeValidationError` (HTTP 422) rather than widening to the open web.
- **Redirect & Canonical Verification (`lib/acuity/search/extract.ts`):** Every redirect hop (up to 5 hops) is checked against both `assertPublicUrl` (SSRF protection) and `evaluateUrlScope`. In `strict` mode, HTML `<link rel="canonical">` targets that escape the active scope are rejected.

### 2.3 Federated Provider Adapters (`lib/acuity/search/providers/`)

| Provider  | Endpoint                                         | Key Adaptations                                                                                                                                                                                                                                                                                                                                                                                     |
| --------- | ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `searxng` | External `${SEARXNG_API_URL}/search`             | Removes upstream's hard-coded 1-year filter, `safesearch=1`, and `google,bing` engine lock. Defaults to `safesearch=0` and all-time range. Passes optional gateway auth header (`ACUITY_SEARCH_SEARXNG_AUTH_HEADER` / `VALUE`) server-side only. Distinguishes HTTP 401/403 (`SEARXNG_JSON_DISABLED_OR_FORBIDDEN`), HTML bot challenges (`SEARXNG_NON_JSON_CHALLENGE`), and `unresponsive_engines`. |
| `brave`   | `https://api.search.brave.com/res/v1/web/search` | Caps `count` at 20 (`offset <= 9`), compiles `site:` and `-site:` query operators, and enforces host/path scope locally.                                                                                                                                                                                                                                                                            |
| `tavily`  | `https://api.tavily.com/search`                  | Sets `include_answers: false` and `include_images: false` by default, removes upstream's `instagram.com` exclusion, passes `include_domains`/`exclude_domains`, and enforces path prefixes locally.                                                                                                                                                                                                 |
| `exa`     | `https://api.exa.ai/search`                      | Requests structured `highlights` and `text`, maps `highlights: string[]` arrays cleanly, passes domain filters, and enforces path prefixes locally.                                                                                                                                                                                                                                                 |

### 2.4 Reciprocal Rank Fusion (RRF) & Citation Stability (`lib/acuity/search/rank.ts`)

- Candidate results are normalized via `normalizeResultUrl` (lowercasing scheme/host, stripping default ports, fragments, and `utm_*`/`fbclid`/`gclid` tracking parameters while preserving meaningful query strings).
- Identical normalized URLs merge into a single `SourceResult` with:
  $$\text{rrfScore}(d) = \sum_{p \in \text{Providers}(d)} \frac{1}{60 + \text{rank}_p(d)}$$
- Distinct URLs (including different translations or editions of the same work) are never collapsed.
- Citation labels (`S1`, `S2`, ...) are allocated monotonically and preserved across progressive updates and `Continue Research` passes.

---

## 3. API Routes

| Route                                   | Method          | Description                                                                                                                   |
| --------------------------------------- | --------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `/api/acuity-search/capabilities`       | `GET`           | Public runtime capabilities, provider readiness, LLM status, and privacy defaults (no secrets exposed).                       |
| `/api/acuity-search/collections`        | `GET`           | Returns the 10 thematic groups, 110 seed entries, cross-cutting tags, and filtered subsets.                                   |
| `/api/acuity-search/runs`               | `GET`, `POST`   | Lists the current actor's runs (`GET`) or executes a federated search run (`POST`, JSON or `text/event-stream` SSE).          |
| `/api/acuity-search/runs/[id]`          | `GET`           | Retrieves a specific search run owned by the current authenticated user or signed guest session.                              |
| `/api/acuity-search/runs/[id]/continue` | `POST`          | Continues a collection/research run across the next batch of unsearched targets while preserving `S1`, `S2` labels.           |
| `/api/acuity-search/runs/[id]/cancel`   | `POST`          | Aborts in-flight provider/extraction requests for the actor's run.                                                            |
| `/api/acuity-search/runs/[id]/export`   | `GET`           | Exports a run as Markdown (`?format=markdown`) or `acuity.research-bundle.v1` JSON (`?format=json` / `?format=codex-bundle`). |
| `/api/acuity-search/shares`             | `POST`          | Creates an unlisted, expiring, revocable selected-output share snapshot.                                                      |
| `/api/acuity-search/shares/[id]`        | `GET`, `DELETE` | Resolves a share snapshot by token or revokes a share owned by the current actor.                                             |
| `/api/acuity-search/admin/health`       | `GET`           | Operator diagnostics for registry integrity, provider readiness, and multi-user auth isolation.                               |

---

## 4. Future Acuity.Codex Bridge Contract (`acuity.research-bundle.v1`)

Acuity.Search exports self-contained `acuity.research-bundle.v1` JSON bundles (`lib/acuity/export/index.ts`) validated against `config/acuity/schemas/research-bundle.schema.json`.

- Every real export sets `exampleOnly: false` and includes a detached `integrity.manifestEntries` array with SHA-256 digests over `/queryRun`, `/sources`, `/evidence`, `/codexCandidates`, and `/answer`.
- `validateResearchBundleForImport(bundle)` verifies all evidence SHA-256 digests and rejects any bundle marked `exampleOnly: true` (such as `config/acuity/codex-bundle.example.json`).
