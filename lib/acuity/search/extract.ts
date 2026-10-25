import { getAcuityConfig } from '@/lib/acuity/config'
import type {
  AccessStatus,
  CompiledScope,
  ContentState,
  EvidenceLocator
} from '@/lib/acuity/search/contracts'
import { evaluateUrlScope } from '@/lib/acuity/search/scope'
import { assertPublicUrl, safeFetch } from '@/lib/utils/safe-fetch'

const MAX_REDIRECT_HOPS = 5
const REDIRECT_STATUS_CODES = new Set([301, 302, 303, 307, 308])

export interface ExtractionOutput {
  ok: boolean
  sourceUrl: string
  finalUrl: string
  canonicalUrl?: string
  redirectChain: string[]
  mimeType: string
  byteLength: number
  title: string
  verbatimText: string
  contentState: ContentState
  accessStatus: AccessStatus
  locator: EvidenceLocator
  errorReason?: string
}

function extractCanonicalHref(
  html: string,
  baseUrl: string
): string | undefined {
  const linkMatch =
    html.match(
      /<link[^>]+rel\s*=\s*["']canonical["'][^>]+href\s*=\s*["']([^"']+)["'][^>]*>/i
    ) ??
    html.match(
      /<link[^>]+href\s*=\s*["']([^"']+)["'][^>]+rel\s*=\s*["']canonical["'][^>]*>/i
    )
  if (!linkMatch?.[1]) return undefined
  try {
    return new URL(linkMatch[1].trim(), baseUrl).toString()
  } catch {
    return undefined
  }
}

function detectLoginOrPaywall(html: string, status: number): boolean {
  if (status === 401 || status === 402 || status === 403) return true
  const lower = html.slice(0, 8000).toLowerCase()
  return (
    lower.includes('institutional login required') ||
    lower.includes('sign in to access full text') ||
    lower.includes('purchase this article') ||
    lower.includes('subscribe to read the full')
  )
}

function extractHtmlReadablePassage(html: string): {
  title: string
  firstHeading?: string
  text: string
} {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
  const title = titleMatch?.[1]?.replace(/\s+/g, ' ').trim() || ''

  const headingMatch = html.match(/<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/i)
  const firstHeading = headingMatch?.[1]
    ?.replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim()

  const cleaned = html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[^>]*>[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, ' ')
    .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim()

  return { title, firstHeading, text: cleaned }
}

/**
 * Extracts bounded readable ASCII/UTF-8 text streams from a PDF buffer without
 * inventing page numbers unless explicit `/Type /Page` markers are present.
 */
function extractBasicPdfText(
  buffer: Uint8Array,
  maxPages: number
): {
  text: string
  detectedPages: number
  hasExtractableText: boolean
} {
  const rawLatin1 = Buffer.from(buffer).toString('latin1')
  const pageMatches = rawLatin1.match(/\/Type\s*\/Page\b/g)
  const detectedPages = pageMatches ? pageMatches.length : 0

  // Extract literal strings inside parentheses (...) within BT ... ET text blocks
  const textBlocks: string[] = []
  const btEtRegex = /BT[\s\S]{1,20000}?ET/g
  let blockMatch: RegExpExecArray | null
  let blockCount = 0

  while (
    (blockMatch = btEtRegex.exec(rawLatin1)) !== null &&
    blockCount < maxPages * 20
  ) {
    blockCount += 1
    const block = blockMatch[0]
    const literalRegex = /\(([^()\\]*(?:\\.[^()\\]*)*)\)/g
    let lit: RegExpExecArray | null
    while ((lit = literalRegex.exec(block)) !== null) {
      const piece = lit[1]
        .replace(/\\n/g, ' ')
        .replace(/\\r/g, ' ')
        .replace(/\\t/g, ' ')
        .replace(/\\\(/g, '(')
        .replace(/\\\)/g, ')')
        .replace(/\\\\/g, '\\')
      if (/[A-Za-z0-9]{2,}/.test(piece)) {
        textBlocks.push(piece)
      }
    }
  }

  const joined = textBlocks.join(' ').replace(/\s+/g, ' ').trim()
  return {
    text: joined.slice(0, 6000),
    detectedPages,
    hasExtractableText: joined.length >= 40
  }
}

async function readBoundedBytes(
  response: Response,
  maxBytes: number
): Promise<{ bytes: Uint8Array; exceeded: boolean }> {
  const contentLength = Number(response.headers.get('content-length'))
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    await response.body?.cancel().catch(() => {})
    return { bytes: new Uint8Array(0), exceeded: true }
  }

  const reader = response.body?.getReader()
  if (!reader) {
    return { bytes: new Uint8Array(0), exceeded: false }
  }

  const chunks: Uint8Array[] = []
  let total = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > maxBytes) {
      await reader.cancel().catch(() => {})
      return { bytes: new Uint8Array(0), exceeded: true }
    }
    chunks.push(value)
  }

  const combined = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    combined.set(chunk, offset)
    offset += chunk.byteLength
  }
  return { bytes: combined, exceeded: false }
}

