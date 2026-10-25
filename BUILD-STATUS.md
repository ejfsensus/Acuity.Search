# Acuity.Search — Build Status & Verification Report

**Date:** 25 October 2026  
**Product:** Acuity.Search (`1.0.0`)  
**Upstream Baseline:** `https://github.com/miurla/morphic` pinned at commit `011ce44d0edc446212e2aa823088f37f98383b76`  
**Branch:** `acuity-search`

---

## 1. Milestone Completion Matrix

| Milestone       | Scope                                                                                                                                                                                                                                                                                                                                                                                                                   | Status        |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| **Milestone 0** | Upstream baseline audit (`docs/UPSTREAM-AUDIT.md`), `.env.acuity.example`, privacy defaults (`FAVICON_PROVIDER_URL=off`, `MORPHIC_UPDATE_CHECK_DISABLED=true`), external SearXNG Docker Compose separation                                                                                                                                                                                                              | **Completed** |
| **Milestone 1** | Cohesive Acuity visual system (`#09090f` void, `#111118`/`#181820` surfaces, `#35313c` borders, `#d4a843`/`#e8c96a` gold, `#7c5ce0` violet, `#f4efe2` optional parchment surface), self-hosted fonts (`Cormorant Garamond`, `Inter`, `JetBrains Mono` + SIL licences), `public/acuity-mark.svg`, 3-pane desktop & 360px mobile workspace                                                                                | **Completed** |
| **Milestone 2** | 110-source / 10-group / 146-URL / 117-host seed registry (`config/acuity/domain-registry.seed.json`), CLI validator (`scripts/acuity-validate-registry.ts`), deterministic query planner, strict host/path scope engine, 4 provider adapters (`searxng`, `brave`, `tavily`, `exa`), RRF ranking, concurrency/budget enforcement, and scoped SHA-256 cache keys                                                          | **Completed** |
| **Milestone 3** | Literature mode work/edition cards & translator separation, SSRF/redirect/canonical-safe HTML/PDF/EPUB extraction (`lib/acuity/search/extract.ts`), SHA-256 Evidence Ledger & citation verifier (`lib/acuity/search/evidence.ts`), provider-neutral LLM synthesis with `results-only` fallback (`lib/acuity/prompts/index.ts`), and Markdown + `acuity.research-bundle.v1` JSON exporter (`lib/acuity/export/index.ts`) | **Completed** |
| **Milestone 4** | Drizzle/PostgreSQL schema (`lib/db/acuity-schema.ts`) & migration (`drizzle/0021_acuity_search_tables.sql`), multi-user ownership & HMAC-signed isolated guest session cookies (`lib/acuity/auth.ts`), actor-isolated run/share store (`lib/acuity/store.ts`), `/api/acuity-search/*` routes, consolidated `/api/advanced-search`, and `/share/[token]` unlisted selected-output snapshot page                          | **Completed** |
| **Milestone 5** | Full Vitest acceptance & unit test suite (all 12 fixtures in `config/acuity/acceptance-fixtures.json`), `typecheck`, `lint`, `format:check`, production `build`, documentation (`README.md`, `docs/ACUITY-SEARCH.md`, `BUILD-STATUS.md`), and restore-tested backup archive (`Acuity-Search-Backup-2026-10-25.zip`)                                                                                                     | **Completed** |

---

## 2. Automated Verification Results

| Check                         | Command                                                         | Result                                                                                                 |
| ----------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| **Domain Registry Integrity** | `bun scripts/acuity-validate-registry.ts`                       | **PASS** (110 entries, 10 groups, 146 URLs, 117 hosts, 20 starter-priority)                            |
| **TypeScript Typecheck**      | `bun run typecheck`                                             | **PASS** (`0` errors)                                                                                  |
| **ESLint & Import Sort**      | `bun run lint`                                                  | **PASS** (`0` errors, `0` warnings)                                                                    |
| **Prettier Formatting**       | `bun run format:check`                                          | **PASS** (All matched files use Prettier code style)                                                   |
| **Vitest Test Suite**         | `bun run test`                                                  | **PASS** (`154 passed`, `2 skipped` of `156` test files; `1,593 passed`, `3 skipped` of `1,596` tests) |
| **Acceptance Fixtures**       | `bun run test lib/acuity/__tests__/acceptance-fixtures.test.ts` | **PASS** (All 12 declarative scenarios in `config/acuity/acceptance-fixtures.json` verified)           |
| **Production Build**          | `bun run build`                                                 | **PASS** (Next.js 16.2.6 production build succeeded across all static & dynamic routes)                |

---

## 3. Epistemic Honesty: Fixture Verification vs. Live External Services

In accordance with Section 19 of the specification:

- **Verified Offline / Fixture-Backed:**
  - All 12 acceptance scenarios in `config/acuity/acceptance-fixtures.json` (`scope-host-lookalike`, `scope-path-segment`, `scope-redirect`, `searxng-all-time`, `provider-partial`, `literature-editions`, `cross-tradition`, `records-not-validation`, `scope-empty-vs-failure`, `prompt-injection`, `no-llm`, `private-share-export`) are executed and verified in `lib/acuity/__tests__/acceptance-fixtures.test.ts`.
  - Structural integrity of all 110 seed entries, 10 topic groups, 146 URLs, and 117 normalized hostnames in `config/acuity/domain-registry.seed.json` is verified offline by `scripts/acuity-validate-registry.ts`.
- **Requires Operator Runtime Credentials in Production:**
  - Live external queries to a deployed SearXNG instance (`SEARXNG_API_URL`), Brave Search (`BRAVE_SEARCH_API_KEY`), Tavily (`TAVILY_API_KEY`), Exa (`EXA_API_KEY`), optional LLM inference (`ACUITY_SEARCH_LLM_MODE`), and live PostgreSQL migration execution (`DATABASE_URL` via `bun migrate`) require operator-supplied credentials in `.env.local` and are not claimed as live-executed in this local build environment.
