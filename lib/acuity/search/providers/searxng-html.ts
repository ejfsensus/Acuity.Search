/**
 * Fallback parser for SearXNG's HTML results page (default "simple" theme).
 *
 * Used only when the instance refuses `format=json` (HTTP 403) — the common
 * misconfiguration where `search.formats` in settings.yml lists only `html`.
 * The simple theme renders each hit as:
 *
 *   <article class="result result-default category-general">
 *     <a href="https://example.org/x" class="url_header" ...>…</a>
 *     <h3><a href="https://example.org/x">Title</a></h3>
 *     <p class="content">Snippet…</p>
 *     <div class="engines"><span>brave</span><span>duckduckgo</span>…</div>
 *   </article>
 *
 * Parsing is deliberately conservative: anything that does not look like a
 * result article is ignored, and only absolute http(s) URLs are accepted.
 */
export interface SearxngHtmlResult {
  url: string
  title: string
  content: string
  engines: string[]
}

const ENTITY_MAP: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  '#39': "'",
  '#x27': "'"
}

export function decodeEntities(input: string): string {
  return input.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (m, code: string) => {
    const lower = code.toLowerCase()
    if (ENTITY_MAP[lower] !== undefined) return ENTITY_MAP[lower]
    if (lower.startsWith('#x')) {
      const n = parseInt(lower.slice(2), 16)
      return Number.isFinite(n) ? String.fromCodePoint(n) : m
    }
    if (lower.startsWith('#')) {
      const n = parseInt(lower.slice(1), 10)
      return Number.isFinite(n) ? String.fromCodePoint(n) : m
    }
    return m
  })
}

function stripTags(html: string): string {
  return decodeEntities(html.replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim()
}

export function parseSearxngHtmlResults(
  html: string,
  max = 20
): SearxngHtmlResult[] {
  const out: SearxngHtmlResult[] = []
  const seen = new Set<string>()
  const articleRe =
    /<article\b[^>]*class="[^"]*\bresult\b[^"]*"[^>]*>([\s\S]*?)<\/article>/gi
  let match: RegExpExecArray | null
  while ((match = articleRe.exec(html)) && out.length < max) {
    const body = match[1]
    const h3 = /<h3[^>]*>\s*<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i.exec(
      body
    )
    const anyLink = /<a\b[^>]*href="(https?:\/\/[^"]+)"/i.exec(body)
    const rawUrl = decodeEntities((h3?.[1] || anyLink?.[1] || '').trim())
    if (!/^https?:\/\//i.test(rawUrl)) continue
    if (seen.has(rawUrl)) continue
    const title = stripTags(h3?.[2] || '') || rawUrl
    const contentMatch = /<p\b[^>]*class="[^"]*\bcontent\b[^"]*"[^>]*>([\s\S]*?)<\/p>/i.exec(
      body
    )
    const enginesBlock = /<div\b[^>]*class="[^"]*\bengines\b[^"]*"[^>]*>([\s\S]*?)<\/div>/i.exec(
      body
    )
    const engines = enginesBlock
      ? Array.from(enginesBlock[1].matchAll(/<span[^>]*>([^<]+)<\/span>/gi))
          .map(m => stripTags(m[1]))
          .filter(Boolean)
      : []
    seen.add(rawUrl)
    out.push({
      url: rawUrl,
      title,
      content: contentMatch ? stripTags(contentMatch[1]) : '',
      engines
    })
  }
  return out
}