/**
 * Performs SSRF-guarded, redirect-verified, scope-enforced content extraction.
 * - Verifies initial URL and every redirect hop against `assertPublicUrl` and `evaluateUrlScope`.
 * - Verifies HTML `<link rel="canonical">` against `evaluateUrlScope` so an in-scope
 *   URL cannot attribute out-of-scope canonical content in strict mode.
 */
export async function extractSourceEvidence(options: {
  url: string
  scope: CompiledScope
  fallbackTitle?: string
  fallbackSnippet?: string
  signal?: AbortSignal
  fetchImpl?: (url: string, init?: RequestInit) => Promise<Response>
}): Promise<ExtractionOutput> {
  const config = getAcuityConfig()
  const redirectChain: string[] = [options.url]
  let currentUrl = options.url

  // 1. Validate initial URL scope & SSRF
  const initialScope = evaluateUrlScope(currentUrl, options.scope)
  if (!initialScope.allowed) {
    return {
      ok: false,
      sourceUrl: options.url,
      finalUrl: currentUrl,
      redirectChain,
      mimeType: 'text/plain',
      byteLength: 0,
      title: options.fallbackTitle || options.url,
      verbatimText: '',
      contentState: 'unavailable',
      accessStatus: 'access-unknown',
      locator: { type: 'char-offset', value: '0..0', charStart: 0, charEnd: 0 },
      errorReason: `Initial URL rejected by scope policy: ${initialScope.reason}`
    }
  }

  const timeoutSignal = AbortSignal.timeout(config.extraction.timeoutMs)
  const combinedSignal = options.signal
    ? AbortSignal.any([options.signal, timeoutSignal])
    : timeoutSignal

  let response: Response | null = null

  try {
    for (let hop = 0; hop <= MAX_REDIRECT_HOPS; hop++) {
      assertPublicUrl(currentUrl)
      const hopScope = evaluateUrlScope(currentUrl, options.scope)
      if (!hopScope.allowed) {
        return {
          ok: false,
          sourceUrl: options.url,
          finalUrl: currentUrl,
          redirectChain,
          mimeType: 'text/plain',
          byteLength: 0,
          title: options.fallbackTitle || options.url,
          verbatimText: '',
          contentState: 'unavailable',
          accessStatus: 'access-unknown',
          locator: {
            type: 'char-offset',
            value: '0..0',
            charStart: 0,
            charEnd: 0
          },
          errorReason: `Redirect destination rejected by scope policy: ${hopScope.reason}`
        }
      }

      if (options.fetchImpl) {
        response = await options.fetchImpl(currentUrl, {
          redirect: 'manual',
          signal: combinedSignal,
          headers: {
            'User-Agent': 'Acuity.Search/1.0 (+https://acuity.institute)',
            Accept:
              'text/html,application/xhtml+xml,application/pdf,application/epub+zip,text/plain;q=0.9,*/*;q=0.5'
          }
        })
      } else {
        // Use safeFetch for SSRF connect-time lookup protection
        response = await safeFetch(currentUrl, {
          signal: combinedSignal,
          headers: {
            'User-Agent': 'Acuity.Search/1.0 (+https://acuity.institute)',
            Accept:
              'text/html,application/xhtml+xml,application/pdf,application/epub+zip,text/plain;q=0.9,*/*;q=0.5'
          }
        })
        break
      }

      const location = response.headers.get('location')
      if (REDIRECT_STATUS_CODES.has(response.status) && location) {
        await response.body?.cancel().catch(() => {})
        const nextUrl = new URL(location, currentUrl).toString()
        redirectChain.push(nextUrl)
        currentUrl = nextUrl
        if (hop === MAX_REDIRECT_HOPS) {
          throw new Error(
            `Exceeded maximum redirect hops (${MAX_REDIRECT_HOPS})`
          )
        }
        continue
      }
      break
    }

    if (!response) {
      throw new Error('No response received during extraction')
    }

    // Final URL scope check (in case safeFetch followed redirects internally)
    if (response.url && response.url !== currentUrl) {
      redirectChain.push(response.url)
      currentUrl = response.url
      const finalScope = evaluateUrlScope(currentUrl, options.scope)
      if (!finalScope.allowed) {
        await response.body?.cancel().catch(() => {})
        return {
          ok: false,
          sourceUrl: options.url,
          finalUrl: currentUrl,
          redirectChain,
          mimeType: 'text/plain',
          byteLength: 0,
          title: options.fallbackTitle || options.url,
          verbatimText: '',
          contentState: 'unavailable',
          accessStatus: 'access-unknown',
          locator: {
            type: 'char-offset',
            value: '0..0',
            charStart: 0,
            charEnd: 0
          },
          errorReason: `Final redirect URL outside strict scope: ${finalScope.reason}`
        }
      }
    }

    if (response.status === 401 || response.status === 403) {
      await response.body?.cancel().catch(() => {})
      return {
        ok: false,
        sourceUrl: options.url,
        finalUrl: currentUrl,
        redirectChain,
        mimeType: 'text/plain',
        byteLength: 0,
        title: options.fallbackTitle || currentUrl,
        verbatimText: options.fallbackSnippet || '',
        contentState: options.fallbackSnippet ? 'snippet' : 'unavailable',
        accessStatus: 'login-required',
        locator: {
          type: 'char-offset',
          value: '0..0',
          charStart: 0,
          charEnd: 0
        },
        errorReason: `HTTP ${response.status} (Login or institutional access required)`
      }
    }

    if (!response.ok) {
      await response.body?.cancel().catch(() => {})
      return {
        ok: false,
        sourceUrl: options.url,
        finalUrl: currentUrl,
        redirectChain,
        mimeType: 'text/plain',
        byteLength: 0,
        title: options.fallbackTitle || currentUrl,
        verbatimText: options.fallbackSnippet || '',
        contentState: options.fallbackSnippet ? 'snippet' : 'unavailable',
        accessStatus: 'access-unknown',
        locator: {
          type: 'char-offset',
          value: '0..0',
          charStart: 0,
          charEnd: 0
        },
        errorReason: `HTTP ${response.status}`
      }
    }

    const contentType = (response.headers.get('content-type') || '')
      .split(';')[0]
      .trim()
      .toLowerCase()

    const { bytes, exceeded } = await readBoundedBytes(
      response,
      config.extraction.maxBytes
    )
    if (exceeded) {
      return {
        ok: false,
        sourceUrl: options.url,
        finalUrl: currentUrl,
        redirectChain,
        mimeType: contentType || 'application/octet-stream',
        byteLength: config.extraction.maxBytes,
        title: options.fallbackTitle || currentUrl,
        verbatimText: options.fallbackSnippet || '',
        contentState: options.fallbackSnippet ? 'snippet' : 'unavailable',
        accessStatus: 'open-access',
        locator: {
          type: 'char-offset',
          value: '0..0',
          charStart: 0,
          charEnd: 0
        },
        errorReason: `Response exceeded extraction size limit (${config.extraction.maxBytes} bytes)`
      }
    }

    // Handle PDF
    if (
      contentType === 'application/pdf' ||
      currentUrl.toLowerCase().endsWith('.pdf')
    ) {
      const pdfResult = extractBasicPdfText(
        bytes,
        config.extraction.pdfMaxPages
      )
      if (!pdfResult.hasExtractableText) {
        return {
          ok: true,
          sourceUrl: options.url,
          finalUrl: currentUrl,
          redirectChain,
          mimeType: 'application/pdf',
          byteLength: bytes.byteLength,
          title: options.fallbackTitle || currentUrl,
          verbatimText:
            options.fallbackSnippet ||
            '[Scanned PDF document — OCR text layer unavailable]',
          contentState: 'scan-no-text',
          accessStatus: 'open-access',
          locator: {
            type: 'char-offset',
            value: 'scan-no-text'
          }
        }
      }

      const excerpt = pdfResult.text.slice(0, 3000)
      return {
        ok: true,
        sourceUrl: options.url,
        finalUrl: currentUrl,
        redirectChain,
        mimeType: 'application/pdf',
        byteLength: bytes.byteLength,
        title: options.fallbackTitle || currentUrl,
        verbatimText: excerpt,
        contentState: 'fulltext-excerpt',
        accessStatus: 'open-access',
        // Only record a PDF page locator when page markers were genuinely detected
        locator:
          pdfResult.detectedPages > 0
            ? {
                type: 'pdf-page',
                value: `p. 1 (of ${pdfResult.detectedPages})`,
                pageNumber: 1
              }
            : {
                type: 'char-offset',
                value: `0..${excerpt.length}`,
                charStart: 0,
                charEnd: excerpt.length
              }
      }
    }

    // Handle EPUB
    if (
      contentType === 'application/epub+zip' ||
      currentUrl.toLowerCase().endsWith('.epub')
    ) {
      return {
        ok: true,
        sourceUrl: options.url,
        finalUrl: currentUrl,
        redirectChain,
        mimeType: 'application/epub+zip',
        byteLength: bytes.byteLength,
        title: options.fallbackTitle || currentUrl,
        verbatimText:
          options.fallbackSnippet || 'EPUB edition available for download.',
        contentState: options.fallbackSnippet
          ? 'snippet'
          : 'catalogue-metadata',
        accessStatus: 'open-access',
        locator: {
          type: 'epub-chapter',
          value: 'epub-container'
        }
      }
    }

    // Default HTML / plain text extraction
    const textBody = new TextDecoder('utf-8', { fatal: false }).decode(bytes)
    const canonicalUrl = extractCanonicalHref(textBody, currentUrl)

    // Verify canonical URL against strict scope
    if (canonicalUrl && options.scope.policy === 'strict') {
      const canonicalScope = evaluateUrlScope(canonicalUrl, options.scope)
      if (!canonicalScope.allowed) {
        return {
          ok: false,
          sourceUrl: options.url,
          finalUrl: currentUrl,
          canonicalUrl,
          redirectChain,
          mimeType: contentType || 'text/html',
          byteLength: bytes.byteLength,
          title: options.fallbackTitle || currentUrl,
          verbatimText: '',
          contentState: 'unavailable',
          accessStatus: 'access-unknown',
          locator: {
            type: 'char-offset',
            value: '0..0',
            charStart: 0,
            charEnd: 0
          },
          errorReason: `Canonical URL (${canonicalUrl}) escapes strict collection scope`
        }
      }
    }

    if (detectLoginOrPaywall(textBody, response.status)) {
      return {
        ok: true,
        sourceUrl: options.url,
        finalUrl: currentUrl,
        canonicalUrl,
        redirectChain,
        mimeType: contentType || 'text/html',
        byteLength: bytes.byteLength,
        title: options.fallbackTitle || currentUrl,
        verbatimText: options.fallbackSnippet || '',
        contentState: options.fallbackSnippet
          ? 'snippet'
          : 'catalogue-metadata',
        accessStatus: 'login-required',
        locator: {
          type: 'char-offset',
          value: '0..0',
          charStart: 0,
          charEnd: 0
        }
      }
    }

    const parsedHtml = extractHtmlReadablePassage(textBody)
    const excerpt = parsedHtml.text.slice(0, 3500)
    const title =
      parsedHtml.title || options.fallbackTitle || new URL(currentUrl).hostname

    if (excerpt.length < 60) {
      return {
        ok: true,
        sourceUrl: options.url,
        finalUrl: currentUrl,
        canonicalUrl,
        redirectChain,
        mimeType: contentType || 'text/html',
        byteLength: bytes.byteLength,
        title,
        verbatimText: options.fallbackSnippet || excerpt,
        contentState: 'catalogue-metadata',
        accessStatus: 'metadata-only',
        locator: {
          type: 'char-offset',
          value: `0..${(options.fallbackSnippet || excerpt).length}`,
          charStart: 0,
          charEnd: (options.fallbackSnippet || excerpt).length
        }
      }
    }

    return {
      ok: true,
      sourceUrl: options.url,
      finalUrl: currentUrl,
      canonicalUrl,
      redirectChain,
      mimeType: contentType || 'text/html',
      byteLength: bytes.byteLength,
      title,
      verbatimText: excerpt,
      contentState: 'fulltext-excerpt',
      accessStatus: 'open-access',
      locator: parsedHtml.firstHeading
        ? {
            type: 'css-heading',
            value: parsedHtml.firstHeading.slice(0, 120)
          }
        : {
            type: 'char-offset',
            value: `0..${excerpt.length}`,
            charStart: 0,
            charEnd: excerpt.length
          }
    }
  } catch (error) {
    return {
      ok: false,
      sourceUrl: options.url,
      finalUrl: currentUrl,
      redirectChain,
      mimeType: 'text/plain',
      byteLength: 0,
      title: options.fallbackTitle || options.url,
      verbatimText: options.fallbackSnippet || '',
      contentState: options.fallbackSnippet ? 'snippet' : 'unavailable',
      accessStatus: 'access-unknown',
      locator: {
        type: 'char-offset',
        value: '0..0',
        charStart: 0,
        charEnd: 0
      },
      errorReason:
        error instanceof Error ? error.message : 'Extraction request failed'
    }
  }
}
