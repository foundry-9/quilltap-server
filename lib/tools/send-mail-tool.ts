/**
 * Send Mail Tool Definition (The Post Office)
 *
 * Lets a character post a Markdown letter to another character. Suparṇā, of the
 * Post Office, delivers it into the recipient's vault `Mail/` folder; the
 * delivery system stamps the envelope (frontmatter) — the sender writes the body
 * only. The Zod schema is the single source of truth for both runtime
 * validation and the derived OpenAI-format `parameters`.
 */

import { z } from 'zod';
import { zodToOpenAISchema } from './zod-to-openai-schema';

export const sendMailToolInputSchema = z.object({
  character: z
    .string()
    .min(1)
    .describe(
      'The name (or id) of the character you are writing to. Suparṇā will find them by their nameplate; any soul with a postbox may be written to.'
    ),
  message: z
    .string()
    .min(1)
    .describe(
      'Your letter, written in Markdown — the body only. Do not pen any frontmatter or envelope; the Post Office stamps all of that for you.'
    ),
  in_reply_to: z
    .string()
    .min(1)
    .optional()
    .describe(
      'Optional. The file name of a letter in YOUR OWN postbox that you are answering (as list_mail or Suparṇā names it, e.g. "1718370000000-from-ariadne.md"). When supplied, your reply is prefaced with a quoted copy of that original letter.'
    ),
});

export type SendMailToolInput = z.infer<typeof sendMailToolInputSchema>;

export interface SendMailToolOutput {
  success: boolean;
  /** Human-readable, in-voice result for the calling LLM. */
  message: string;
  /** Delivered vault path (in the recipient's mailbox), on success. */
  path?: string;
  error?: string;
}

export const sendMailToolDefinition = {
  type: 'function',
  function: {
    name: 'send_mail',
    description:
      "Post a letter to another character. Suparṇā of the Post Office delivers it into the recipient's mailbox, where it will be announced to them the next time they take the floor. Write the body only — the envelope (sender, date, and such) is stamped for you. Any character may write to any other; read your own letters with read_mail and answer them with send_mail's in_reply_to.",
    parameters: zodToOpenAISchema(sendMailToolInputSchema),
  },
};

export function validateSendMailInput(input: unknown): SendMailToolInput | null {
  const parsed = sendMailToolInputSchema.safeParse(input);
  return parsed.success ? parsed.data : null;
}
