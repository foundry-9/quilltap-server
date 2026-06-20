/**
 * Brahma Console Service Types
 *
 * Shared interfaces for the Brahma Console service layer.
 */

/**
 * Options for sending a Brahma Console message.
 */
export interface BrahmaConsoleSendOptions {
  /** User message content */
  content: string
  /** Optional file IDs attached to the message */
  fileIds?: string[]
}
