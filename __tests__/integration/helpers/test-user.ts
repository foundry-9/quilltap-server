/**
 * E2E Test User Helper
 *
 * Provides utilities for creating, authenticating, and cleaning up test users
 * in Playwright e2e tests. Uses credentials-based auth (not OAuth).
 *
 * Usage:
 * ```typescript
 * import { TestUserHelper } from './helpers/test-user'
 *
 * test.describe('My Tests', () => {
 *   const testUser = new TestUserHelper('my_test_prefix')
 *
 *   test('setup: create user', async ({ page }) => {
 *     await testUser.createAndLogin(page)
 *   })
 *
 *   test('my actual test', async ({ page }) => {
 *     await testUser.login(page)
 *     // ... test code
 *   })
 *
 *   test('cleanup: delete user', async ({ page }) => {
 *     await testUser.cleanup(page)
 *   })
 * })
 * ```
 */

import { Page, expect } from '@playwright/test'

export interface TestUserCredentials {
  username: string
  password: string
  name: string
}

export interface TestResources {
  characterIds: string[]
  chatIds: string[]
  profileIds: string[]
}

export class TestUserHelper {
  private prefix: string
  public credentials: TestUserCredentials
  public resources: TestResources = {
    characterIds: [],
    chatIds: [],
    profileIds: [],
  }

  constructor(prefix: string = 'e2e_test') {
    // Use a timestamp to ensure uniqueness across parallel test runs
    const timestamp = Date.now()
    this.prefix = `${prefix}_${timestamp}`

    this.credentials = {
      username: `${this.prefix}_user`,
      // Password meets requirements: 8+ chars, uppercase, lowercase, number, special char
      password: 'E2eTest123!',
      name: `${prefix} Test User`,
    }
  }

  /**
   * Create a new test user via signup API
   * Returns true if user was created, false if user already exists
   */
  async signup(page: Page): Promise<boolean> {
    const signupRes = await page.request.post('/api/auth/signup', {
      data: {
        username: this.credentials.username,
        password: this.credentials.password,
        name: this.credentials.name,
      },
    })

    if (signupRes.ok()) {
      console.log(`Created test user: ${this.credentials.username}`)
      return true
    }

    const signupError = await signupRes.json().catch(() => ({}))
    if (signupError.error?.includes('already exists')) {
      console.log(`Test user already exists: ${this.credentials.username}`)
      return false
    }

    console.warn('Signup response:', signupError)
    return false
  }

  /**
   * Login with the test user credentials
   * Throws if login fails
   */
  async login(page: Page): Promise<void> {
    const loginRes = await page.request.post('/api/auth/login', {
      data: {
        username: this.credentials.username,
        password: this.credentials.password,
      },
    })

    if (!loginRes.ok()) {
      const text = await loginRes.text()
      throw new Error(`Login failed: ${loginRes.status()} ${text}`)
    }

    const loginData = await loginRes.json()
    if (!loginData.success) {
      throw new Error(`Login unsuccessful: ${JSON.stringify(loginData)}`)
    }

    console.log(`Logged in as: ${this.credentials.username}`)
  }

  /**
   * Create user if needed and login
   */
  async createAndLogin(page: Page): Promise<void> {
    await this.signup(page)
    await this.login(page)

    // Verify we can access the dashboard
    await page.goto('/dashboard')
    await page.waitForLoadState('domcontentloaded')
    expect(page.url()).not.toContain('/auth/signin')
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
    } = {}
  ): Promise<string> {
    await this.login(page)

    const characterRes = await page.request.post('/api/characters', {
      data: {
        name: options.name || `${this.prefix} Character`,
        description: options.description || 'A character for e2e testing',
        firstMessage: options.firstMessage || 'Hello! I am a test character.',
      },
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
   * Get or create a connection profile for testing
   * Uses Ollama which doesn't require API keys
   */
  async getOrCreateProfile(page: Page): Promise<string> {
    await this.login(page)

    // Check for existing profiles
    const profilesRes = await page.request.get('/api/profiles')
    if (profilesRes.ok()) {
      const profiles = await profilesRes.json()
      if (profiles[0]?.id) {
        console.log(`Using existing profile: ${profiles[0].id}`)
        return profiles[0].id
      }
    }

    // Create a test profile
    const createProfileRes = await page.request.post('/api/profiles', {
      data: {
        name: `${this.prefix} Profile`,
        provider: 'ollama',
        modelName: 'llama2',
        isDefault: true,
      },
    })

    if (!createProfileRes.ok()) {
      const text = await createProfileRes.text()
      throw new Error(`Failed to create profile: ${createProfileRes.status()} ${text}`)
    }

    const profileData = await createProfileRes.json()
    const profileId = profileData.id
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
    await this.login(page)

    const connectionProfileId = profileId || (await this.getOrCreateProfile(page))

    const chatRes = await page.request.post('/api/chats', {
      data: {
        participants: [
          {
            type: 'CHARACTER',
            characterId,
            connectionProfileId,
          },
        ],
      },
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
  async deleteResources(page: Page): Promise<void> {
    await this.login(page)

    // Delete chats
    for (const chatId of this.resources.chatIds) {
      const res = await page.request.delete(`/api/chats/${chatId}`)
      console.log(`Deleted chat: ${chatId}, status: ${res.status()}`)
    }
    this.resources.chatIds = []

    // Delete characters
    for (const characterId of this.resources.characterIds) {
      const res = await page.request.delete(`/api/characters/${characterId}`)
      console.log(`Deleted character: ${characterId}, status: ${res.status()}`)
    }
    this.resources.characterIds = []

    // Delete profiles we created (not pre-existing ones)
    for (const profileId of this.resources.profileIds) {
      const res = await page.request.delete(`/api/profiles/${profileId}`)
      console.log(`Deleted profile: ${profileId}, status: ${res.status()}`)
    }
    this.resources.profileIds = []
  }

  /**
   * Delete the test user account
   */
  async deleteUser(page: Page): Promise<void> {
    await this.login(page)

    const res = await page.request.delete('/api/auth/delete-account')
    if (res.ok()) {
      console.log(`Deleted user: ${this.credentials.username}`)
    } else {
      console.warn(`Failed to delete user: ${res.status()}`)
    }
  }

  /**
   * Full cleanup: delete all resources and then delete the user
   */
  async cleanup(page: Page): Promise<void> {
    await this.deleteResources(page)
    await this.deleteUser(page)
  }
}
