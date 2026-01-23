'use client'

/**
 * EphemeralMessage Component
 * Multi-Character Chat System - Phase 5
 *
 * Displays ephemeral (non-persisted) system messages such as:
 * - Nudge notifications: "*[Name] was asked to speak*"
 * - Join notifications: "*[Name] has joined the conversation*"
 *
 * These messages are styled differently from regular messages:
 * - Gray, italic, smaller text
 * - Centered in the chat
 * - Stored in React state only (disappear on reload)
 */

import { useEffect } from 'react'

export type EphemeralMessageType = 'nudge' | 'join' | 'queue' | 'dequeue' | 'system'

export interface EphemeralMessageData {
  id: string
  type: EphemeralMessageType
  participantId: string
  participantName: string
  timestamp: number
  content?: string // Optional custom content override
}

interface EphemeralMessageProps {
  message: EphemeralMessageData
  onDismiss?: (id: string) => void
}

/**
 * Generate default content based on message type
 */
function getDefaultContent(type: EphemeralMessageType, participantName: string): string {
  switch (type) {
    case 'nudge':
      return `${participantName} was asked to speak`
    case 'join':
      return `${participantName} has joined the conversation`
    case 'queue':
      return `${participantName} was added to the queue`
    case 'dequeue':
      return `${participantName} was removed from the queue`
    case 'system':
    default:
      return ''
  }
}

export function EphemeralMessage({ message, onDismiss }: EphemeralMessageProps) {

  const content = message.content || getDefaultContent(message.type, message.participantName)

  if (!content) {
    return null
  }

  return (
    <div className="flex justify-center my-2">
      <div
        className="
          inline-flex items-center gap-2 px-4 py-1.5
          qt-text-xs italic
          bg-muted/50 rounded-full
          animate-in fade-in slide-in-from-bottom-2 duration-300
        "
      >
        <span className="opacity-75">*</span>
        <span>{content}</span>
        <span className="opacity-75">*</span>
        {onDismiss && (
          <button
            onClick={() => onDismiss(message.id)}
            className="ml-1 text-muted-foreground/50 hover:text-muted-foreground transition-colors"
            title="Dismiss"
          >
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>
    </div>
  )
}

/**
 * Helper function to create an ephemeral message
 */
export function createEphemeralMessage(
  type: EphemeralMessageType,
  participantId: string,
  participantName: string,
  content?: string
): EphemeralMessageData {
  return {
    id: `ephemeral-${type}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    type,
    participantId,
    participantName,
    timestamp: Date.now(),
    content,
  }
}

export default EphemeralMessage
