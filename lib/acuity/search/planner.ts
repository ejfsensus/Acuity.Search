import { loadDomainRegistry } from '@/lib/acuity/registry'
import type {
  CompiledScope,
  FileTypeFilter,
  QueryPlan,
  QueryVariant,
  SearchRequest,
  TopicGroupSuggestion
} from '@/lib/acuity/search/contracts'
import { matchesHostScope, normalizeHostname } from '@/lib/acuity/search/scope'

interface TransliterationRule {
  trigger: RegExp
  replacement: string
  rationale: string
}

const TRANSLITERATION_RULES: TransliterationRule[] = [
  {
    trigger: /\bnag\s+hammadi\b/i,
    replacement: 'Nag Hammadi Chenoboskion codices Coptic',
    rationale:
      'Expand Nag Hammadi with historical find-site (Chenoboskion) and codex terminology'
  },
  {
    trigger: /\bmerkabah\b/i,
    replacement: 'Merkavah Hekhalot mysticism',
    rationale:
      'Include alternate transliteration (Merkavah) and Hekhalot literature corpus'
  },
  {
    trigger: /\bmerkavah\b/i,
    replacement: 'Merkabah Hekhalot mysticism',
    rationale:
      'Include alternate transliteration (Merkabah) and Hekhalot literature corpus'
  },
  {
    trigger: /\bwahdat\s+al[- ]wujud\b/i,
    replacement: '"wahdat al-wujud" "Ibn Arabi" "oneness of being"',
    rationale:
      'Expand Sufi metaphysical term with Ibn Arabi and English translation'
  },
  {
    trigger: /\bcorpus\s+hermeticum\b/i,
    replacement:
      '"Corpus Hermeticum" "Hermes Trismegistus" Poimandres Copenhaver Mead',
    rationale:
      'Include primary Hermetic tractate and standard scholarly translators (Copenhaver, Mead)'
  },
  {
    trigger: /\bzohar\b/i,
    replacement: 'Zohar Sefer ha-Zohar Kabbalah Aramaic Daniel Matt',
    rationale:
      'Expand Zohar with Hebrew title and critical translation terminology'
  },
  {
    trigger: /\bdzogchen\b/i,
    replacement: 'Dzogchen Atiyoga Rigpa Longchenpa Nyingma',
    rationale:
      'Expand Dzogchen with Sanskrit/Tibetan equivalents and foundational lineage'
  },
  {
    trigger: /\bupanishad/i,
    replacement: 'Upanishads Upanisads Vedanta Advaita Sanskrit translation',
    rationale:
      'Include academic transliteration (Upanisads) and Vedantic commentary context'
  },
  {
    trigger: /\bphilokalia\b/i,
    replacement: 'Philokalia Hesychasm Nepsis Eastern Orthodox Fathers',
    rationale: 'Expand Philokalia with hesychastic and patristic terminology'
  },
  {
    trigger: /\bdao\s*de\s*jing\b|\btao\s*te\s*ching\b/i,
    replacement: '"Dao De Jing" "Tao Te Ching" Laozi Mawangdui Guodian',
    rationale:
      'Bridge Pinyin/Wade-Giles transliterations and excavated manuscript witnesses'
  },
  {
    trigger: /\bmkultra\b|\bstargate\s+project\b/i,
    replacement: 'declassified FOIA reading room memorandum archive',
    rationale: 'Add archival declassification and FOIA document descriptors'
  }
]

