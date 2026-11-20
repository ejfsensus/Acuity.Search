/** Member-facing messages for provider failures. Never include keys or raw provider bodies. */
export class ByokKeyRequiredError extends Error {
  readonly code = 'BYOK_KEY_REQUIRED'
  constructor(
    readonly service: 'openrouter' | 'composio',
    readonly profileUrl: string
  ) {
    super(
      service === 'openrouter'
        ? 'Written answers use your own OpenRouter key. Add one in your Acuity profile to turn them on; search results stay free.'
        : 'Exa and Tavily search use your own Composio key. Add one in your Acuity profile; open search stays free.'
    )
    this.name = 'ByokKeyRequiredError'
  }
}

export class ByokRateLimitError extends Error {
  readonly code = 'BYOK_RATE_LIMITED'
  constructor() {
    super(
      'You are sending requests very quickly. Please wait a minute and try again.'
    )
    this.name = 'ByokRateLimitError'
  }
}

/** Maps an OpenRouter (or OpenAI-compatible SDK) failure to a clear message. */
export function describeOpenRouterError(error: unknown): {
  status: number | null
  message: string
} {
  const e = error as Record<string, any> | undefined
  const status: number | null =
    (typeof e?.statusCode === 'number' && e.statusCode) ||
    (typeof e?.status === 'number' && e.status) ||
    (typeof e?.response?.status === 'number' && e.response.status) ||
    (typeof e?.cause?.statusCode === 'number' && e.cause.statusCode) ||
    (typeof e?.lastError?.statusCode === 'number' && e.lastError.statusCode) ||
    null
  switch (status) {
    case 401:
    case 403:
      return {
        status,
        message:
          'OpenRouter did not accept your key. Check or replace it in your Acuity profile.'
      }
    case 402:
      return {
        status,
        message:
          'Your OpenRouter account is out of credit for this model. Add credit, or choose a free (:free) model in your Acuity profile.'
      }
    case 429:
      return {
        status,
        message:
          'OpenRouter is rate-limiting your key (free models have daily limits). Try again shortly or choose another model in your Acuity profile.'
      }
    case 404:
      return {
        status,
        message:
          'The model chosen in your Acuity profile is not available on OpenRouter. Choose another model.'
      }
    default:
      return {
        status,
        message:
          'The language model could not be reached just now. Results are shown without a written answer.'
      }
  }
}
