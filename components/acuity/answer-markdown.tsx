'use client'

import { math } from '@streamdown/math'
import { defaultRehypePlugins, Streamdown } from 'streamdown'

import 'katex/dist/katex.min.css'

const rehypePlugins = Object.values(defaultRehypePlugins)

/**
 * Markdown renderer for the synthesis card. Split out (and loaded with
 * next/dynamic) so Streamdown + KaTeX are not in the first-load bundle of the
 * idle portal.
 */
export default function AnswerMarkdown({
  markdown,
  onCitation
}: {
  markdown: string
  onCitation: (label: string) => void
}) {
  return (
    <Streamdown
      mode="static"
      plugins={{ math }}
      rehypePlugins={rehypePlugins}
      components={{
        a: ({ href, children, ...props }) => {
          if (href && href.startsWith('#cite-')) {
            const label = href.replace('#cite-', '')
            return (
              <button
                type="button"
                onClick={() => onCitation(label)}
                title={`View excerpt for ${label}`}
                aria-label={`Source ${label}`}
                className="mx-0.5 inline-flex items-center rounded border border-[#d4a843]/60 bg-[#d4a843]/15 px-1.5 py-0.5 font-mono text-[12px] font-semibold text-[#e8c96a] transition-colors hover:bg-[#d4a843] hover:text-[#09090f]"
              >
                {children}
              </button>
            )
          }
          return (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[#e8c96a] underline underline-offset-4 hover:text-[#d4a843]"
              {...props}
            >
              {children}
            </a>
          )
        }
      }}
    >
      {markdown}
    </Streamdown>
  )
}
