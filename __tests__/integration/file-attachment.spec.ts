import { test, expect } from '@playwright/test'
import { TestUserHelper } from './helpers/test-user'

/**
 * E2E tests for file attachment functionality
 *
 * Uses the TestUserHelper for full user lifecycle:
 * - Create test user
 * - Set up test data (character, chat)
 * - Run tests
 * - Delete test data
 * - Delete test user
 */

test.describe('File Attachment', () => {
  test.describe.configure({ mode: 'serial' })

  const testUser = new TestUserHelper('file_attach')
  let testCharacterId: string
  let testChatId: string

  test('setup: create test user and login', async ({ page }) => {
    await testUser.createAndLogin(page)
  })

  test('setup: create test character and chat', async ({ page }) => {
    testCharacterId = await testUser.createCharacter(page, {
      name: 'File Attach Test Character',
      description: 'A character for testing file attachments',
      firstMessage: 'Hello! I am ready to test file attachments.',
    })

    testChatId = await testUser.createChat(page, testCharacterId)
  })

  test('attach button should open file picker', async ({ page }) => {
    await testUser.login(page)

    // Navigate to the chat
    await page.goto(`/chats/${testChatId}`)
    await page.waitForSelector('.qt-chat-composer', { timeout: 10000 })

    // Open the tool palette
    const toolsButton = page.locator('button.qt-desktop-only[title="Tools"]')
    await toolsButton.click()
    await page.waitForSelector('.qt-tool-palette-bar')

    // Set up file chooser listener BEFORE clicking
    const fileChooserPromise = page.waitForEvent('filechooser', { timeout: 5000 })

    // Click attach
    await page.locator('.qt-tool-palette-bar button:has-text("Attach")').click()

    // Verify file picker opened
    const fileChooser = await fileChooserPromise
    expect(fileChooser).toBeTruthy()
    console.log('File picker opened successfully!')
  })

  test('can select and display attached file', async ({ page }) => {
    await testUser.login(page)

    // Navigate to the chat
    await page.goto(`/chats/${testChatId}`)
    await page.waitForSelector('.qt-chat-composer', { timeout: 10000 })

    // Open tool palette and trigger file picker
    await page.locator('button.qt-desktop-only[title="Tools"]').click()
    await page.waitForSelector('.qt-tool-palette-bar')

    const fileChooserPromise = page.waitForEvent('filechooser')
    await page.locator('.qt-tool-palette-bar button:has-text("Attach")').click()

    // Select a file
    const fileChooser = await fileChooserPromise
    await fileChooser.setFiles({
      name: 'test-file.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('This is test content for e2e testing.'),
    })

    // Wait for file processing and verify it appears in attachment area
    // Use a longer timeout as file processing can vary
    const attachmentChip = page.locator('.qt-chat-attachment-chip').first()
    await expect(attachmentChip).toBeVisible({ timeout: 10000 })

    // Also verify the attachment list container is visible
    await expect(page.locator('.qt-chat-attachment-list')).toBeVisible()
    console.log('File attached and displayed successfully!')
  })

  test('cleanup: delete test data and user', async ({ page }) => {
    await testUser.cleanup(page)
  })
})
