import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import type { LanguageModel } from 'ai'

import { getByokConfig } from './config'
import { currentByok } from './context'
import { ByokKeyRequiredError } from './errors'

/** Language model on the member's own OpenRouter account and chosen model. */
export function openRouterModelFor(
  apiKey: string,
  model: string,
  appUrl = getByokConfig().appUrl
): LanguageModel {
  const provider = createOpenAICompatible({
    name: 'openrouter',
    baseURL: getByokConfig().openrouterBase,
    apiKey,
    headers: { 'HTTP-Referer': appUrl, 'X-Title': 'Acuity.Search' }
  })
  return provider(model)
}

/**
 * Resolves the model for the current request when BYOK is required.
 * Returns null when BYOK is off (callers use the deployment's registry).
 * Throws ByokKeyRequiredError when the member has no OpenRouter key.
 */
export function byokLanguageModel(): {
  model: LanguageModel
  modelId: string
} | null {
  const cfg = getByokConfig()
  if (cfg.mode === 'off') return null
  const ctx = currentByok()
  const or = ctx?.credentials.openrouter
  if (!or) throw new ByokKeyRequiredError('openrouter', ctx?.profileUrl ?? '')
  return {
    model: openRouterModelFor(or.apiKey, or.llmModel),
    modelId: `openrouter:${or.llmModel}`
  }
}
