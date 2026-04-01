import { test, expect } from '@playwright/test'
import { TestHelper } from './helpers/test-user'

/**
 * E2E tests for file attachment functionality
 *
 * Tests the file attachment UI in chat:
 * - Opening file picker via attach button
 * - Selecting and displaying attached files
 */

test.describe('File Attachment', () => {
  test.describe.configure({ mode: 'serial' })

  const testHelper = new TestHelper('file_attach')
  let testCharacterId: string
  let testChatId: string

  const navigateToChatWithRetry = async (page: import('@playwright/test').Page) => {
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      await page.goto(`/salon/${testChatId}`)
      await page.waitForLoadState('networkidle')
      try {
        await page.waitForSelector('.qt-chat-composer', { state: 'visible', timeout: 15000 })
        return
      } catch (error) {
        if (attempt === 3) throw error
        console.log(`Chat composer not visible, retrying (attempt ${attempt})...`)
      }
    }
  }

  test('setup: seed test data', async ({ page }) => {
    await testHelper.ensureReady(page)
  })

  test('setup: create test character and chat', async ({ page }) => {
    testCharacterId = await testHelper.createCharacter(page, {
      name: 'File Attach Test Character',
      description: 'A character for testing file attachments',
      firstMessage: 'Hello! I am ready to test file attachments.',
    })

    testChatId = await testHelper.createChat(page, testCharacterId)
  })

  test('attach button should open file picker', async ({ page }) => {
    // Navigate to the chat with retry
    await navigateToChatWithRetry(page)

    // Open the tool palette
    const toolsButton = page.locator('button[title="Tools"]')
    await toolsButton.click()
    await page.waitForSelector('.qt-tool-palette-bar', { timeout: 10000 })

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
    // Navigate to the chat with retry
    await navigateToChatWithRetry(page)

    // Open tool palette and trigger file picker
    await page.locator('button[title="Tools"]').click()
    await page.waitForSelector('.qt-tool-palette-bar', { timeout: 10000 })

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

  test('cleanup: delete test data', async ({ page }) => {
    await testHelper.cleanup(page)
  })
})
