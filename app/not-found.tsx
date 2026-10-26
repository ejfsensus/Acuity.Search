import Link from 'next/link'

export const metadata = {
  title: 'Not found · Acuity.Search'
}

export default function NotFound() {
  return (
    <main className="flex h-full flex-col items-center justify-center gap-6 px-6 text-center">
      <svg
        aria-hidden="true"
        viewBox="0 0 120 80"
        className="h-16 w-24 text-[var(--acuity-gold)]"
      >
        <path
          d="M10 78 V40 a50 38 0 0 1 100 0 V78"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
        />
      </svg>
      <h1 className="font-serif text-4xl text-[var(--acuity-ink)]">
        This passage is not in the archive
      </h1>
      <p className="max-w-md text-base leading-relaxed text-[var(--acuity-ink-muted)]">
        The page you were looking for has moved, or never existed. The search
        is still open.
      </p>
      <Link
        href="/"
        className="acuity-focus inline-flex min-h-11 items-center rounded-full border border-[var(--acuity-gold)] bg-[var(--acuity-gold)] px-6 font-mono text-sm font-semibold text-[var(--acuity-void)] hover:bg-[var(--acuity-gold-hi)]"
      >
        Return to Acuity.Search
      </Link>
    </main>
  )
}
