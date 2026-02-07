import { test, expect } from '@playwright/test'
import { TestHelper } from './helpers/test-user'

/**
 * Integration tests for chat flow
 *
 * Tests the basic chat functionality:
 * - Character creation
 * - Chat creation with character
 * - Chat UI elements (composer, messages, send button)
 *
 * Note: Tests that require actual LLM responses would need Ollama running
 * with an available model, or a mock provider.
 */

test.describe('Chat Flow Integration Tests', () => {
  test.describe.configure({ mode: 'serial' })

  const testHelper = new TestHelper('chat_flow')
  let testCharacterId: string
  let testChatId: string

  const waitForChatComposer = async (page: import('@playwright/test').Page) => {
    const composer = page.locator('.qt-chat-composer')

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      await page.goto(`/salon/${testChatId}`)
      await page.waitForLoadState('domcontentloaded')

      try {
        await composer.waitFor({ state: 'visible', timeout: 30000 })
        return
      } catch (error) {
        if (attempt === 3) {
          throw error
        }
      }
    }
  }

  test('setup: seed test data', async ({ page }) => {
    await testHelper.ensureReady(page)
  })

  test('should display home page', async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('domcontentloaded')

    // Verify we're on the home page
    expect(page.url()).not.toContain('/auth/')
    await expect(page.getByRole('heading', { name: 'Recent Chats' })).toBeVisible({ timeout: 15000 })
  })

  test('should create a character', async ({ page }) => {
    // Navigate to characters page
    await page.goto('/')
    await page.waitForLoadState('domcontentloaded')

    // Click the "+" button to create a new character
    const createButton = page.locator('a[href="/aurora/new"]')
    if (await createButton.isVisible()) {
      await createButton.click()
      await page.waitForURL(/\/aurora\/new/)

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
    testCharacterId = await testHelper.createCharacter(page, {
      name: 'API Created Chat Character',
      description: 'Character created via API for chat testing',
      firstMessage: 'Hello! Ready to chat.',
    })

    expect(testCharacterId).toBeTruthy()
  })

  test('should create a chat with a character', async ({ page }) => {
    // Create a chat via the helper
    testChatId = await testHelper.createChat(page, testCharacterId)
    expect(testChatId).toBeTruthy()

    // Navigate to the chat
    await page.goto(`/salon/${testChatId}`)
    await page.waitForLoadState('domcontentloaded')

    // Verify we're on the chat page
    expect(page.url()).toContain(`/salon/${testChatId}`)

    // Verify the composer is present
    await expect(page.locator('.qt-chat-composer')).toBeVisible({ timeout: 10000 })
  })

  test('should display chat messages container', async ({ page }) => {
    await waitForChatComposer(page)

    // Verify the chat messages container exists
    const messagesContainer = page.locator(
      '.qt-chat-messages, [class*="chat-messages"], [class*="messages-container"]'
    )
    await expect(messagesContainer.first()).toBeVisible()
  })

  test('should have message input field', async ({ page }) => {
    await waitForChatComposer(page)

    // Verify the message input exists
    const messageInput = page.locator('textarea, input[type="text"]').first()
    await expect(messageInput).toBeVisible()
  })

  test('should have send button', async ({ page }) => {
    await waitForChatComposer(page)

    // Verify there's a send button or submit mechanism
    const sendButton = page.locator(
      'button[type="submit"], button:has-text("Send"), button[aria-label*="send"]'
    )
    // Send button may be disabled when input is empty, but should exist
    await expect(sendButton.first()).toBeVisible()
  })

  test('cleanup: delete test data', async ({ page }) => {
    await testHelper.cleanup(page)
  })
})

/**
 * Tests that require actual LLM responses (future implementation):
 *
 * These tests need Ollama running with a model like llama3.2 available.
 *
 * - Send and receive messages in chat
 * - Edit a message
 * - Delete a message
 * - Generate alternative responses (swipes)
 * - Regenerate response
 *
 * Additional test ideas:
 * - Character import/export (SillyTavern format)
 * - Chat import/export
 * - Connection profile management
 * - Multi-provider testing
 * - Error handling (invalid keys, network errors)
 * - Responsive design (mobile/tablet viewports)
 * - Dark mode
 */
