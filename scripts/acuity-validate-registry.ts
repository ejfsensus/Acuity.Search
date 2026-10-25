#!/usr/bin/env bun
/**
 * Acuity.Search — Domain Registry Validation & Curation Tool
 *
 * Usage:
 *   bun scripts/acuity-validate-registry.ts [--live] [--limit=20] [--output=config/acuity/domain-registry.json]
 *
 * By default runs offline structural & schema integrity validation on
 * `config/acuity/domain-registry.seed.json` (110 entries, 10 groups, 146 URLs, 117 normalized hostnames),
 * preserving all `supplied*` fields untouched.
 * When `--live` is passed, performs bounded HTTP HEAD/GET verification against target URLs.
 */

import fs from 'node:fs'
import path from 'node:path'

import {
  type CurationValidationStatus,
  loadSeedRegistry,
  validateRegistryIntegrity
} from '../lib/acuity/registry'

async function probeUrlLive(url: string): Promise<{
  validationStatus: CurationValidationStatus
  httpStatus: number | null
  finalUrl: string | null
  notes: string
}> {
  try {
    const headRes = await fetch(url, {
      method: 'HEAD',
      redirect: 'follow',
      signal: AbortSignal.timeout(6000),
      headers: {
        'User-Agent': 'Acuity.Search-RegistryValidator/1.0'
      }
    })

    if (headRes.status === 401 || headRes.status === 403) {
      return {
        validationStatus: 'login required',
        httpStatus: headRes.status,
        finalUrl: headRes.url || url,
        notes: `HTTP ${headRes.status} returned on HEAD probe`
      }
    }

    if (headRes.ok) {
      const redirected = headRes.url && headRes.url !== url
      return {
        validationStatus: redirected ? 'redirected' : 'healthy',
        httpStatus: headRes.status,
        finalUrl: headRes.url || url,
        notes: redirected
          ? `Redirected to ${headRes.url}`
          : `HTTP ${headRes.status} OK`
      }
    }

    // Bounded GET fallback if HEAD returned 405 Method Not Allowed
    if (headRes.status === 405) {
      const getRes = await fetch(url, {
        method: 'GET',
        redirect: 'follow',
        signal: AbortSignal.timeout(6000),
        headers: {
          'User-Agent': 'Acuity.Search-RegistryValidator/1.0',
          Range: 'bytes=0-4095'
        }
      })
      await getRes.body?.cancel().catch(() => {})
      return {
        validationStatus: getRes.ok ? 'healthy' : 'failed',
        httpStatus: getRes.status,
        finalUrl: getRes.url || url,
        notes: `GET fallback returned HTTP ${getRes.status}`
      }
    }

    return {
      validationStatus: 'failed',
      httpStatus: headRes.status,
      finalUrl: headRes.url || url,
      notes: `HTTP ${headRes.status}`
    }
  } catch (error) {
    return {
      validationStatus: 'failed',
      httpStatus: null,
      finalUrl: null,
      notes: error instanceof Error ? error.message : 'Network error'
    }
  }
}

async function main() {
  const args = process.argv.slice(2)
  const isLive = args.includes('--live')
  const limitArg = args.find(a => a.startsWith('--limit='))
  const limit = limitArg ? Number(limitArg.split('=')[1]) : 20
  const outputArg = args.find(a => a.startsWith('--output='))
  const outputPath = outputArg
    ? outputArg.split('=')[1]
    : path.join(process.cwd(), 'config/acuity/domain-registry.json')

  const seed = loadSeedRegistry(true)
  const integrity = validateRegistryIntegrity(seed)

  if (!integrity.valid) {
    console.error('FAIL: Domain registry seed failed integrity checks:')
    for (const err of integrity.errors) {
      console.error(`  - ${err}`)
    }
    process.exit(1)
  }

  const rawDoc = structuredClone(
    seed.rawSeed ??
      JSON.parse(
        fs.readFileSync(
          path.join(process.cwd(), 'config/acuity/domain-registry.seed.json'),
          'utf-8'
        )
      )
  )

  if (isLive && Array.isArray(rawDoc.sources)) {
    const candidates = rawDoc.sources
      .filter((s: Record<string, any>) => s.starterPriority)
      .slice(0, limit)
    for (const src of candidates) {
      const primaryUrl = src.suppliedUrls?.[0]
      if (!primaryUrl) continue
      const probe = await probeUrlLive(primaryUrl)
      src.curation = {
        ...src.curation,
        notes: Array.from(
          new Set([
            ...(src.curation?.notes || []),
            `${probe.validationStatus}: ${probe.notes}`
          ])
        )
      }
    }
  }

  fs.writeFileSync(outputPath, JSON.stringify(rawDoc, null, 2) + '\n', 'utf-8')
  console.log(
    `PASS: Validated ${integrity.stats.entryCount} entries / ${integrity.stats.groupCount} groups / ${integrity.stats.uniqueUrlCount} URLs / ${integrity.stats.uniqueHostCount} hosts (${integrity.stats.starterPriorityCount} starter-priority). Wrote ${outputPath}`
  )
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
