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
  personaIds: string[]
}

export class TestUserHelper {
  private prefix: string
  private authDisabled: boolean | null = null
  public credentials: TestUserCredentials
  public resources: TestResources = {
    characterIds: [],
    chatIds: [],
    profileIds: [],
    personaIds: [],
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

  private async isAuthDisabled(page: Page): Promise<boolean> {
    if (this.authDisabled !== null) {
      return this.authDisabled
    }

    try {
      const res = await page.request.get('/api/auth/status')
      if (res.ok()) {
        const data = await res.json()
        this.authDisabled = Boolean(data?.authDisabled)
        return this.authDisabled
      }
    } catch (err) {
      console.warn('Failed to fetch auth status, assuming auth enabled')
    }

    this.authDisabled = false
    return this.authDisabled
  }

  private async ensureAuthSession(page: Page): Promise<void> {
    if (await this.isAuthDisabled(page)) {
      await page.goto('/')
      await page.waitForLoadState('domcontentloaded')
    }
  }

  private async ensureBrowserSessionCookie(page: Page, setCookieHeader?: string): Promise<void> {
    if (!setCookieHeader) return

    const match = setCookieHeader.match(/qt_session=([^;]+)/)
    if (!match) return

    const baseUrl = process.env.BASE_URL || 'http://localhost:3000'
    let cookieUrl: string | null = null
    try {
      cookieUrl = new URL(baseUrl).toString()
    } catch {
      cookieUrl = null
    }

    if (!cookieUrl) return

    await page.context().addCookies([
      {
        name: 'qt_session',
        value: match[1],
        url: cookieUrl,
        httpOnly: true,
        sameSite: 'Lax',
      },
    ])
  }

  private async postWithRetry(
    page: Page,
    url: string,
    data: Record<string, unknown>,
    maxAttempts: number = 5
  ) {
    let lastResponse: ReturnType<Page['request']['post']> | null = null

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const response = await page.request.post(url, { data })
      lastResponse = response

      const status = response.status()
      if (status !== 401 && status !== 429 && status !== 503) {
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
    let lastResponse: ReturnType<Page['request']['delete']> | null = null

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const response = await page.request.delete(url)
      lastResponse = response

      const status = response.status()
      if (status !== 401 && status !== 429 && status !== 503) {
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
   * Create a new test user via signup API
   * Returns true if user was created, false if user already exists
   */
  async signup(page: Page): Promise<boolean> {
    if (await this.isAuthDisabled(page)) {
      console.log('Auth disabled - skipping user signup')
      return false
    }

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
    if (await this.isAuthDisabled(page)) {
      await this.ensureAuthSession(page)
      return
    }

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

    await this.ensureBrowserSessionCookie(page, loginRes.headers()['set-cookie'])

    console.log(`Logged in as: ${this.credentials.username}`)
  }

  /**
   * Create user if needed and login
   */
  async createAndLogin(page: Page): Promise<void> {
    if (await this.isAuthDisabled(page)) {
      await this.ensureAuthSession(page)
      return
    }

    await this.signup(page)
    await this.login(page)

    // Verify we can access the home page
    await page.goto('/')
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

    const characterRes = await this.postWithRetry(page, '/api/characters', {
      name: options.name || `${this.prefix} Character`,
      description: options.description || 'A character for e2e testing',
      firstMessage: options.firstMessage || 'Hello! I am a test character.',
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
   * Create a test persona
   */
  async createPersona(
    page: Page,
    options: {
      name?: string
      title?: string
      description?: string
      personalityTraits?: string
    } = {}
  ): Promise<string> {
    await this.login(page)

    const personaRes = await this.postWithRetry(page, '/api/personas', {
      name: options.name || `${this.prefix} Persona`,
      title: options.title || 'Test Persona',
      description: options.description || 'A persona for e2e testing',
      personalityTraits: options.personalityTraits || 'curious, friendly',
    })

    if (!personaRes.ok()) {
      const text = await personaRes.text()
      throw new Error(`Failed to create persona: ${personaRes.status()} ${text}`)
    }

    const personaData = await personaRes.json()
    const personaId = personaData.id
    this.resources.personaIds.push(personaId)
    console.log(`Created test persona: ${personaId}`)

    return personaId
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

    const chatRes = await this.postWithRetry(page, '/api/chats', {
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
  async deleteResources(page: Page): Promise<void> {
    await this.login(page)

    // Delete chats
    for (const chatId of this.resources.chatIds) {
      const res = await this.deleteWithRetry(page, `/api/chats/${chatId}`)
      console.log(`Deleted chat: ${chatId}, status: ${res.status()}`)
    }
    this.resources.chatIds = []

    // Delete characters
    for (const characterId of this.resources.characterIds) {
      const res = await this.deleteWithRetry(page, `/api/characters/${characterId}`)
      console.log(`Deleted character: ${characterId}, status: ${res.status()}`)
    }
    this.resources.characterIds = []

    // Delete profiles we created (not pre-existing ones)
    for (const profileId of this.resources.profileIds) {
      const res = await this.deleteWithRetry(page, `/api/profiles/${profileId}`)
      console.log(`Deleted profile: ${profileId}, status: ${res.status()}`)
    }
    this.resources.profileIds = []

    // Delete personas
    for (const personaId of this.resources.personaIds) {
      const res = await this.deleteWithRetry(page, `/api/personas/${personaId}`)
      console.log(`Deleted persona: ${personaId}, status: ${res.status()}`)
    }
    this.resources.personaIds = []
  }

  /**
   * Delete the test user account
   */
  async deleteUser(page: Page): Promise<void> {
    if (await this.isAuthDisabled(page)) {
      console.log('Auth disabled - skipping test user deletion')
      return
    }

    await this.login(page)

    const res = await this.deleteWithRetry(page, '/api/auth/delete-account')
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
