import { test, expect } from '@playwright/test'
import { TestUserHelper } from './helpers/test-user'

/**
 * Integration tests for chat flow
 *
 * Uses the TestUserHelper for full user lifecycle:
 * - Create test user with credentials auth
 * - Set up test data (characters, profiles, chats)
 * - Run tests
 * - Delete test data
 * - Delete test user
 *
 * Note: Tests that require actual LLM responses are marked as placeholders
 * since they would need real API keys or mocked providers.
 */

test.describe('Chat Flow Integration Tests', () => {
  test.describe.configure({ mode: 'serial' })

  const testUser = new TestUserHelper('chat_flow')
  let testCharacterId: string
  let testChatId: string

  const waitForChatComposer = async (page: import('@playwright/test').Page) => {
    const composer = page.locator('.qt-chat-composer')

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      await page.goto(`/chats/${testChatId}`)
      await page.waitForLoadState('domcontentloaded')

      try {
        await composer.waitFor({ state: 'visible', timeout: 20000 })
        return
      } catch (error) {
        if (attempt === 3) {
          throw error
        }
      }
    }
  }

  test('setup: create test user and login', async ({ page }) => {
    await testUser.createAndLogin(page)
  })

  test('should display dashboard when authenticated', async ({ page }) => {
    await testUser.login(page)
    await page.goto('/dashboard')
    await page.waitForLoadState('domcontentloaded')

    // Verify we're on the dashboard, not redirected to signin
    expect(page.url()).not.toContain('/auth/signin')
    expect(page.url()).toContain('/dashboard')
  })

  test('should create a character', async ({ page }) => {
    await testUser.login(page)

    // Navigate to characters page
    await page.goto('/dashboard')
    await page.waitForLoadState('domcontentloaded')

    // Click the "+" button to create a new character
    const createButton = page.locator('a[href="/characters/new"]')
    if (await createButton.isVisible()) {
      await createButton.click()
      await page.waitForURL(/\/characters\/new/)

      // Fill out the character form
      await page.fill('input[name="name"]', 'Chat Flow Test Character')
      await page.fill('textarea[name="description"]', 'A test character for chat flow testing')

      // Save the character
      const saveButton = page.locator('button:has-text("Save"), button:has-text("Create")')
      if (await saveButton.isVisible()) {
        await saveButton.click()
        await page.waitForLoadState('networkidle')
      }
    }

    // Also create via API to ensure we have a character
    testCharacterId = await testUser.createCharacter(page, {
      name: 'API Created Chat Character',
      description: 'Character created via API for chat testing',
      firstMessage: 'Hello! Ready to chat.',
    })

    expect(testCharacterId).toBeTruthy()
  })

  test('should create a chat with a character', async ({ page }) => {
    await testUser.login(page)

    // Create a chat via the helper
    testChatId = await testUser.createChat(page, testCharacterId)
    expect(testChatId).toBeTruthy()

    // Navigate to the chat
    await page.goto(`/chats/${testChatId}`)
    await page.waitForLoadState('domcontentloaded')

    // Verify we're on the chat page
    expect(page.url()).toContain(`/chats/${testChatId}`)

    // Verify the composer is present
    await expect(page.locator('.qt-chat-composer')).toBeVisible({ timeout: 10000 })
  })

  test('should display chat messages container', async ({ page }) => {
    await testUser.login(page)

    await waitForChatComposer(page)

    // Verify the chat messages container exists
    const messagesContainer = page.locator(
      '.qt-chat-messages, [class*="chat-messages"], [class*="messages-container"]'
    )
    await expect(messagesContainer.first()).toBeVisible()
  })

  test('should have message input field', async ({ page }) => {
    await testUser.login(page)

    await waitForChatComposer(page)

    // Verify the message input exists
    const messageInput = page.locator('textarea, input[type="text"]').first()
    await expect(messageInput).toBeVisible()
  })

  test('should have send button', async ({ page }) => {
    await testUser.login(page)

    await waitForChatComposer(page)

    // Verify there's a send button or submit mechanism
    const sendButton = page.locator(
      'button[type="submit"], button:has-text("Send"), button[aria-label*="send"]'
    )
    // Send button may be disabled when input is empty, but should exist
    await expect(sendButton.first()).toBeVisible()
  })

  test('cleanup: delete test data and user', async ({ page }) => {
    await testUser.cleanup(page)
  })
})

/**
 * Tests that require actual LLM responses (future implementation):
 *
 * These tests need either:
 * 1. Real API keys for providers
 * 2. A mock LLM provider
 * 3. Recorded/stubbed responses
 *
 * - Send and receive messages in chat
 * - Edit a message
 * - Delete a message
 * - Generate alternative responses (swipes)
 * - Regenerate response
 *
 * Additional test ideas:
 * - Character import/export (SillyTavern format)
 * - Persona linking
 * - Chat import/export
 * - Connection profile management
 * - Multi-provider testing
 * - Error handling (invalid keys, network errors)
 * - Responsive design (mobile/tablet viewports)
 * - Dark mode
 */
