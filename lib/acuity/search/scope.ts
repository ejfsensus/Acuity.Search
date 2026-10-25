import { domainToASCII } from 'node:url'

import type {
  CompiledScope,
  ScopeTargetRule
} from '@/lib/acuity/search/contracts'

const HOSTNAME_LABEL_RE =
  /^(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))+$/i

/**
 * Normalizes a hostname or URL host using IDNA/punycode ASCII conversion,
 * stripping trailing dots and rejecting credentials, ports, or IP literals
 * when used as domain rules.
 */
export function normalizeHostname(input: string): string | null {
  if (!input) return null
  const trimmed = input.trim()
  if (!trimmed || trimmed.length > 512) return null

  let candidate = trimmed
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) {
    try {
      const parsed = new URL(trimmed)
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return null
      }
      if (parsed.username || parsed.password) {
        return null
      }
      candidate = parsed.hostname
    } catch {
      return null
    }
  } else {
    // Reject credentials or port specifications on bare host inputs
    if (
      candidate.includes('@') ||
      candidate.includes(':') ||
      candidate.includes('/') ||
      candidate.includes('?') ||
      candidate.includes('#')
    ) {
      return null
    }
  }

  // Strip trailing dot
  candidate = candidate.replace(/\.+$/, '').toLowerCase()
  if (!candidate) return null

  const ascii = domainToASCII(candidate)
  if (!ascii) return null

  const normalized = ascii.toLowerCase()
  if (normalized.length > 253) return null
  // Reject IPv4 literals as domain registry rules
  if (/^\d+\.\d+\.\d+\.\d+$/.test(normalized)) return null
  if (!HOSTNAME_LABEL_RE.test(normalized)) return null

  return normalized
}

/**
 * Normalizes a path prefix safely, decoding percent-encoding and resolving
 * dot-segments so `/readingroom/../jobs` becomes `/jobs` and cannot bypass
 * prefix checks.
 */
export function normalizePathPrefix(rawPath: string): string {
  if (!rawPath || !rawPath.trim()) return '/'
  let pathStr = rawPath.trim()
  if (!pathStr.startsWith('/')) {
    pathStr = '/' + pathStr
  }

  // Decode up to twice to catch double-encoded traversal (%252e%252e)
  for (let i = 0; i < 2; i++) {
    try {
      const decoded = decodeURIComponent(pathStr)
      if (decoded === pathStr) break
      pathStr = decoded
    } catch {
      // Malformed percent encoding: reject by returning a sentinel that won't match valid paths
      return '/__invalid_percent_encoding__'
    }
  }

  // Reject null bytes or control characters
  if (/[\x00-\x1f]/.test(pathStr)) {
    return '/__invalid_control_char__'
  }

  // Collapse backslashes and duplicate slashes
  pathStr = pathStr.replace(/\\/g, '/').replace(/\/+/g, '/')

  const rawSegments = pathStr.split('/')
  const resolved: string[] = []
  for (const seg of rawSegments) {
    if (!seg || seg === '.') continue
    if (seg === '..') {
      resolved.pop()
      continue
    }
    resolved.push(seg)
  }

  if (resolved.length === 0) return '/'
  return '/' + resolved.join('/')
}

/**
 * Checks whether `candidateHost` matches `ruleHost`.
 * Exact hostname match, or explicit `www.` alias when `includeWwwAlias` is true.
 * Never allows arbitrary subdomains (`sub.gnosis.org` when `gnosis.org` is allowed)
 * or lookalike domains (`gnosis.org.evil.test`, `evilgnosis.org`).
 */
export function matchesHostScope(
  candidateHost: string,
  ruleHost: string,
  includeWwwAlias = true
): boolean {
  const normCandidate = normalizeHostname(candidateHost)
  const normRule = normalizeHostname(ruleHost)
  if (!normCandidate || !normRule) return false

  if (normCandidate === normRule) return true

  if (includeWwwAlias) {
    const bareCandidate = normCandidate.replace(/^www\./, '')
    const bareRule = normRule.replace(/^www\./, '')
    if (
      bareCandidate === bareRule &&
      (normCandidate === bareRule || normCandidate === `www.${bareRule}`) &&
      (normRule === bareRule || normRule === `www.${bareRule}`)
    ) {
      return true
    }
  }

  return false
}

/**
 * Segment-boundary-aware path prefix check.
 * `/readingroom` matches `/readingroom` and `/readingroom/docs/a.pdf`,
 * but rejects `/readingroom-other/a.pdf` and `/readingroom/../jobs`.
 */
