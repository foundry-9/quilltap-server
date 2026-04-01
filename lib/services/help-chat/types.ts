/**
 * Help Chat Service Types
 *
 * Shared interfaces for the help chat service layer.
 */

/**
 * Options for creating a help chat
 */
export interface HelpChatCreateOptions {
  /** Character IDs to participate in the help chat */
  characterIds: string[]
  /** Current page URL for context resolution */
  pageUrl: string
  /** Optional initial question to ask */
  initialQuestion?: string
}

/**
 * Options for sending a help chat message
 */
export interface HelpChatSendOptions {
  /** User message content */
  content: string
  /** Optional file IDs attached to the message */
  fileIds?: string[]
}

/**
 * Options for updating help chat page context
 */
export interface HelpChatUpdateContextOptions {
  /** New page URL */
  pageUrl: string
}

/**
 * Eligibility information for a character in help chats
 */
export interface HelpChatEligibleCharacter {
  id: string
  name: string
  avatarUrl: string | null
  defaultHelpToolsEnabled: boolean
  connectionProfileId: string | null
  hasToolCapableProfile: boolean
  supportsImages: boolean
}

/**
 * Result of eligibility check
 */
export interface HelpChatEligibilityResult {
  eligible: boolean
  characters: HelpChatEligibleCharacter[]
  reasons: string[]
}
