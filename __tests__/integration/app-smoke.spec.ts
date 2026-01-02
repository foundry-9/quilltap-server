import { test, expect } from '@playwright/test'
import { TestUserHelper } from './helpers/test-user'

test.describe('App Smoke Tests', () => {
  test.describe.configure({ mode: 'serial' })

  const testUser = new TestUserHelper('app_smoke')
  const characterName = 'App Smoke Character'
  const personaName = 'App Smoke Persona'
  let testCharacterId: string
  let testPersonaId: string
  let testChatId: string

  const waitForPersonaDetail = async (page: import('@playwright/test').Page) => {
    const nameInput = page.locator('input[name="name"]')

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      await page.goto(`/personas/${testPersonaId}`)
      await page.waitForLoadState('domcontentloaded')

      try {
        await expect(nameInput).toHaveValue(personaName, { timeout: 20000 })
        return
      } catch (error) {
        if (attempt === 3) {
          throw error
        }
      }
    }
  }

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

  test('setup: create test user and seed data', async ({ page }) => {
    await testUser.createAndLogin(page)
    testCharacterId = await testUser.createCharacter(page, {
      name: characterName,
      description: 'A character for smoke testing.',
      firstMessage: 'Hello from the smoke test.',
    })
    testPersonaId = await testUser.createPersona(page, {
      name: personaName,
      description: 'A persona for smoke testing.',
      personalityTraits: 'curious, friendly',
    })
    testChatId = await testUser.createChat(page, testCharacterId)
  })

  test('home page shows core sections', async ({ page }) => {
    await testUser.login(page)
    await page.goto('/')
    await expect(page.getByRole('heading', { name: 'Recent Chats' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Characters', exact: true })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Chats', exact: true })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Personas', exact: true })).toBeVisible()
  })

  test('characters pages load and show seeded character', async ({ page }) => {
    await testUser.login(page)
    await page.goto('/characters')
    await page.waitForLoadState('domcontentloaded')
    await expect(page.getByRole('heading', { name: 'Characters', exact: true })).toBeVisible({ timeout: 15000 })
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

  test('personas pages load and show seeded persona', async ({ page }) => {
    await testUser.login(page)
    await page.goto('/personas')
    await page.waitForLoadState('domcontentloaded')
    await expect(page.getByRole('heading', { name: 'Personas', exact: true })).toBeVisible({ timeout: 15000 })
    await expect(page.getByRole('link', { name: 'Create Persona' }).first()).toBeVisible({ timeout: 15000 })

    await waitForPersonaDetail(page)
    await expect(page.getByRole('heading', { name: personaName })).toBeVisible({ timeout: 20000 })
    await expect(page.getByRole('button', { name: 'Save Persona' })).toBeVisible({ timeout: 20000 })

    await page.goto('/personas/new')
    await expect(page.getByRole('heading', { name: 'Create New Persona' })).toBeVisible()
    await expect(page.locator('input[name="name"]')).toBeVisible()
  })

  test('chat pages load and show seeded chat', async ({ page }) => {
    await testUser.login(page)
    await page.goto('/chats')
    await page.waitForLoadState('domcontentloaded')
    await expect(page).toHaveURL(/\/chats(\?|$)/)
    await expect(page.getByRole('link', { name: 'New Chat' })).toBeVisible({ timeout: 15000 })
    await page.waitForSelector('.chat-card, .chat-empty-state', { timeout: 20000 })
    await expect(page.locator(`a[href="/chats/${testChatId}"]`)).toBeVisible()

    await page.goto(`/chats/${testChatId}`)
    await expect(page.locator('.qt-chat-composer')).toBeVisible({ timeout: 10000 })

    await page.goto('/chats/new')
    await expect(page.getByRole('heading', { name: 'New Chat' })).toBeVisible()
    await expect(page.getByPlaceholder('Search characters...')).toBeVisible()
  })

  test('settings tabs render core sections', async ({ page }) => {
    await testUser.login(page)
    await page.goto('/settings')
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible()

    await page.getByRole('button', { name: 'API Keys' }).click()
    await expect(page.getByRole('heading', { name: /Your API Keys/ })).toBeVisible()

    await page.getByRole('button', { name: 'Connection Profiles' }).click()
    await expect(page.getByRole('heading', { name: /Connection Profiles/ }).first()).toBeVisible()

    await openSettingsTab(page, 'Chat Settings', 'Message Avatar Display', {
      timeout: 20000,
      errorText: 'Failed to load chat settings',
    })

    await page.getByRole('button', { name: 'Appearance' }).click()
    await expect(page.getByRole('heading', { name: 'Quick Theme Access' })).toBeVisible()

    await page.getByRole('button', { name: 'Image Profiles' }).click()
    await expect(page.getByRole('heading', { name: 'Image Generation Profiles' })).toBeVisible()

    await page.getByRole('button', { name: 'Embedding Profiles' }).click()
    await expect(page.getByRole('heading', { name: 'Embedding Profiles', exact: true })).toBeVisible()

    await page.getByRole('button', { name: 'Plugins' }).click()
    await expect(page.getByRole('heading', { name: 'Plugin Management' })).toBeVisible()

    await page.getByRole('button', { name: 'Tags' }).click()
    await expect(page.getByRole('heading', { name: 'Tag Appearance' })).toBeVisible()

    await openSettingsTab(page, 'NPCs', 'Non-Player Characters (NPCs)', {
      errorText: 'Failed to fetch NPCs',
    })

    await page.getByRole('button', { name: 'RP Templates' }).click()
    await expect(page.getByRole('heading', { name: 'Default Template' })).toBeVisible()

    await page.getByRole('button', { name: 'Prompts' }).click()
    await expect(page.getByRole('heading', { name: 'Sample Prompts' })).toBeVisible()

    await page.getByRole('button', { name: 'Sync' }).click()
    await expect(page.getByRole('heading', { name: 'Sync Settings' })).toBeVisible()
  })

  test('tools page shows utility cards', async ({ page }) => {
    await testUser.login(page)
    await page.goto('/tools')
    await expect(page.getByRole('heading', { name: 'Tools' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Backup & Restore' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Import / Export' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Capabilities Report' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Tasks Queue' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Delete All Data' })).toBeVisible()
  })

  test('profile and about pages load', async ({ page }) => {
    await testUser.login(page)
    await page.goto('/profile')
    await expect(page.getByRole('heading', { name: 'Profile', exact: true })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Account Information' })).toBeVisible()

    await page.goto('/about')
    await expect(page.getByRole('heading', { name: /About/ })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Key Features' })).toBeVisible()
  })

  test('cleanup: delete test data and user', async ({ page }) => {
    await testUser.cleanup(page)
  })
})
