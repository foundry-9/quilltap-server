import { test, expect } from '@playwright/test'
import { TestHelper } from './helpers/test-user'

test.describe('App Smoke Tests', () => {
  test.describe.configure({ mode: 'serial' })

  const testHelper = new TestHelper('app_smoke')
  const characterName = 'App Smoke Character'
  let testCharacterId: string
  let testChatId: string

  const openSettingsTab = async (
    page: import('@playwright/test').Page,
    tabLabel: string,
    heading: string | RegExp,
    options: {
      exact?: boolean
      timeout?: number
      errorText?: string
    } = {}
  ) => {
    const timeout = options.timeout ?? 15000
    const headingLocator = page.getByRole('heading', { name: heading, exact: options.exact })
    const errorLocator = options.errorText ? page.getByText(options.errorText) : null

    for (let attempt = 1; attempt <= 2; attempt += 1) {
      await page.getByRole('button', { name: tabLabel }).click()

      try {
        await headingLocator.waitFor({ state: 'visible', timeout })
        return
      } catch (error) {
        if (!errorLocator || attempt === 2) {
          throw error
        }

        const errorVisible = await errorLocator.isVisible().catch(() => false)
        if (!errorVisible) {
          throw error
        }

        await page.reload()
        await page.waitForLoadState('domcontentloaded')
      }
    }
  }

  test('setup: seed test data', async ({ page }) => {
    await testHelper.ensureReady(page)
    testCharacterId = await testHelper.createCharacter(page, {
      name: characterName,
      description: 'A character for smoke testing.',
      firstMessage: 'Hello from the smoke test.',
    })
    testChatId = await testHelper.createChat(page, testCharacterId)
  })

  test('home page shows core sections', async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('domcontentloaded')
    // Use main content area to avoid matching sidebar headings
    const mainContent = page.getByRole('main')
    await expect(mainContent.getByRole('heading', { name: 'Recent Chats' })).toBeVisible({ timeout: 15000 })
    await expect(mainContent.getByRole('heading', { name: 'Characters', exact: true })).toBeVisible()
    await expect(mainContent.getByRole('heading', { name: 'Active Projects' })).toBeVisible()
  })

  test('characters pages load and show seeded character', async ({ page }) => {
    await page.goto('/characters')
    await page.waitForLoadState('domcontentloaded')
    // Use main content to avoid matching sidebar
    const mainContent = page.getByRole('main')
    await expect(mainContent.locator('h1')).toBeVisible({ timeout: 15000 })
    await page.waitForSelector('.character-card', { timeout: 20000 })
    await expect(page.locator('.character-card').filter({ hasText: characterName }).first()).toBeVisible({ timeout: 15000 })

    await page.goto(`/characters/${testCharacterId}/view`)
    await expect(page).toHaveURL(/\/characters\/.+\/view/)
    await expect(page.getByRole('heading', { name: characterName })).toBeVisible({ timeout: 20000 })
    await expect(page.getByRole('button', { name: 'Start Chat' })).toBeVisible()

    await page.goto(`/characters/${testCharacterId}/edit`)
    await page.waitForLoadState('domcontentloaded')
    await expect(page.getByRole('button', { name: 'Save Character' })).toBeVisible({ timeout: 20000 })

    await page.goto('/characters/new')
    await expect(page.getByRole('heading', { name: 'Create Character' })).toBeVisible()
    await expect(page.locator('input[name="name"]')).toBeVisible()
  })

  test('chat pages load and show seeded chat', async ({ page }) => {
    await page.goto('/chats')
    await page.waitForLoadState('domcontentloaded')
    await expect(page).toHaveURL(/\/chats(\?|$)/)
    await expect(page.getByRole('link', { name: 'New Chat' })).toBeVisible({ timeout: 15000 })
    await page.waitForSelector('.chat-card, .chat-empty-state', { timeout: 20000 })
    await expect(page.locator(`a[href="/chats/${testChatId}"]`)).toBeVisible()

    // Navigate to specific chat with retry (chat page can be slow to initialize)
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      await page.goto(`/chats/${testChatId}`)
      await page.waitForLoadState('networkidle')
      try {
        await expect(page.locator('.qt-chat-composer')).toBeVisible({ timeout: 15000 })
        break
      } catch (error) {
        if (attempt === 3) throw error
        console.log(`Chat composer not visible, retrying (attempt ${attempt})...`)
      }
    }

    await page.goto('/chats/new')
    await expect(page.getByRole('heading', { name: 'New Chat' })).toBeVisible()
    await expect(page.getByPlaceholder('Search characters...')).toBeVisible()
  })

  test('settings tabs render core sections', async ({ page }) => {
    await page.goto('/settings')
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible()

    // API Keys tab (default)
    await page.getByRole('button', { name: 'API Keys' }).click()
    await expect(page.getByRole('heading', { name: /Your API Keys/ })).toBeVisible()

    // Connection Profiles tab
    await page.getByRole('button', { name: 'Connection Profiles' }).click()
    await expect(page.getByRole('heading', { name: /Connection Profiles/ }).first()).toBeVisible()

    // Chat Settings tab
    await openSettingsTab(page, 'Chat Settings', 'Message Avatar Display', {
      timeout: 20000,
      errorText: 'Failed to load chat settings',
    })

    // Appearance tab
    await page.getByRole('button', { name: 'Appearance' }).click()
    await expect(page.getByRole('heading', { name: 'Quick Theme Access' })).toBeVisible()

    // Image Profiles tab
    await page.getByRole('button', { name: 'Image Profiles' }).click()
    await expect(page.getByRole('heading', { name: 'Image Generation Profiles' })).toBeVisible()

    // Embedding Profiles tab
    await page.getByRole('button', { name: 'Embedding Profiles' }).click()
    await expect(page.getByRole('heading', { name: 'Embedding Profiles', exact: true })).toBeVisible()

    // Plugins tab
    await page.getByRole('button', { name: 'Plugins' }).click()
    await expect(page.getByRole('heading', { name: 'Plugin Management' })).toBeVisible()

    // File Storage tab
    await page.getByRole('button', { name: 'File Storage' }).click()
    await expect(page.getByRole('heading', { name: 'File Storage' })).toBeVisible()

    // Tags tab
    await page.getByRole('button', { name: 'Tags' }).click()
    await expect(page.getByRole('heading', { name: 'Tag Appearance' })).toBeVisible()

    // RP Templates tab
    await page.getByRole('button', { name: 'RP Templates' }).click()
    await expect(page.getByRole('heading', { name: 'Default Template' })).toBeVisible()

    // Prompts tab
    await page.getByRole('button', { name: 'Prompts' }).click()
    await expect(page.getByRole('heading', { name: 'Sample Prompts' })).toBeVisible()
  })

  test('tools page shows utility cards', async ({ page }) => {
    await page.goto('/tools')
    await expect(page.getByRole('heading', { name: 'Tools' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Backup & Restore' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Import / Export' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Capabilities Report' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Tasks Queue' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Delete All Data' })).toBeVisible()
  })

  test('profile and about pages load', async ({ page }) => {
    // Profile page with retry
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      await page.goto('/profile')
      await page.waitForLoadState('domcontentloaded')
      try {
        await expect(page.getByRole('heading', { name: 'Profile', exact: true })).toBeVisible({ timeout: 10000 })
        break
      } catch (error) {
        if (attempt === 3) throw error
        console.log(`Profile page not loaded, retrying (attempt ${attempt})...`)
      }
    }
    await expect(page.getByRole('heading', { name: 'Account Information' })).toBeVisible({ timeout: 10000 })

    // About page with retry
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      await page.goto('/about')
      await page.waitForLoadState('domcontentloaded')
      try {
        await expect(page.getByRole('heading', { name: /About/ })).toBeVisible({ timeout: 10000 })
        break
      } catch (error) {
        if (attempt === 3) throw error
        console.log(`About page not loaded, retrying (attempt ${attempt})...`)
      }
    }
    await expect(page.getByRole('heading', { name: 'Key Features' })).toBeVisible({ timeout: 10000 })
  })

  test('cleanup: delete test data', async ({ page }) => {
    await testHelper.cleanup(page)
  })
})
