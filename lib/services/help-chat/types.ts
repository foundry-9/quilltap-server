/**
 * Help Chat Service Types
 *
 * Shared interfaces for the help chat service layer.
 */

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

