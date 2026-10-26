import type { Metadata, Viewport } from 'next'

import { getCurrentUser, getCurrentUserId } from '@/lib/auth/get-current-user'
import { getAuthProvider, withShareOptIn } from '@/lib/auth/provider'
import { AppUserProvider } from '@/lib/contexts/app-user-context'
import { UserProvider } from '@/lib/contexts/user-context'
import {
  ENFORCEMENT,
  getUsageBudget,
  isUsageBudgetAvailable,
  UI_ENABLED
} from '@/lib/usage-budget'
import { cn } from '@/lib/utils'

import { SidebarProvider } from '@/components/ui/sidebar'
import { Toaster } from '@/components/ui/sonner'

import ArtifactRoot from '@/components/artifact/artifact-root'
import { KeyboardShortcutHandler } from '@/components/keyboard-shortcut-handler'
import { LibraryProvider } from '@/components/library/library-context'
import { PostHogProvider } from '@/components/posthog-provider'
import { ThemeProvider } from '@/components/theme-provider'
import { UsageBudgetProvider } from '@/components/usage-budget-provider'

import './globals.css'

const title = 'Acuity.Search'
const description = 'Open enquiry. Wider sources. Traceable answers.'

export const metadata: Metadata = {
  metadataBase: new URL('https://acuity.institute'),
  title,
  description,
  openGraph: {
    title,
    description
  },
  twitter: {
    title,
    description,
    card: 'summary_large_image'
  }
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  minimumScale: 1
}

export default async function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode
}>) {
  const user = await getCurrentUser()
  const authProvider = getAuthProvider()
  const capabilities = withShareOptIn(
    authProvider.capabilities,
    authProvider.name
  )

  const userId = user?.id ?? (await getCurrentUserId())
  const isCloudDeployment = process.env.MORPHIC_CLOUD_DEPLOYMENT === 'true'
  const usageBudgetEnabled = Boolean(
    user &&
      isCloudDeployment &&
      isUsageBudgetAvailable() &&
      ENFORCEMENT === 'on' &&
      UI_ENABLED
  )
  const usageSnapshot =
    usageBudgetEnabled && user
      ? await getUsageBudget({
          userId: user.id,
          userCreatedAt: user.createdAt
        })
      : null
  const initialUsage = usageSnapshot
    ? {
        remaining: usageSnapshot.remaining,
        limit: usageSnapshot.limit,
        costs: usageSnapshot.costs,
        resetAt: new Date(usageSnapshot.resetAt).toISOString(),
        ...(usageSnapshot.refreshAt && {
          refreshAt: new Date(usageSnapshot.refreshAt).toISOString()
        })
      }
    : null

  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body
        className={cn(
          'fixed inset-0 flex flex-col font-sans antialiased overflow-hidden bg-[#09090f] text-[#fafafa]'
        )}
      >
        <ThemeProvider
          attribute="class"
          defaultTheme="dark"
          enableSystem={false}
          disableTransitionOnChange
        >
          <PostHogProvider userId={user?.id ?? null}>
            <AppUserProvider user={user} capabilities={capabilities}>
              <UserProvider hasUser={!!userId}>
                <SidebarProvider defaultOpen={false}>
                  <LibraryProvider>
                    <UsageBudgetProvider
                      key={user?.id ?? 'guest'}
                      initialUsage={initialUsage}
                      enabled={usageBudgetEnabled}
                    >
                      <KeyboardShortcutHandler />
                      <div className="flex flex-col flex-1 min-w-0">
                        <main className="flex flex-1 min-h-0 min-w-0 overflow-hidden">
                          <ArtifactRoot>{children}</ArtifactRoot>
                        </main>
                      </div>
                    </UsageBudgetProvider>
                  </LibraryProvider>
                </SidebarProvider>
              </UserProvider>
            </AppUserProvider>
          </PostHogProvider>
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  )
}
