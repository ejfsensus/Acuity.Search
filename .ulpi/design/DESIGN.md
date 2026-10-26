# Acuity.Search — locked design language

**Design Read:** a night library lit by one gold lamp — quiet, reverent, precise.
**Direction:** *Celestial Manuscript* — midnight void, sparing gold leaf, serif display, mono metadata.
**Register:** product (search instrument), dark only. Built on Tailwind v4 + existing shadcn tokens.

Counterfactual check: the generic generator default for "dark search tool" was slate + green CTA +
JetBrains/IBM Plex. Rejected — Acuity keeps its own void/gold/Cormorant identity.

## Tokens (`app/globals.css`, `--acuity-*`)
| Role | Token | Value | Notes |
|---|---|---|---|
| Page | `--acuity-void` | #09090f | 60% |
| Panels | `--acuity-surface` / `-2` | #111118 / #181820 | 30% |
| Hairlines | `--acuity-line` | #35313c | |
| Text | `--acuity-ink` | #fafafa | |
| Muted body | `--acuity-ink-muted` | #b3b0bd | ≥ 7:1 on void |
| Meta | `--acuity-ink-meta` | #a29db0 | ≥ 4.5:1 on surface-2, min 12px |
| Accent | `--acuity-gold` / `-hi` | #d4a843 / #e8c96a | ≤ 10%: primary action, citations, focus, progress arch |
| Caution | `--acuity-warn` | #d9a05b | weak-results, weaker-source badge |
| Reading | `--acuity-parchment` / `-ink` | #f3ead7 / #2a2218 | Parchment surface only |

## Type
Display Cormorant Garamond 40/32/24/20 · Body Inter 15–16/1.6 · Meta JetBrains Mono 12–13.
Minimum rendered size 12px. Parchment reading: Cormorant 19px / 1.7, measure 68ch.

## Space · radius · motion
Space 4·8·12·16·24·32·48·64. Radius 8 controls, 16 cards, 24 panels, full pills.
Motion 150ms micro · 250ms panels · 400ms reveals, `cubic-bezier(.2,.7,.2,1)`; all disabled under
`prefers-reduced-motion`.

## Interaction
Tap targets ≥ 44px (`min-h-11`). Focus: `2px solid --acuity-gold-hi`, offset 2px, on `:focus-visible`
(`.acuity-workspace` scope). Search box glows gold on `:focus-within`.

## Signature
The **gold arch hairline**: a 2px progress line that fills through five named stages —
Opening the archives → Searching sources → Reading pages → Composing → Verifying citations.

## Voice
Contemplative, plain, never alarmist. Errors are calm ("The archives are quiet on this.").
Never expose model names, provider error strings or infrastructure URLs to readers.

## Source-quality badges
Curated archive (solid gold) · Scholarly (gold outline) · Web (muted) · Weaker source (amber, hidden by default).
