/**
 * Read Mail Tool Handler (The Post Office)
 *
 * Reads one letter from the CALLER's own mailbox (and only its own — the
 * reference is confined to its `Mail/` folder). Like `list_mail`, it reaches
 * the vault through `ensureCharacterVault` rather than the doc-tool resolver,
 * so the systemTransparency covenant — which hides character vaults from
 * `doc_*` tools — never keeps a character from its own post.
 *
 * Reading a letter Suparṇā has not yet announced marks it announced: the
 * character has read it, so she has nothing left to bring.
 */

import { logger } from '@/lib/logger';
import { validateReadMailInput } from '../read-mail-tool';
import type { ReadMailToolOutput } from '../read-mail-tool';
import { ensureCharacterVault } from '@/lib/mount-index/character-vault';
import { letterFileName, markAlerted, readLetter, resolveMailPath } from '@/lib/post-office/mailbox';
import { formatLetterActions, formatLetterDate } from '@/lib/post-office/instructions';
import { getRepositories } from '@/lib/repositories/factory';

export type { ReadMailToolOutput };

export interface ReadMailToolContext {
  userId: string;
  chatId: string;
  /** The acting character whose own mailbox is read. */
  characterId?: string | null;
}

const moduleLogger = logger.child({ module: 'read-mail-handler' });

function fail(message: string): ReadMailToolOutput {
  return { success: false, text: message, error: message };
}

export async function executeReadMailTool(
  input: unknown,
  context: ReadMailToolContext,
): Promise<ReadMailToolOutput> {
  try {
    const parsed = validateReadMailInput(input);
    if (!parsed) {
      return fail('The Post Office needs the letter\'s file name to fetch it.');
    }
    if (!context.characterId) {
      return fail('Only a character keeps a postbox, and no character holds this one.');
    }

    const path = resolveMailPath(parsed.letter);
    if (!path) {
      return fail('Name the letter by its file name alone — the Post Office will not rummage outside your postbox.');
    }

    const repos = getRepositories();
    const me = await repos.characters.findByIdRaw(context.characterId);
    if (!me) {
      return fail('The Post Office cannot find your postbox; your character seems to have gone astray.');
    }
    if (me.archivedAt) {
      return fail('That character is archived; rehydrate it to continue.');
    }

    const { mountPointId: myVaultId } = await ensureCharacterVault(me);
    const letter = await readLetter(myVaultId, path);
    if (!letter) {
      moduleLogger.debug('read_mail: no such letter', { chatId: context.chatId, characterId: me.id, path });
      return fail(`No letter named "${letterFileName(path)}" rests in your postbox. list_mail will show you what does.`);
    }

    if (!letter.frontmatter.alerted) {
      await markAlerted(myVaultId, path);
    }

    moduleLogger.debug('read_mail: letter read', {
      chatId: context.chatId,
      characterId: me.id,
      path,
      markedAlerted: !letter.frontmatter.alerted,
    });

    const { from, sentAt } = letter.frontmatter;
    const text = [
      `A letter from ${from}, posted ${formatLetterDate(sentAt)}:`,
      letter.body.trim() || '(the letter is blank)',
      formatLetterActions({ path, from }, { includeRead: false }),
    ].join('\n\n');

    return { success: true, text, path };
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unexpected error in read_mail handler';
    moduleLogger.error(
      'read_mail handler threw unexpectedly',
      { chatId: context.chatId },
      error instanceof Error ? error : undefined,
    );
    return fail(`The Post Office stumbled and couldn't fetch your letter — ${msg}`);
  }
}

export function formatReadMailResults(output: ReadMailToolOutput): string {
  return output.success ? output.text : output.error || output.text;
}
