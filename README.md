<div align="center">

<img src="./public/acuity-mark.svg" alt="Acuity.Search Emblem" width="72" height="72" />

# Acuity.Search

**Open enquiry. Wider sources. Traceable answers.**

Acuity Institute’s federated research and archival discovery instrument for spirituality, esoteric traditions, consciousness studies, overlooked literature, historical archives, institutional records, and open inquiry.

</div>

---

## Overview

**Acuity.Search** is a standalone research product in the [Acuity Institute](https://acuity.institute) ecosystem, adapted from the open-source [Morphic](https://github.com/miurla/morphic) baseline (`011ce44d0edc446212e2aa823088f37f98383b76`, Apache-2.0).

Unlike single-provider AI search wrappers, Acuity.Search separates **source discovery**, **strict domain/path enforcement**, **verbatim evidence extraction**, and **optional model synthesis** so researchers can examine primary texts and archival records with complete provenance.

### Core Capabilities

- **Three Discovery Modes:**
  - **General:** Multi-provider open inquiry across independent web and scholarly indexes.
  - **Literature:** Edition-aware discovery for primary texts, translations, manuscripts, and archival holdings—keeping distinct translators and editions separate and distinguishing `fulltext-excerpt`, `snippet`, `catalogue-metadata`, `scan-no-text`, and `unavailable` states.
  - **Collections:** Strict domain-group discovery across the **110-source Acuity Seed Catalogue** (10 thematic groups, 146 URLs, 117 normalized hostnames, 20 starter-priority repositories) plus custom user include/exclude domain rules.
- **Four Federated Search Providers:**
  - **External SearXNG** (`safesearch=0` default, no artificial 1-year cutoff, no hard-coded Google/Bing engine restriction, server-side gateway header support, per-engine diagnostics)
  - **Brave Search** (`count <= 20` enforcement, compiled `site:` / `-site:` operators, local host/path verification)
  - **Tavily Search** (`include_answers: false`, `include_images: false` default, no opaque `instagram.com` editorial blacklist, local host/path verification)
  - **Exa** (`highlights` array extraction, native domain filters, local host/path verification)
- **Reciprocal Rank Fusion (RRF) & Transparent Ordering:**
  - Deduplicates identical normalized URLs across providers using $score(d) = \sum_{p \in P(d)} \frac{1}{60 + rank_p(d)}$ while retaining every provider's provenance, or switches to **Provider order** or **Newest**.
- **Works With or Without an LLM (`ACUITY_SEARCH_LLM_MODE=unconfigured`):**
  - Search, collection scoping, source inspection, Evidence Ledger verification, selected-output sharing, and Markdown / JSON bundle exports work out-of-the-box without any LLM key configured.
- **Immutable Evidence Ledger & Citation Verification:**
  - Bounded SSRF-guarded, redirect-verified, canonical-checked extraction produces SHA-256-hashed `EvidenceRecord` items and deterministically verifies `[S1]`, `[S2]` citations.
- **Selected-Output Share Snapshots & Codex Research Bundles:**
  - Replaces whole-chat public links with previewed, revocable, expiring snapshots of user-selected sources and evidence (`/share/[token]`), and exports `acuity.research-bundle.v1` JSON bundles with detached SHA-256 manifests.

---

## Quick Start

### 1. Install Dependencies

```bash
bun install --frozen-lockfile
```

### 2. Configure Environment

Copy `.env.acuity.example` to `.env.local`:

```bash
cp .env.acuity.example .env.local
```

Configure at least one search provider in `.env.local` (no LLM key is required to run search, inspect sources, or export bundles):

```dotenv
# External SearXNG instance (not bundled in production compose)
SEARXNG_API_URL=https://your-searxng-instance.org
SEARXNG_SAFESEARCH=0

# Optional commercial search providers
BRAVE_SEARCH_API_KEY=
TAVILY_API_KEY=
EXA_API_KEY=

# Provider-neutral LLM synthesis (defaults to unconfigured / results-only)
ACUITY_SEARCH_LLM_MODE=unconfigured
```

### 3. Validate the Domain Registry & Run Development Server

```bash
bun scripts/acuity-validate-registry.ts
bun dev
```

Open `http://localhost:3000`.

---

## Verification, Build & Backup Commands

```bash
# Validate the 110-source / 10-group / 146-URL / 117-host seed registry
bun scripts/acuity-validate-registry.ts

# TypeScript check
bun run typecheck

# ESLint check
bun run lint

# Prettier format check
bun run format:check

# Run full Vitest suite (unit, adapter, UI, and all 12 acceptance fixtures)
bun run test

# Production Next.js build
bun run build

# Generate and restore-test the standalone backup ZIP archive
python3 scripts/acuity-backup.py
```

---

## Documentation

- [Architecture & Operations Guide (`docs/ACUITY-SEARCH.md`)](./docs/ACUITY-SEARCH.md)
- [Upstream Baseline & Seam Audit (`docs/UPSTREAM-AUDIT.md`)](./docs/UPSTREAM-AUDIT.md)
- [Build Status & Verification Report (`BUILD-STATUS.md`)](./BUILD-STATUS.md)
- [Environment Template (`.env.acuity.example`)](./.env.acuity.example)

---

## Attribution & License

Acuity.Search is built upon the open-source [Morphic](https://github.com/miurla/morphic) project (Copyright © Morphic Contributors), licensed under the [Apache License 2.0](./LICENSE). Self-hosted typography (`Cormorant Garamond`, `Inter`, `JetBrains Mono`) is distributed under the SIL Open Font License 1.1 in [`public/fonts/`](./public/fonts/).
