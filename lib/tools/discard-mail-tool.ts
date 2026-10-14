/**
 * Discard Mail Tool Definition (The Post Office)
 *
 * Discards one letter from the CALLER's own mailbox, named by its bare file
 * name. Like `read_mail`, the handler reaches the caller's own vault directly,
 * so a character without `systemTransparency` can still throw away its post.
 * The Zod schema is the single source of truth for both runtime validation and
 * the derived OpenAI-format `parameters`.
 */

import { z } from 'zod';
import { zodToOpenAISchema } from './zod-to-openai-schema';

export const discardMailToolInputSchema = z.object({
  letter: z
    .string()
    .min(1)
    .describe(
      'The letter\'s file name, exactly as list_mail or Suparṇā named it (e.g. "1718370000000-from-ariadne.md"). Just the name — no folder or path; the Post Office knows where your postbox is.'
    ),
});

export type DiscardMailToolInput = z.infer<typeof discardMailToolInputSchema>;

export interface DiscardMailToolOutput {
  success: boolean;
  /** Human-readable, in-voice result for the calling LLM. */
  message: string;
  /** Vault-relative path of the letter discarded, on success. */
  path?: string;
  error?: string;
}

export const discardMailToolDefinition = {
  type: 'function',
  function: {
    name: 'discard_mail',
    description:
      'Throw away a letter from your own mailbox, by its file name. This cannot be undone. Only ever touches your own postbox; use list_mail to see what is there.',
    parameters: zodToOpenAISchema(discardMailToolInputSchema),
  },
};

export function validateDiscardMailInput(input: unknown): DiscardMailToolInput | null {
  const parsed = discardMailToolInputSchema.safeParse(input);
  return parsed.success ? parsed.data : null;
}
