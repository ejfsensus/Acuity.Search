'use client'

import { useState } from 'react'

import { IconLogout } from '@tabler/icons-react'

import { getIdpSignOutUrl, signOut } from '@/lib/actions/auth'
import { chatStore } from '@/lib/chat-store'

import { Button } from './ui/button'

/** Ends the Search session, then the Acuity sign-in session (single sign-out). */
export async function signOutEverywhere() {
  await signOut()
  chatStore.setUser(null)
  const back = `${window.location.origin}/auth/login`
  const idp = await getIdpSignOutUrl(back).catch(() => '')
  window.location.assign(idp || back)
}

export function SignOutButton() {
  const [busy, setBusy] = useState(false)
  return (
    <Button
      variant="outline"
      size="sm"
      aria-label="Sign out"
      title="Sign out"
      disabled={busy}
      onClick={async () => {
        setBusy(true)
        try {
          await signOutEverywhere()
        } finally {
          setBusy(false)
        }
      }}
      data-testid="sign-out"
    >
      <IconLogout className="size-4" />
      <span className="hidden sm:inline">Sign out</span>
    </Button>
  )
}