const GROUP_KEYWORD_MAP: Record<string, string[]> = {
  'gnostic-hermetic': [
    'gnostic',
    'gnosticism',
    'nag hammadi',
    'hermetic',
    'hermeticism',
    'corpus hermeticum',
    'poimandres',
    'alchemy',
    'alchemical',
    'patristic',
    'early christian',
    'pistis sophia',
    'valentinus',
    'apocryphon'
  ],
  'kabbalah-jewish-mysticism': [
    'kabbalah',
    'zohar',
    'sefer yetzirah',
    'bahir',
    'merkabah',
    'merkavah',
    'hekhalot',
    'sefirot',
    'ein sof',
    'talmud',
    'torah',
    'midrash',
    'hasidic',
    'lurianic'
  ],
  'classical-cosmology': [
    'platonism',
    'neoplatonism',
    'plotinus',
    'proclus',
    'iamblichus',
    'pythagoras',
    'sacred geometry',
    'classical',
    'enneads',
    'timaeus',
    'nous',
    'cosmology',
    'perseus',
    'antiquity'
  ],
  'comparative-texts': [
    'sacred text',
    'scripture',
    'corpus',
    'comparative religion',
    'mythology',
    'translation',
    'translators',
    'corpus hermeticum',
    'veda',
    'upanishad',
    'sutta',
    'tripitaka',
    'quran',
    'folklore'
  ],
  'contemplative-traditions': [
    'wahdat al-wujud',
    'ibn arabi',
    'sufi',
    'sufism',
    'rigpa',
    'dzogchen',
    'mahamudra',
    'advaita',
    'vedanta',
    'non-duality',
    'nonduality',
    'hesychasm',
    'philokalia',
    'dao',
    'tao',
    'zen',
    'contemplative'
  ],
  'esoteric-academies': [
    'esoteric',
    'occult',
    'rosicrucian',
    'theosophy',
    'warburg',
    'ritman',
    'embassy of the free mind',
    'eranos',
    'jung',
    'freemasonry',
    'grimoire',
    'astrology',
    'tarot'
  ],
  consciousness: [
    'consciousness',
    'psi',
    'parapsychology',
    'near-death',
    'nde',
    'out-of-body',
    'obe',
    'remote viewing',
    'gateway process',
    'stargate',
    'psychedelic',
    'altered states',
    'noetic',
    'reincarnation'
  ],
  'records-foia': [
    'foia',
    'declassified',
    'cia',
    'fbi',
    'nsa',
    'gateway process',
    'mkultra',
    'stargate',
    'reading room',
    'national security archive',
    'uap',
    'ufo',
    'public record',
    'memorandum'
  ],
  'governance-accountability': [
    'corporate',
    'lobbying',
    'tax-exempt',
    '990',
    'sec filing',
    'edgar',
    'sanctions',
    'offshore',
    'beneficial ownership',
    'opencorporates',
    'littlesis',
    'court record',
    'oversight'
  ],
  'investigative-journalism': [
    'investigative',
    'journalism',
    'whistleblower',
    'leak',
    'muckrock',
    'propublica',
    'icij',
    'bellingcat',
    'intercept',
    'documentcloud',
    'watchdog'
  ]
}

