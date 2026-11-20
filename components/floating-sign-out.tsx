'use client'

import { useEffect, useState } from 'react'

import { SignOutButton } from './sign-out-button'

/** Top-right Sign out for chat pages, which have no header bar. Hidden inside iframes (Codex embed). */
export function FloatingSignOut() {
  const [show, setShow] = useState(false)
  useEffect(() => {
    setShow(window.self === window.top)
  }, [])
  if (!show) return null
  return (
    <div className="fixed right-3 top-3 z-40">
      <SignOutButton />
    </div>
  )
}
