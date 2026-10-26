import { NextResponse } from 'next/server'

import { getAcuityConfig, getProviderStatuses } from '@/lib/acuity/config'
import { DEPTH_BUDGETS } from '@/lib/acuity/search/budget'
import { PROVIDER_CAPABILITIES } from '@/lib/acuity/search/capabilities'
import {
  ANSWER_PREFERENCES,
  DATE_RANGES,
  DISCOVERY_MODES,
  FILE_TYPE_FILTERS,
  RESEARCH_DEPTHS,
  SCOPE_POLICIES,
  SORT_ORDERS
} from '@/lib/acuity/search/contracts'
import { toPublicProviderStatuses } from '@/lib/acuity/search/public-view'

export async function GET() {
  const config = getAcuityConfig()
  const providerStatuses = toPublicProviderStatuses(getProviderStatuses())

  return NextResponse.json({
    product: {
      name: 'Acuity.Search',
      tagline: 'Open enquiry. Wider sources. Traceable answers.',
      version: '1.0.0'
    },
    defaults: {
      mode: config.defaultMode,
      depth: config.defaultDepth,
      providers: config.defaultProviders,
      allowResultsOnly: config.allowResultsOnly,
      safeSearch: config.searxng.safeSearch
    },
    modes: DISCOVERY_MODES,
    depths: RESEARCH_DEPTHS,
    answerPreferences: ANSWER_PREFERENCES,
    sortOrders: SORT_ORDERS,
    scopePolicies: SCOPE_POLICIES,
    dateRanges: DATE_RANGES,
    fileTypes: FILE_TYPE_FILTERS,
    budgets: DEPTH_BUDGETS,
    providers: providerStatuses,
    capabilities: PROVIDER_CAPABILITIES,
    llm: {
      configured: config.llm.configured
    },
    codexBridge: {
      enabled: config.codexBridge.enabled,
      schemaVersion: config.codexBridge.schemaVersion,
      status: 'planned-export-ready'
    }
  })
}
