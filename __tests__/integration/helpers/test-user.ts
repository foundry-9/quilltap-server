/**
 * E2E Test Helper
 *
 * Provides utilities for creating and cleaning up test data in Playwright e2e tests.
 * Quilltap runs in single-user mode, so no authentication is required.
 *
 * Usage:
 * ```typescript
 * import { TestHelper } from './helpers/test-user'
 *
 * test.describe('My Tests', () => {
 *   const testHelper = new TestHelper('my_test_prefix')
 *
 *   test('setup: create test data', async ({ page }) => {
 *     const characterId = await testHelper.createCharacter(page, { name: 'Test Character' })
 *   })
 *
 *   test('my actual test', async ({ page }) => {
 *     // ... test code
 *   })
 *
 *   test('cleanup: delete test data', async ({ page }) => {
 *     await testHelper.cleanup(page)
 *   })
 * })
 * ```
 */

import { Page, expect } from '@playwright/test'

export interface TestResources {
  characterIds: string[]
  chatIds: string[]
  profileIds: string[]
}

/**
 * Helper class for managing test resources.
 * Renamed from TestUserHelper since there's no user management in single-user mode.
 */
export class TestHelper {
  private prefix: string
  public resources: TestResources = {
    characterIds: [],
    chatIds: [],
    profileIds: [],
  }

  constructor(prefix: string = 'e2e_test') {
    // Use a timestamp to ensure uniqueness across test runs
    const timestamp = Date.now()
    this.prefix = `${prefix}_${timestamp}`
  }

  private async postWithRetry(
    page: Page,
    url: string,
    data: Record<string, unknown>,
    maxAttempts: number = 5
  ) {
    let lastResponse: Awaited<ReturnType<Page['request']['post']>> | null = null

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const response = await page.request.post(url, { data })
      lastResponse = response

      const status = response.status()
      if (status !== 429 && status !== 503) {
        return response
      }

      await page.waitForTimeout(2000 * attempt)
    }

    if (!lastResponse) {
      throw new Error(`Failed to POST ${url}`)
    }

    return lastResponse
  }

  private async deleteWithRetry(
    page: Page,
    url: string,
    maxAttempts: number = 5
  ) {
    let lastResponse: Awaited<ReturnType<Page['request']['delete']>> | null = null

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const response = await page.request.delete(url)
      lastResponse = response

      const status = response.status()
      if (status !== 429 && status !== 503) {
        return response
      }

      await page.waitForTimeout(2000 * attempt)
    }

    if (!lastResponse) {
      throw new Error(`Failed to DELETE ${url}`)
    }

    return lastResponse
  }

  /**
   * Navigate to the app and wait for it to load.
   * In single-user mode, no login is required.
   */
  async ensureReady(page: Page): Promise<void> {
    await page.goto('/')
    await page.waitForLoadState('domcontentloaded')
    // Verify we're on the home page
    expect(page.url()).not.toContain('/auth/')
  }

  /**
   * Create a test character
   */
  async createCharacter(
    page: Page,
    options: {
      name?: string
      description?: string
      firstMessage?: string
      controlledBy?: 'ai' | 'user'
    } = {}
  ): Promise<string> {
    const characterRes = await this.postWithRetry(page, '/api/v1/characters', {
      name: options.name || `${this.prefix} Character`,
      description: options.description || 'A character for e2e testing',
      firstMessage: options.firstMessage || 'Hello! I am a test character.',
      controlledBy: options.controlledBy || 'ai',
    })

    if (!characterRes.ok()) {
      const text = await characterRes.text()
      throw new Error(`Failed to create character: ${characterRes.status()} ${text}`)
    }

    const characterData = await characterRes.json()
    const characterId = characterData.character?.id || characterData.id
    this.resources.characterIds.push(characterId)
    console.log(`Created test character: ${characterId}`)

    return characterId
  }

  /**
   * Get or create a connection profile for testing.
   * Uses Ollama by default since it doesn't require API keys.
   */
  async getOrCreateProfile(
    page: Page,
    options: {
      provider?: string
      modelName?: string
    } = {}
  ): Promise<string> {
    // Check for existing profiles
    const profilesRes = await page.request.get('/api/v1/connection-profiles')
    if (profilesRes.ok()) {
      const data = await profilesRes.json()
      const profiles = data.profiles || data
      if (Array.isArray(profiles) && profiles[0]?.id) {
        console.log(`Using existing profile: ${profiles[0].id}`)
        return profiles[0].id
      }
    }

    // Create a test profile using Ollama
    const createProfileRes = await this.postWithRetry(page, '/api/v1/connection-profiles', {
      name: `${this.prefix} Profile`,
      provider: options.provider || 'ollama',
      modelName: options.modelName || 'llama3.2',
      isDefault: true,
    })

    if (!createProfileRes.ok()) {
      const text = await createProfileRes.text()
      throw new Error(`Failed to create profile: ${createProfileRes.status()} ${text}`)
    }

    const profileData = await createProfileRes.json()
    const profileId = profileData.profile?.id || profileData.id
    this.resources.profileIds.push(profileId)
    console.log(`Created test profile: ${profileId}`)

    return profileId
  }

  /**
   * Create a test chat
   */
  async createChat(
    page: Page,
    characterId: string,
    profileId?: string
  ): Promise<string> {
    const connectionProfileId = profileId || (await this.getOrCreateProfile(page))

    const chatRes = await this.postWithRetry(page, '/api/v1/chats', {
      participants: [
        {
          type: 'CHARACTER',
          characterId,
          connectionProfileId,
        },
      ],
    })

    if (!chatRes.ok()) {
      const text = await chatRes.text()
      throw new Error(`Failed to create chat: ${chatRes.status()} ${text}`)
    }

    const chatData = await chatRes.json()
    const chatId = chatData.chat?.id || chatData.id
    this.resources.chatIds.push(chatId)
    console.log(`Created test chat: ${chatId}`)

    return chatId
  }

  /**
   * Delete all test resources created during tests
   */
  async cleanup(page: Page): Promise<void> {
    // Delete chats
    for (const chatId of this.resources.chatIds) {
      const res = await this.deleteWithRetry(page, `/api/v1/chats/${chatId}`)
      console.log(`Deleted chat: ${chatId}, status: ${res.status()}`)
    }
    this.resources.chatIds = []

    // Delete characters
    for (const characterId of this.resources.characterIds) {
      const res = await this.deleteWithRetry(page, `/api/v1/characters/${characterId}`)
      console.log(`Deleted character: ${characterId}, status: ${res.status()}`)
    }
    this.resources.characterIds = []

    // Delete profiles we created (not pre-existing ones)
    for (const profileId of this.resources.profileIds) {
      const res = await this.deleteWithRetry(page, `/api/v1/connection-profiles/${profileId}`)
      console.log(`Deleted profile: ${profileId}, status: ${res.status()}`)
    }
    this.resources.profileIds = []
  }
}

// Export with old name for backward compatibility during migration
export { TestHelper as TestUserHelper }
