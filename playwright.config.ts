import { defineConfig, devices } from '@playwright/test'

/**
 * E2E smoke. Runs against a built app (`bun run build`) started on
 * E2E_PORT (default 3000), or E2E_BASE_URL if set. Provider and model calls
 * are stubbed per-test with page.route, so no API keys are needed.
 */
const port = Number(process.env.E2E_PORT || 3000)
const baseURL = process.env.E2E_BASE_URL || `http://127.0.0.1:${port}`

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  retries: 0,
  use: {
    baseURL,
    trace: 'retain-on-failure',
    // Optional: reuse a locally installed Chromium instead of downloading one
    launchOptions: process.env.E2E_CHROMIUM_PATH
      ? { executablePath: process.env.E2E_CHROMIUM_PATH }
      : {}
  },
  projects: [
    {
      name: 'desktop',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: process.env.E2E_CHROMIUM_PATH
          ? { executablePath: process.env.E2E_CHROMIUM_PATH }
          : {}
      }
    },
    {
      name: 'mobile',
      use: {
        ...devices['Pixel 7'],
        launchOptions: process.env.E2E_CHROMIUM_PATH
          ? { executablePath: process.env.E2E_CHROMIUM_PATH }
          : {}
      }
    }
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: `bunx next start -p ${port}`,
        url: baseURL,
        reuseExistingServer: true,
        env: { AUTH_PROVIDER: 'none', ENABLE_AUTH: 'false' }
      }
})
