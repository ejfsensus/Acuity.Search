import type {
  DiscoveryMode,
  ProviderId,
  ResearchDepth
} from '@/lib/acuity/search/contracts'

export type LlmMode =
  | 'unconfigured'
  | 'openai-compatible'
  | 'anthropic'
  | 'google'
  | 'openai'
  | 'ollama'

export interface ProviderConfigStatus {
  provider: ProviderId
  enabled: boolean
  configured: boolean
  status: 'ready' | 'unconfigured' | 'invalid-config'
  message: string
  endpointHost?: string
}

export interface AcuityRuntimeConfig {
  defaultMode: DiscoveryMode
  defaultDepth: ResearchDepth
  defaultProviders: ProviderId[]
  allowResultsOnly: boolean
  registrySeedPath: string
  registryPath: string
  searxng: {
    apiUrl: string | null
    safeSearch: 0 | 1 | 2
    defaultDepth: 'basic' | 'advanced'
    engines: string[]
    timeoutMs: number
    authHeader: string | null
    authValue: string | null
  }
  extraction: {
    maxBytes: number
    timeoutMs: number
    pdfMaxPages: number
  }
  llm: {
    mode: LlmMode
    configured: boolean
    baseUrl: string | null
    apiKeyPresent: boolean
    quickModel: string | null
    researchModel: string | null
    temperature: number
    maxOutputTokens: number
  }
  security: {
    faviconProviderUrl: string
    updateCheckDisabled: boolean
    fetchAllowPrivateNetwork: boolean
    publicMultiUser: boolean
    shareDefaultExpiryDays: number
    guestCookieSecret: string
  }
  codexBridge: {
    enabled: boolean
    schemaVersion: string
  }
}

const PLACEHOLDER_PATTERNS = [
  /^\[?your[_-]/i,
  /^replace[_-]me/i,
  /^changeme/i,
  /^xxx+$/i,
  /search-instance\.example/i,
  /example\.com/i,
  /example\.org/i,
  /example\.net/i,
  /<your/i
]

export function isPlaceholderValue(value: string | undefined | null): boolean {
  if (!value) return true
  const trimmed = value.trim()
  if (!trimmed) return true
  return PLACEHOLDER_PATTERNS.some(pattern => pattern.test(trimmed))
}

export function validateSearxngUrl(rawUrl: string | undefined): {
  valid: boolean
  normalizedUrl: string | null
  reason: string
  host?: string
} {
  if (!rawUrl || !rawUrl.trim()) {
    return {
      valid: false,
      normalizedUrl: null,
      reason:
        'SEARXNG_API_URL is not set. Configure an external SearXNG instance URL.'
    }
  }

  const trimmed = rawUrl.trim()
  if (isPlaceholderValue(trimmed)) {
    return {
      valid: false,
      normalizedUrl: null,
      reason: `SEARXNG_API_URL ("${trimmed}") is a placeholder URL. Set a real external SearXNG origin.`
    }
  }

  try {
    const parsed = new URL(trimmed)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return {
        valid: false,
        normalizedUrl: null,
        reason: `SEARXNG_API_URL must use http: or https: (got "${parsed.protocol}").`
      }
    }
    const normalized = parsed.origin + parsed.pathname.replace(/\/+$/, '')
    return {
      valid: true,
      normalizedUrl: normalized,
      reason: 'External SearXNG URL configured.',
      host: parsed.host
    }
  } catch {
    return {
      valid: false,
      normalizedUrl: null,
      reason: `SEARXNG_API_URL ("${trimmed}") is not a valid URL.`
    }
  }
}

function parseDefaultProviders(raw: string | undefined): ProviderId[] {
  if (!raw || !raw.trim()) {
    return ['searxng', 'brave', 'tavily', 'exa']
  }
  const allowed = new Set<ProviderId>(['searxng', 'brave', 'tavily', 'exa'])
  const parsed = raw
    .split(',')
    .map(s => s.trim().toLowerCase() as ProviderId)
    .filter(s => allowed.has(s))

  return parsed.length > 0 ? parsed : ['searxng', 'brave', 'tavily', 'exa']
}

