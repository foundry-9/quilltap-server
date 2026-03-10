/**
 * Whisper Tool Definition
 *
 * Allows LLM characters to send private messages to specific characters
 * in multi-character chats. Only the sender and target can see whispers.
 */

export interface WhisperToolInput {
  /** Character name or alias of the target */
  target: string;
  /** Plain text whisper message content */
  message: string;
}

export interface WhisperToolOutput {
  success: boolean;
  /** Name of the character the whisper was sent to */
  targetName?: string;
  /** Participant ID of the target */
  targetParticipantId?: string;
  error?: string;
}

export const whisperToolDefinition = {
  type: 'function',
  function: {
    name: 'whisper',
    description:
      'Send a private whisper to a specific character. Only you and the target can see this message. Other characters in the chat will not see it. Use this for secrets, private asides, or confidential communication.',
    parameters: {
      type: 'object',
      properties: {
        target: {
          type: 'string',
          description: 'The name or alias of the character you want to whisper to.',
        },
        message: {
          type: 'string',
          description: 'The private message content to send.',
        },
      },
      required: ['target', 'message'],
    },
  },
};

/**
 * Helper to validate tool input parameters
 */
export function validateWhisperInput(input: unknown): input is WhisperToolInput {
  if (typeof input !== 'object' || input === null) return false;
  const obj = input as Record<string, unknown>;
  return typeof obj.target === 'string' && obj.target.length > 0 &&
         typeof obj.message === 'string' && obj.message.length > 0;
}
