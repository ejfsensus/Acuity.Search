import Link from 'next/link'

import { resolveShareByRawToken } from '@/lib/acuity/store'

import { AcuityEmblem } from '@/components/acuity/acuity-portal-hero'

export default async function SharedSnapshotPage(props: {
  params: Promise<{ token: string }>
}) {
  const { token } = await props.params
  const resolved = resolveShareByRawToken(token)

  if (resolved.status !== 'active' || !resolved.snapshot) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-[#09090f] p-6 text-center text-[#fafafa]">
        <AcuityEmblem className="mb-4 size-10" />
        <h1 className="font-serif text-2xl font-medium">
          {resolved.status === 'revoked'
            ? 'Shared Research Snapshot Revoked'
            : resolved.status === 'expired'
              ? 'Shared Research Snapshot Expired'
              : 'Shared Research Snapshot Not Found'}
        </h1>
        <p className="mt-2 max-w-md text-sm text-[#b3b0bd]">
          {resolved.status === 'revoked'
            ? 'The owner of this research snapshot has revoked access.'
            : resolved.status === 'expired'
              ? 'This unlisted research snapshot has passed its expiration date.'
              : 'No active research snapshot exists for this token.'}
        </p>
        <Link
          href="/"
          className="mt-6 rounded-full border border-[#d4a843] bg-[#d4a843]/15 px-5 py-2 font-mono text-xs text-[#e8c96a] hover:bg-[#d4a843]/25"
        >
          Return to Acuity.Search
        </Link>
      </div>
    )
  }

  const { snapshot } = resolved
  const inner = snapshot.snapshot

  return (
    <div className="min-h-screen w-full overflow-y-auto bg-[#09090f] px-4 py-8 text-[#fafafa] md:px-8">
      <div className="mx-auto max-w-4xl">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-[#35313c] pb-4">
          <div className="flex items-center gap-2.5">
            <AcuityEmblem className="size-7" />
            <div>
              <div className="font-serif text-xl font-medium">
                Acuity<span className="text-[#d4a843]">.Search</span> · Unlisted
                Research Snapshot
              </div>
              <div className="font-mono text-[11px] text-[#8e899c]">
                Selected-output snapshot · Created{' '}
                {new Date(snapshot.createdAt).toLocaleDateString()}
              </div>
            </div>
          </div>

          <Link
            href="/"
            className="rounded-full border border-[#35313c] bg-[#111118] px-4 py-1.5 font-mono text-xs text-[#e8c96a] hover:border-[#d4a843]"
          >
            New Enquiry →
          </Link>
        </header>

        <div className="mt-6">
          <h1 className="font-serif text-2xl font-medium text-[#fafafa] md:text-3xl">
            {snapshot.title}
          </h1>
          {inner.query && (
            <p className="mt-1 font-mono text-xs text-[#d4a843]">
              Enquiry: &ldquo;{inner.query}&rdquo; ({inner.mode} · {inner.depth}
              )
            </p>
          )}
        </div>

        {inner.answer && (
          <section className="mt-6 rounded-2xl border border-[#35313c] bg-[#111118] p-5">
            <h2 className="mb-3 font-serif text-lg text-[#e8c96a]">
              Selected Synthesis
            </h2>
            <div className="whitespace-pre-wrap text-sm leading-relaxed text-[#fafafa]">
              {inner.answer.markdown}
            </div>
          </section>
        )}

        <section className="mt-6">
          <h2 className="mb-3 font-serif text-xl text-[#fafafa]">
            Selected Sources ({inner.sources.length})
          </h2>
          <div className="flex flex-col gap-3">
            {inner.sources.map(src => (
              <div
                key={src.id}
                className="rounded-2xl border border-[#35313c] bg-[#111118] p-4"
              >
                <div className="flex items-center justify-between gap-2 font-mono text-xs">
                  <span className="text-[#e8c96a]">
                    [{src.citationLabel}] {src.hostname}
                  </span>
                  <span className="text-[#8e899c]">{src.contentState}</span>
                </div>
                <a
                  href={src.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-1 block font-serif text-lg font-medium text-[#fafafa] hover:text-[#e8c96a] hover:underline"
                >
                  {src.title}
                </a>
                {src.snippet && (
                  <p className="mt-1.5 text-sm text-[#b3b0bd]">{src.snippet}</p>
                )}
              </div>
            ))}
          </div>
        </section>

        {inner.evidence.length > 0 && (
          <section className="mt-6">
            <h2 className="mb-3 font-serif text-xl text-[#fafafa]">
              Selected Verbatim Evidence ({inner.evidence.length})
            </h2>
            <div className="flex flex-col gap-3">
              {inner.evidence.map(ev => (
                <div
                  key={ev.id}
                  className="rounded-2xl border border-[#35313c] bg-[#111118] p-4"
                >
                  <div className="flex items-center justify-between font-mono text-xs text-[#8e899c]">
                    <span className="text-[#e8c96a]">[{ev.citationLabel}]</span>
                    <span>
                      Locator: {ev.locator.type} ({ev.locator.value})
                    </span>
                  </div>
                  <pre className="mt-2 whitespace-pre-wrap break-words font-sans text-xs leading-relaxed text-[#fafafa]">
                    {ev.verbatimText}
                  </pre>
                  <div className="mt-2 break-all font-mono text-[10px] text-[#8e899c]">
                    SHA-256: {ev.sha256}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  )
}
