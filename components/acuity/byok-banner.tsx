'use client'

import { useState } from 'react'

export interface ByokStatusProps {
  required: boolean
  signedIn?: boolean
  llm: boolean
  webSearch: boolean
  model?: string | null
  resolverUnavailable?: boolean
  profileUrl: string | null
}

/** What the member needs to add, in plain words; null when nothing is missing. */
export function byokBannerCopy(
  status: ByokStatusProps | undefined
): { tone: 'needed' | 'optional'; text: string; cta: string } | null {
  if (!status?.required || !status.profileUrl) return null
  if (status.resolverUnavailable)
    return {
      tone: 'needed',
      text: 'We couldn’t reach your Acuity profile just now, so written answers are paused. Sources and verbatim evidence still work.',
      cta: 'Open your profile'
    }
  if (!status.signedIn)
    return {
      tone: 'needed',
      text: 'Written answers run on your own OpenRouter key. Sign in and add it in your Acuity profile — sources and verbatim evidence are free without it.',
      cta: 'Sign in and add a key'
    }
  if (!status.llm)
    return {
      tone: 'needed',
      text: 'Add your OpenRouter key in your Acuity profile to turn on written answers. Sources and verbatim evidence stay free.',
      cta: 'Add your key'
    }
  if (!status.webSearch)
    return {
      tone: 'optional',
      text: 'Optional: add a Composio key to search with Exa and Tavily as well as the free engines.',
      cta: 'Add Composio'
    }
  return null
}

export function ByokBanner({ status }: { status?: ByokStatusProps }) {
  const [dismissed, setDismissed] = useState(false)
  const copy = byokBannerCopy(status)
  if (!copy || !status?.profileUrl || dismissed) return null
  const needed = copy.tone === 'needed'
  return (
    <div
      role="status"
      data-testid="byok-banner"
      className={`mx-auto mt-4 flex w-full max-w-3xl flex-wrap items-center justify-between gap-3 rounded-xl border p-3.5 text-[13px] ${
        needed
          ? 'border-[#D4AF37]/60 bg-[#1A2235] text-white'
          : 'border-[#1A2235] bg-[#1A2235]/60 text-[#d6d3df]'
      }`}
    >
      <p className="min-w-0 flex-1 leading-relaxed">{copy.text}</p>
      <div className="flex items-center gap-2">
        <a
          href={status.profileUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-10 items-center rounded-full bg-[#FADB5F] px-4 font-semibold text-[#030305] transition-colors hover:bg-[#D4AF37]"
        >
          {copy.cta}
        </a>
        {!needed && (
          <button
            type="button"
            onClick={() => setDismissed(true)}
            className="min-h-10 rounded-full px-3 text-[#b3b0bd] hover:text-white"
            aria-label="Dismiss"
          >
            Not now
          </button>
        )}
      </div>
    </div>
  )
}
