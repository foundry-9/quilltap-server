/**
 * Unit tests for Message Navigation Utilities
 * Tests the message navigation functions for scrolling and highlighting.
 *
 * @jest-environment jsdom
 */

import { describe, it, expect, beforeEach, jest, afterEach } from '@jest/globals'


describe('Message Navigation Utilities', () => {
  // Import functions after mocks are set up
  let requestMessageReveal: typeof import('@/lib/chat/message-navigation').requestMessageReveal
  let takePendingMessageReveal: typeof import('@/lib/chat/message-navigation').takePendingMessageReveal
  let revealRequestFromSalonHref: typeof import('@/lib/chat/message-navigation').revealRequestFromSalonHref
  let MESSAGE_REVEAL_EVENT: string
  let scrollToMessage: typeof import('@/lib/chat/message-navigation').scrollToMessage

  beforeEach(() => {
    jest.clearAllMocks()
    jest.useFakeTimers()

    // Clear sessionStorage
    sessionStorage.clear()

    // Fresh import for each test
    jest.isolateModules(() => {
      const navModule = require('@/lib/chat/message-navigation')
      requestMessageReveal = navModule.requestMessageReveal
      takePendingMessageReveal = navModule.takePendingMessageReveal
      revealRequestFromSalonHref = navModule.revealRequestFromSalonHref
      MESSAGE_REVEAL_EVENT = navModule.MESSAGE_REVEAL_EVENT
      scrollToMessage = navModule.scrollToMessage
    })
  })

  afterEach(() => {
    jest.useRealTimers()
    jest.restoreAllMocks()
  })

  // ============================================================================
  // Reveal requests (`?msg=` links)
  // ============================================================================
  describe('requestMessageReveal / takePendingMessageReveal', () => {
    it('is taken once, by the chat it names', () => {
      requestMessageReveal('chat-a', 'msg-1')

      expect(takePendingMessageReveal('chat-b')).toBeNull()
      expect(takePendingMessageReveal('chat-a')).toBe('msg-1')
      expect(takePendingMessageReveal('chat-a')).toBeNull()
    })

    it('announces the request to an open Salon', () => {
      const listener = jest.fn()
      window.addEventListener(MESSAGE_REVEAL_EVENT, listener)
      requestMessageReveal('chat-a', 'msg-1')
      window.removeEventListener(MESSAGE_REVEAL_EVENT, listener)

      expect(listener).toHaveBeenCalledTimes(1)
      expect((listener.mock.calls[0][0] as CustomEvent).detail).toEqual({ chatId: 'chat-a', messageId: 'msg-1' })
    })

    it('replaces an earlier request', () => {
      requestMessageReveal('chat-a', 'msg-1')
      requestMessageReveal('chat-a', 'msg-2')

      expect(takePendingMessageReveal('chat-a')).toBe('msg-2')
    })

    it('discards a malformed stored request', () => {
      sessionStorage.setItem('pendingMessageReveal', '{not json')

      expect(takePendingMessageReveal('chat-a')).toBeNull()
      expect(sessionStorage.getItem('pendingMessageReveal')).toBeNull()
    })
  })

  describe('revealRequestFromSalonHref', () => {
    it('reads the chat and message from a Message search result link', () => {
      expect(revealRequestFromSalonHref('/salon/chat-a?msg=msg-1')).toEqual({ chatId: 'chat-a', messageId: 'msg-1' })
      expect(revealRequestFromSalonHref('/salon/chat-a/?x=1&msg=msg-1')).toEqual({ chatId: 'chat-a', messageId: 'msg-1' })
    })

    it('returns null for links without a message', () => {
      expect(revealRequestFromSalonHref('/salon/chat-a')).toBeNull()
      expect(revealRequestFromSalonHref('/salon/chat-a?tab=x')).toBeNull()
      expect(revealRequestFromSalonHref('/salon/new?msg=m')).toBeNull()
      expect(revealRequestFromSalonHref('/aurora/x?msg=m')).toBeNull()
    })
  })

  // ============================================================================
  // scrollToMessage Tests
  // ============================================================================
  describe('scrollToMessage', () => {
    let mockElement: HTMLDivElement

    beforeEach(() => {
      mockElement = document.createElement('div')
      mockElement.setAttribute('data-message-id', 'msg-123')
      mockElement.scrollIntoView = jest.fn()
      document.body.appendChild(mockElement)
    })

    afterEach(() => {
      document.body.innerHTML = ''
    })

    it('should scroll to message element', () => {
      const result = scrollToMessage('msg-123')

      expect(result).toBe(true)
      expect(mockElement.scrollIntoView).toHaveBeenCalledWith({
        behavior: 'smooth',
        block: 'center',
      })
    })

    it('should add highlight class when highlight is true', () => {
      scrollToMessage('msg-123', { highlight: true })

      expect(mockElement.classList.contains('qt-memory-source-highlight')).toBe(true)
    })

    it('should remove highlight class after duration', () => {
      scrollToMessage('msg-123', { highlight: true, highlightDuration: 3000 })

      expect(mockElement.classList.contains('qt-memory-source-highlight')).toBe(true)

      jest.advanceTimersByTime(3000)

      expect(mockElement.classList.contains('qt-memory-source-highlight')).toBe(false)
    })

    it('should use custom scroll behavior', () => {
      scrollToMessage('msg-123', { behavior: 'instant' })

      expect(mockElement.scrollIntoView).toHaveBeenCalledWith({
        behavior: 'instant',
        block: 'center',
      })
    })

    it('should skip highlight when highlight is false', () => {
      scrollToMessage('msg-123', { highlight: false })

      expect(mockElement.classList.contains('qt-memory-source-highlight')).toBe(false)
    })

    it('should return false when element not found', () => {
      const result = scrollToMessage('nonexistent')

      expect(result).toBe(false)
    })

    it('should scroll to message successfully', () => {
      const result = scrollToMessage('msg-123')

      expect(result).toBe(true)
    })

    it('should use default highlight duration of 3000ms', () => {
      scrollToMessage('msg-123')

      jest.advanceTimersByTime(2999)
      expect(mockElement.classList.contains('qt-memory-source-highlight')).toBe(true)

      jest.advanceTimersByTime(1)
      expect(mockElement.classList.contains('qt-memory-source-highlight')).toBe(false)
    })
  })
})