export function sanitizeUserQuery(rawQuery: string): {
  cleaned: string
  explicitSites: string[]
  explicitFileType?: FileTypeFilter
} {
  // Strip control characters
  const withoutControl = rawQuery.replace(/[\x00-\x1f\x7f]/g, ' ').trim()

  const explicitSites: string[] = []
  let explicitFileType: FileTypeFilter | undefined

  const siteMatches = withoutControl.matchAll(/\bsite:([^\s]+)/gi)
  for (const match of siteMatches) {
    const rawHost = match[1]?.replace(/^['"]|['"]$/g, '')
    const normalized = rawHost ? normalizeHostname(rawHost) : null
    if (normalized) {
      explicitSites.push(normalized)
    }
  }

  const fileTypeMatch = withoutControl.match(/\bfiletype:(pdf|epub|html)\b/i)
  if (fileTypeMatch?.[1]) {
    explicitFileType = fileTypeMatch[1].toLowerCase() as FileTypeFilter
  }

  // Strip site: and filetype: tokens for the clean semantic query
  const cleaned = withoutControl
    .replace(/\bsite:[^\s]+/gi, '')
    .replace(/\bfiletype:[^\s]+/gi, '')
    .replace(/\s+/g, ' ')
    .trim()

  return {
    cleaned: cleaned || withoutControl,
    explicitSites,
    explicitFileType
  }
}

export function suggestTopicGroups(query: string): TopicGroupSuggestion[] {
  const registry = loadDomainRegistry()
  const lower = query.toLowerCase()
  const suggestions: TopicGroupSuggestion[] = []

  for (const group of registry.topicGroups) {
    const keywords = GROUP_KEYWORD_MAP[group.id] ?? []
    const matchedTerms = keywords.filter(kw => lower.includes(kw))

    // Also check if any entry name or focus in this group matches words >= 4 chars
    const entriesInGroup = registry.entries.filter(
      e => e.topicGroupId === group.id
    )
    for (const entry of entriesInGroup) {
      const nameLower = entry.suppliedName.toLowerCase()
      if (nameLower.length >= 4 && lower.includes(nameLower)) {
        matchedTerms.push(entry.suppliedName)
      }
    }

    const uniqueTerms = Array.from(new Set(matchedTerms))
    if (uniqueTerms.length > 0) {
      const confidence = Math.min(0.95, 0.35 + uniqueTerms.length * 0.2)
      suggestions.push({
        groupId: group.id,
        title: group.suppliedTitle,
        confidence: Number(confidence.toFixed(2)),
        matchedTerms: uniqueTerms.slice(0, 5),
        rationale: `Query matched ${uniqueTerms.slice(0, 3).join(', ')} in ${group.suppliedTitle}`
      })
    }
  }

  return suggestions.sort((a, b) => b.confidence - a.confidence).slice(0, 3)
}

export function buildQueryPlan(
  request: SearchRequest,
  scope: CompiledScope
): QueryPlan {
  const { cleaned, explicitSites, explicitFileType } = sanitizeUserQuery(
    request.query
  )

  const maxVariants = request.depth === 'research' ? 6 : 2
  const variants: QueryVariant[] = []

  // Check if explicit site: operators conflict with a strict collection scope
  let scopeConflictWarning: string | undefined
  if (
    scope.policy === 'strict' &&
    scope.targets.length > 0 &&
    explicitSites.length > 0
  ) {
    const conflicting = explicitSites.filter(
      siteHost =>
        !scope.targets.some(t =>
          matchesHostScope(siteHost, t.hostname, t.includeWwwAlias)
        )
    )
    if (conflicting.length > 0) {
      scopeConflictWarning = `Query contains site:${conflicting.join(', ')} which lies outside the active strict collection scope (${scope.targets
        .slice(0, 3)
        .map(t => t.hostname)
        .join(', ')}). Strict scope remains enforced.`
    }
  }

  const effectiveFileType =
    request.fileType !== 'any' ? request.fileType : explicitFileType

  const appendFileType = (q: string): string => {
    if (!effectiveFileType || effectiveFileType === 'any') return q
    if (new RegExp(`\\bfiletype:${effectiveFileType}\\b`, 'i').test(q)) return q
    return `${q} filetype:${effectiveFileType}`
  }

  // Variant 1: Literal user query (always preserved first)
  variants.push({
    id: 'v1-literal',
    query: appendFileType(cleaned),
    kind: 'literal',
    rationale: 'Preserves the exact user query terms'
  })

  // Variant 2+: Transliteration / scholarly synonym expansion
  for (const rule of TRANSLITERATION_RULES) {
    if (variants.length >= maxVariants) break
    if (rule.trigger.test(cleaned)) {
      const expanded = `${cleaned} ${rule.replacement}`.trim()
      variants.push({
        id: `v${variants.length + 1}-translit`,
        query: appendFileType(expanded),
        kind: 'transliteration',
        rationale: rule.rationale
      })
    }
  }

  // Mode-specific variants
  if (request.mode === 'literature' && variants.length < maxVariants) {
    variants.push({
      id: `v${variants.length + 1}-lit-edition`,
      query: appendFileType(
        `${cleaned} ("translation" OR "translated by" OR "critical edition" OR "text")`
      ),
      kind: 'literature-edition',
      rationale:
        'Targets primary texts, named translations, and critical editions for Literature mode'
    })

    if (variants.length < maxVariants) {
      variants.push({
        id: `v${variants.length + 1}-lit-pdf`,
        query: `${cleaned} (filetype:pdf OR "full text" OR "manuscript" OR "archive")`,
        kind: 'literature-edition',
        rationale:
          'Locates downloadable PDF/full-text editions and archival holdings'
      })
    }
  }

  if (request.mode === 'collections' && scope.targets.length > 0) {
    // Generate targeted site-scoped variants for priority targets up to maxVariants
    const priorityTargets = [
      ...scope.targets.filter(t => t.starterPriority),
      ...scope.targets.filter(t => !t.starterPriority)
    ]

    for (const target of priorityTargets) {
      if (variants.length >= maxVariants) break
      const pathHint =
        target.allowedPathPrefixes[0] && target.allowedPathPrefixes[0] !== '/'
          ? ` "${target.allowedPathPrefixes[0].replace(/^\//, '')}"`
          : ''
      variants.push({
        id: `v${variants.length + 1}-site-${target.hostname.replace(/[^a-z0-9]/g, '-')}`,
        query: appendFileType(`site:${target.hostname}${pathHint} ${cleaned}`),
        kind: 'scoped-site',
        rationale: `Targeted query for ${target.label} (${target.hostname})`,
        targetHostname: target.hostname
      })
    }
  }

  // In Research depth for General mode, add archival/primary-source expansion if slots remain
  if (variants.length < maxVariants && request.depth === 'research') {
    variants.push({
      id: `v${variants.length + 1}-archival`,
      query: appendFileType(
        `${cleaned} (archive OR primary source OR treatise OR document)`
      ),
      kind: 'archival-expansion',
      rationale:
        'Expands search toward archival documents and primary treatises'
    })
  }

  const suggestedGroups = suggestTopicGroups(cleaned)

  return {
    originalQuery: request.query,
    cleanedQuery: cleaned,
    explicitSiteOperators: explicitSites,
    explicitFileType: effectiveFileType,
    variants: variants.slice(0, maxVariants),
    suggestedGroups,
    scopeConflictWarning
  }
}
