import { defineConfig, devices } from '@playwright/test'

const fallbackPort = Number(process.env.E2E_PORT || process.env.PORT || 3000)
let baseURL = process.env.BASE_URL || `http://localhost:${fallbackPort}`
let serverPort = fallbackPort
const authDisabled = process.env.E2E_AUTH_DISABLED ?? 'true'
const authEnv = authDisabled === 'true' ? 'AUTH_DISABLED=true OAUTH_DISABLED=true' : ''

try {
  const parsedUrl = new URL(baseURL)
  if (parsedUrl.port) {
    serverPort = Number(parsedUrl.port)
  }
} catch {
  baseURL = `http://localhost:${fallbackPort}`
  serverPort = fallbackPort
}

process.env.BASE_URL = baseURL
process.env.E2E_AUTH_DISABLED = authDisabled

/**
 * Read environment variables from file.
 * https://github.com/motdotla/dotenv
 */
// require('dotenv').config();

/**
 * See https://playwright.dev/docs/test-configuration.
 */
export default defineConfig({
  testDir: './__tests__/integration',
  /* Only match .spec.ts files (exclude .test.ts which are Jest tests) */
  testMatch: '**/*.spec.ts',
  /* Run tests in files serially to avoid race conditions with shared server */
  fullyParallel: false,
  /* Fail the build on CI if you accidentally left test.only in the source code. */
  forbidOnly: !!process.env.CI,
  /* Retry on CI only */
  retries: process.env.CI ? 2 : 0,
  /* Use single worker to avoid race conditions with database */
  workers: 1,
  /* Reporter to use. See https://playwright.dev/docs/test-reporters */
  reporter: 'html',
  /* Shared settings for all the projects below. See https://playwright.dev/docs/api/class-testoptions. */
  use: {
    /* Base URL to use in actions like `await page.goto('/')`. */
    baseURL,

    /* Collect trace when retrying the failed test. See https://playwright.dev/docs/trace-viewer */
    trace: 'on-first-retry',
  },

  /* Configure projects for major browsers */
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },

    // Uncomment to test on Firefox/WebKit (requires: npx playwright install)
    // {
    //   name: 'firefox',
    //   use: { ...devices['Desktop Firefox'] },
    // },
    // {
    //   name: 'webkit',
    //   use: { ...devices['Desktop Safari'] },
    // },
  ],

  /* Run your local dev server before starting the tests */
  webServer: {
    command: `${authEnv} BASE_URL=${baseURL} PORT=${serverPort} npm run dev`,
    url: baseURL,
    reuseExistingServer: false,
    timeout: 120000, // 2 minutes for Next.js to compile
  },
})
