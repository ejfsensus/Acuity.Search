import { getCurrentUserId } from '@/lib/auth/get-current-user'

import { FloatingSignOut } from '@/components/floating-sign-out'

export default async function SearchLayout({
  children
}: {
  children: React.ReactNode
}) {
  const userId = await getCurrentUserId()
  return (
    <>
      {userId && <FloatingSignOut />}
      {children}
    </>
  )
}
