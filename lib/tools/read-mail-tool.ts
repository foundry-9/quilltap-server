/**
 * Read Mail Tool Definition (The Post Office)
 *
 * Reads one letter from the CALLER's own mailbox, named by its bare file name.
 * The handler puts the `Mail/` folder on it and reads the caller's own vault
 * directly, so a character who keeps the Staff at arm's length (no
 * `systemTransparency`, hence no `doc_*` access to its own vault) can still
 * read its post. The Zod schema is the single source of truth for both
 * runtime validation and the derived OpenAI-format `parameters`.
 */

import { z } from 'zod';
import { zodToOpenAISchema } from './zod-to-openai-schema';

export const readMailToolInputSchema = z.object({
  letter: z
    .string()
    .min(1)
    .describe(
      'The letter\'s file name, exactly as list_mail or Suparṇā named it (e.g. "1718370000000-from-ariadne.md"). Just the name — no folder or path; the Post Office knows where your postbox is.'
    ),
});

export type ReadMailToolInput = z.infer<typeof readMailToolInputSchema>;

export interface ReadMailToolOutput {
  success: boolean;
  /** Human-readable, in-voice letter (or refusal) for the calling LLM. */
  text: string;
  /** Vault-relative path of the letter read, on success. */
  path?: string;
  error?: string;
}

export const readMailToolDefinition = {
  type: 'function',
  function: {
    name: 'read_mail',
    description:
      'Read a letter from your own mailbox, by its file name. Only ever reads your own postbox; use list_mail to see what is waiting.',
    parameters: zodToOpenAISchema(readMailToolInputSchema),
  },
};

export function validateReadMailInput(input: unknown): ReadMailToolInput | null {
  const parsed = readMailToolInputSchema.safeParse(input);
  return parsed.success ? parsed.data : null;
}
