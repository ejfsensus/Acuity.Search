import type { ProviderId } from '@/lib/acuity/search/contracts'
import { executeBraveSearch } from '@/lib/acuity/search/providers/brave'
import { executeExaSearch } from '@/lib/acuity/search/providers/exa'
import {
  executeSearxngSearch,
  type ProviderExecutionInput,
  type ProviderExecutionOutput
} from '@/lib/acuity/search/providers/searxng'
import { executeTavilySearch } from '@/lib/acuity/search/providers/tavily'

export type ProviderAdapterFn = (
  input: ProviderExecutionInput
) => Promise<ProviderExecutionOutput>

export const PROVIDER_ADAPTERS: Record<ProviderId, ProviderAdapterFn> = {
  searxng: executeSearxngSearch,
  brave: executeBraveSearch,
  tavily: executeTavilySearch,
  exa: executeExaSearch
}

export async function executeProviderAdapter(
  provider: ProviderId,
  input: ProviderExecutionInput
): Promise<ProviderExecutionOutput> {
  const adapter = PROVIDER_ADAPTERS[provider]
  return adapter(input)
}

export type { ProviderExecutionInput, ProviderExecutionOutput }
export {
  executeBraveSearch,
  executeExaSearch,
  executeSearxngSearch,
  executeTavilySearch
}
