/**
 * Unit tests for alert dialog utility
 */

import { showAlert } from '@/lib/alert'
import { createRoot } from 'react-dom/client'

// Mock react-dom/client
jest.mock('react-dom/client', () => ({
  createRoot: jest.fn(),
}))

// Create a mock for AlertDialog that we can inspect
const mockAlertDialog = jest.fn()

// Mock the AlertDialog component
jest.mock('@/components/alert-dialog', () => ({
  AlertDialog: (props: any) => {
    mockAlertDialog(props)
    return null
  },
}))

describe('Alert Dialog Utility', () => {
  let mockRoot: any
  let mockContainer: HTMLElement
  let rootCallCount: number

  beforeEach(() => {
    rootCallCount = 0
    // Create mock root with immediate rendering
    mockRoot = {
      render: jest.fn((element) => {
        // Extract props from the React element and call the mock
        if (element && element.props) {
          mockAlertDialog(element.props)
        }
      }),
      unmount: jest.fn(),
    }

    // Mock createRoot to return our mock root
    ;(createRoot as jest.Mock).mockImplementation(() => {
      rootCallCount++
      return mockRoot
    })

    // Clear any previous containers
    document.body.innerHTML = ''

    // Clear mocks
    mockAlertDialog.mockClear()
  })

  afterEach(() => {
    jest.clearAllMocks()
  })

  // Helper function to extract buttons from dialog render call
  describe('showAlert', () => {
    // The dialog is a BaseModal, which draws its own backdrop, so one
    // container and one root carry the whole thing.
    it('mounts one container on the body and renders the dialog into it', () => {
      showAlert('Test message')

      expect(document.body.children.length).toBe(1)
      expect((document.body.children[0] as HTMLElement).getAttribute('role')).toBe('alert-dialog-content')
      expect(createRoot).toHaveBeenCalledTimes(1)
      expect(mockRoot.render).toHaveBeenCalledTimes(1)
    })

    it.each([
      ['empty', ''],
      ['long', 'A'.repeat(1000)],
      ['special-character', '<script>alert("xss")</script>\n\t"quotes"'],
    ])('passes %s messages through to the dialog', (_label, message) => {
      showAlert(message)

      expect(mockRoot.render).toHaveBeenCalledTimes(1)
      expect(mockAlertDialog).toHaveBeenCalledWith(expect.objectContaining({ message }))
    })

    it('unmounts and removes its container when the dialog closes', async () => {
      const result = showAlert('Bye', ['OK'])
      const { onClose } = mockAlertDialog.mock.calls[0][0]
      onClose('OK')

      await expect(result).resolves.toBe('OK')
      expect(mockRoot.unmount).toHaveBeenCalledTimes(1)
      expect(document.body.children.length).toBe(0)
    })
  })
})