export function matchesPathPrefix(
  candidateRawPath: string,
  allowedRawPrefix: string
): boolean {
  const normPrefix = normalizePathPrefix(allowedRawPrefix)
  if (normPrefix.startsWith('/__invalid_')) return false
  if (normPrefix === '/') {
    const normCandidate = normalizePathPrefix(candidateRawPath)
    return !normCandidate.startsWith('/__invalid_')
  }

  // Reject explicit dot-segment traversal attempts in candidate paths when matching non-root prefixes
  let decodedCandidate = candidateRawPath || '/'
  for (let i = 0; i < 2; i++) {
    try {
      decodedCandidate = decodeURIComponent(decodedCandidate)
    } catch {
      return false
    }
  }
  if (/(?:^|\/)\.\.(?:\/|$)/.test(decodedCandidate.replace(/\\/g, '/'))) {
    return false
  }

  const normCandidate = normalizePathPrefix(candidateRawPath)
  if (normCandidate.startsWith('/__invalid_')) return false

  if (normCandidate === normPrefix) return true
  return normCandidate.startsWith(normPrefix + '/')
}

export interface ScopeEvaluationResult {
  allowed: boolean
  lane: 'collection' | 'wider-web'
  reason: string
  matchedTarget?: ScopeTargetRule
}

export function evaluateUrlScope(
  rawUrl: string,
  scope: CompiledScope
): ScopeEvaluationResult {
  let parsed: URL
  try {
    parsed = new URL(rawUrl)
  } catch {
    return {
      allowed: false,
      lane: 'wider-web',
      reason: 'Invalid URL syntax'
    }
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return {
      allowed: false,
      lane: 'wider-web',
      reason: `Unsupported URL protocol: ${parsed.protocol}`
    }
  }

  if (parsed.username || parsed.password) {
    return {
      allowed: false,
      lane: 'wider-web',
      reason: 'URLs containing userinfo credentials are not permitted'
    }
  }

  const candidateHost = normalizeHostname(parsed.hostname)
  if (!candidateHost) {
    return {
      allowed: false,
      lane: 'wider-web',
      reason: 'URL hostname is not a valid public domain'
    }
  }

  const candidatePath = parsed.pathname || '/'

  // 1. Check host exclusions first (exclusions always override inclusions)
  for (const excludedHost of scope.excludeDomains) {
    if (matchesHostScope(candidateHost, excludedHost, true)) {
      return {
        allowed: false,
        lane: 'wider-web',
        reason: `Excluded by domain rule: ${excludedHost}`
      }
    }
  }

  // 2. Check path-level exclusions
  for (const excludedPathRule of scope.excludePathPrefixes) {
    if (
      matchesHostScope(candidateHost, excludedPathRule.hostname, true) &&
      matchesPathPrefix(candidatePath, excludedPathRule.pathPrefix)
    ) {
      return {
        allowed: false,
        lane: 'wider-web',
        reason: `Excluded by path rule: ${excludedPathRule.hostname}${excludedPathRule.pathPrefix}`
      }
    }
  }

  // 3. Check if URL matches any configured target in the scope
  for (const target of scope.targets) {
    if (
      matchesHostScope(candidateHost, target.hostname, target.includeWwwAlias)
    ) {
      const prefixes =
        target.allowedPathPrefixes.length > 0
          ? target.allowedPathPrefixes
          : ['/']
      const pathMatched = prefixes.some(prefix =>
        matchesPathPrefix(candidatePath, prefix)
      )
      if (pathMatched) {
        return {
          allowed: true,
          lane: 'collection',
          reason: `Matched target ${target.label} (${target.hostname})`,
          matchedTarget: target
        }
      }
    }
  }

  // 4. If no target matched:
  if (scope.policy === 'strict') {
    return {
      allowed: false,
      lane: 'wider-web',
      reason: `Outside strict collection scope (${candidateHost}${candidatePath})`
    }
  }

  return {
    allowed: true,
    lane: 'wider-web',
    reason: 'Allowed in open/wider-web lane'
  }
}

export function validateStrictScopeReadiness(
  scope: CompiledScope,
  hadRequestedInclusions: boolean
): { valid: boolean; error?: string } {
  if (scope.policy !== 'strict') {
    return { valid: true }
  }
  if (scope.targets.length === 0) {
    if (hadRequestedInclusions) {
      return {
        valid: false,
        error:
          'All selected collection or domain inclusions were removed by exclusion rules. Strict scope cannot widen to the open web.'
      }
    }
    return {
      valid: false,
      error:
        'Strict scope requires at least one selected collection, source entry, or included domain.'
    }
  }
  return { valid: true }
}