function resolveLlmConfig(
  env: Record<string, string | undefined>
): AcuityRuntimeConfig['llm'] {
  const rawMode = (env.ACUITY_SEARCH_LLM_MODE || '').trim().toLowerCase()
  const temperature = Number.isFinite(Number(env.ACUITY_SEARCH_LLM_TEMPERATURE))
    ? Math.max(0, Math.min(2, Number(env.ACUITY_SEARCH_LLM_TEMPERATURE)))
    : 0.2
  const maxOutputTokens = Number.isFinite(
    Number(env.ACUITY_SEARCH_LLM_MAX_OUTPUT_TOKENS)
  )
    ? Math.max(256, Math.trunc(Number(env.ACUITY_SEARCH_LLM_MAX_OUTPUT_TOKENS)))
    : 2000

  const quickModel = env.ACUITY_SEARCH_LLM_QUICK_MODEL?.trim() || null
  const researchModel = env.ACUITY_SEARCH_LLM_RESEARCH_MODEL?.trim() || null
  const baseUrl =
    env.ACUITY_SEARCH_LLM_BASE_URL?.trim() ||
    env.OPENAI_COMPATIBLE_API_BASE_URL?.trim() ||
    env.OLLAMA_BASE_URL?.trim() ||
    null

  if (rawMode === 'unconfigured') {
    return {
      mode: 'unconfigured',
      configured: false,
      baseUrl,
      apiKeyPresent: false,
      quickModel,
      researchModel,
      temperature,
      maxOutputTokens
    }
  }

  let mode: LlmMode = 'unconfigured'
  let apiKeyPresent = false

  if (rawMode === 'openai-compatible') {
    mode = 'openai-compatible'
    apiKeyPresent =
      !isPlaceholderValue(env.ACUITY_SEARCH_LLM_API_KEY) ||
      !isPlaceholderValue(env.OPENAI_COMPATIBLE_API_KEY)
  } else if (rawMode === 'anthropic') {
    mode = 'anthropic'
    apiKeyPresent =
      !isPlaceholderValue(env.ACUITY_SEARCH_LLM_API_KEY) ||
      !isPlaceholderValue(env.ANTHROPIC_API_KEY)
  } else if (rawMode === 'google') {
    mode = 'google'
    apiKeyPresent =
      !isPlaceholderValue(env.ACUITY_SEARCH_LLM_API_KEY) ||
      !isPlaceholderValue(env.GOOGLE_GENERATIVE_AI_API_KEY)
  } else if (rawMode === 'openai') {
    mode = 'openai'
    apiKeyPresent =
      !isPlaceholderValue(env.ACUITY_SEARCH_LLM_API_KEY) ||
      !isPlaceholderValue(env.OPENAI_API_KEY)
  } else if (rawMode === 'ollama') {
    mode = 'ollama'
    apiKeyPresent = !isPlaceholderValue(baseUrl)
  } else {
    // Auto-detect from standard keys only if ACUITY_SEARCH_LLM_MODE was not explicitly set to 'unconfigured'
    if (!isPlaceholderValue(env.ANTHROPIC_API_KEY)) {
      mode = 'anthropic'
      apiKeyPresent = true
    } else if (!isPlaceholderValue(env.OPENAI_API_KEY)) {
      mode = 'openai'
      apiKeyPresent = true
    } else if (!isPlaceholderValue(env.GOOGLE_GENERATIVE_AI_API_KEY)) {
      mode = 'google'
      apiKeyPresent = true
    } else if (
      !isPlaceholderValue(env.OPENAI_COMPATIBLE_API_KEY) &&
      !isPlaceholderValue(env.OPENAI_COMPATIBLE_API_BASE_URL)
    ) {
      mode = 'openai-compatible'
      apiKeyPresent = true
    } else if (!isPlaceholderValue(env.OLLAMA_BASE_URL)) {
      mode = 'ollama'
      apiKeyPresent = true
    }
  }

  const configured =
    mode !== 'unconfigured' &&
    apiKeyPresent &&
    (mode !== 'openai-compatible' || !isPlaceholderValue(baseUrl))

  return {
    mode: configured ? mode : 'unconfigured',
    configured,
    baseUrl,
    apiKeyPresent,
    quickModel,
    researchModel,
    temperature,
    maxOutputTokens
  }
}

export function getAcuityConfig(
  env: Record<string, string | undefined> = process.env
): AcuityRuntimeConfig {
  const searxValidation = validateSearxngUrl(env.SEARXNG_API_URL)
  const rawSafeSearch = Number(env.SEARXNG_SAFESEARCH ?? 0)
  const safeSearch: 0 | 1 | 2 =
    rawSafeSearch === 1 || rawSafeSearch === 2 ? rawSafeSearch : 0

  const engines = (env.SEARXNG_ENGINES || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)

  const defaultModeRaw = (env.ACUITY_SEARCH_DEFAULT_MODE || 'general')
    .trim()
    .toLowerCase()
  const defaultMode: DiscoveryMode =
    defaultModeRaw === 'literature' || defaultModeRaw === 'collections'
      ? defaultModeRaw
      : 'general'

  const defaultDepthRaw = (env.ACUITY_SEARCH_DEFAULT_DEPTH || 'quick')
    .trim()
    .toLowerCase()
  const defaultDepth: ResearchDepth =
    defaultDepthRaw === 'research' ? 'research' : 'quick'

  return {
    defaultMode,
    defaultDepth,
    defaultProviders: parseDefaultProviders(
      env.ACUITY_SEARCH_DEFAULT_PROVIDERS
    ),
    allowResultsOnly: env.ACUITY_SEARCH_ALLOW_RESULTS_ONLY !== 'false',
    registrySeedPath:
      env.ACUITY_SEARCH_REGISTRY_SEED_PATH?.trim() ||
      'config/acuity/domain-registry.seed.json',
    registryPath:
      env.ACUITY_SEARCH_REGISTRY_PATH?.trim() ||
      'config/acuity/domain-registry.json',
    searxng: {
      apiUrl: searxValidation.normalizedUrl,
      safeSearch,
      defaultDepth:
        env.SEARXNG_DEFAULT_DEPTH === 'advanced' ? 'advanced' : 'basic',
      engines,
      timeoutMs: Math.max(
        1000,
        Number(env.ACUITY_SEARCH_SEARXNG_TIMEOUT_MS) || 8000
      ),
      authHeader: env.ACUITY_SEARCH_SEARXNG_AUTH_HEADER?.trim() || null,
      authValue: env.ACUITY_SEARCH_SEARXNG_AUTH_VALUE?.trim() || null
    },
    extraction: {
      maxBytes: Math.max(
        65536,
        Number(env.ACUITY_SEARCH_EXTRACTION_MAX_BYTES) || 10 * 1024 * 1024
      ),
      timeoutMs: Math.max(
        1000,
        Number(env.ACUITY_SEARCH_EXTRACTION_TIMEOUT_MS) || 10000
      ),
      pdfMaxPages: Math.max(1, Number(env.ACUITY_SEARCH_PDF_MAX_PAGES) || 40)
    },
    llm: resolveLlmConfig(env),
    security: {
      faviconProviderUrl: env.FAVICON_PROVIDER_URL?.trim() || 'off',
      updateCheckDisabled: env.MORPHIC_UPDATE_CHECK_DISABLED !== 'false',
      fetchAllowPrivateNetwork: env.FETCH_ALLOW_PRIVATE_NETWORK === 'true',
      publicMultiUser: env.ACUITY_SEARCH_PUBLIC_MULTI_USER === 'true',
      shareDefaultExpiryDays: Math.max(
        1,
        Number(env.ACUITY_SEARCH_SHARE_DEFAULT_EXPIRY_DAYS) || 30
      ),
      guestCookieSecret:
        env.ACUITY_SEARCH_GUEST_COOKIE_SECRET?.trim() ||
        env.BETTER_AUTH_SECRET?.trim() ||
        'acuity-search-local-guest-cookie-secret'
    },
    codexBridge: {
      enabled: env.ACUITY_CODEX_BRIDGE_ENABLED === 'true',
      schemaVersion:
        env.ACUITY_CODEX_EXPORT_SCHEMA_VERSION?.trim() ||
        'acuity.research-bundle.v1'
    }
  }
}

export function getProviderStatuses(
  env: Record<string, string | undefined> = process.env
): Record<ProviderId, ProviderConfigStatus> {
  const searxValidation = validateSearxngUrl(env.SEARXNG_API_URL)
  const rawSearx = env.SEARXNG_API_URL?.trim()

  const braveKey = env.BRAVE_SEARCH_API_KEY?.trim()
  const tavilyKey = env.TAVILY_API_KEY?.trim()
  const exaKey = env.EXA_API_KEY?.trim()

  return {
    searxng: {
      provider: 'searxng',
      enabled: true,
      configured: searxValidation.valid,
      status: searxValidation.valid
        ? 'ready'
        : rawSearx
          ? 'invalid-config'
          : 'unconfigured',
      message: searxValidation.reason,
      endpointHost: searxValidation.host
    },
    brave: {
      provider: 'brave',
      enabled: true,
      configured: !isPlaceholderValue(braveKey),
      status: !isPlaceholderValue(braveKey)
        ? 'ready'
        : braveKey
          ? 'invalid-config'
          : 'unconfigured',
      message: !isPlaceholderValue(braveKey)
        ? 'Brave Search API key configured.'
        : 'BRAVE_SEARCH_API_KEY is not configured.'
    },
    tavily: {
      provider: 'tavily',
      enabled: true,
      configured: !isPlaceholderValue(tavilyKey),
      status: !isPlaceholderValue(tavilyKey)
        ? 'ready'
        : tavilyKey
          ? 'invalid-config'
          : 'unconfigured',
      message: !isPlaceholderValue(tavilyKey)
        ? 'Tavily Search API key configured.'
        : 'TAVILY_API_KEY is not configured.'
    },
    exa: {
      provider: 'exa',
      enabled: true,
      configured: !isPlaceholderValue(exaKey),
      status: !isPlaceholderValue(exaKey)
        ? 'ready'
        : exaKey
          ? 'invalid-config'
          : 'unconfigured',
      message: !isPlaceholderValue(exaKey)
        ? 'Exa API key configured.'
        : 'EXA_API_KEY is not configured.'
    }
  }
}
