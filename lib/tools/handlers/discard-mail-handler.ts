/**
 * Discard Mail Tool Handler (The Post Office)
 *
 * Discards one letter from the CALLER's own mailbox (and only its own — the
 * reference is confined to its `Mail/` folder). Like `list_mail` and
 * `read_mail`, it reaches the vault through `ensureCharacterVault` rather than
 * the doc-tool resolver, so the systemTransparency covenant never keeps a
 * character from its own post.
 *
 * The delete itself is `discardLetter`, which goes through the database-store
 * delete chokepoint (`deleteWithGC`): hard links and file-row collection are
 * handled exactly as `doc_delete_file` handles them.
 */

import { logger } from '@/lib/logger';
import { validateDiscardMailInput } from '../discard-mail-tool';
import type { DiscardMailToolOutput } from '../discard-mail-tool';
import { ensureCharacterVault } from '@/lib/mount-index/character-vault';
import { discardLetter, letterFileName, resolveMailPath } from '@/lib/post-office/mailbox';
import { getRepositories } from '@/lib/repositories/factory';

export type { DiscardMailToolOutput };

export interface DiscardMailToolContext {
  userId: string;
  chatId: string;
  /** The acting character whose own mailbox is touched. */
  characterId?: string | null;
}

const moduleLogger = logger.child({ module: 'discard-mail-handler' });

function fail(message: string): DiscardMailToolOutput {
  return { success: false, message, error: message };
}

export async function executeDiscardMailTool(
  input: unknown,
  context: DiscardMailToolContext,
): Promise<DiscardMailToolOutput> {
  try {
    const parsed = validateDiscardMailInput(input);
    if (!parsed) {
      return fail('The Post Office needs the letter\'s file name to know which one to discard.');
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
    const deleted = await discardLetter(myVaultId, path);
    const name = letterFileName(path);
    if (!deleted) {
      moduleLogger.debug('discard_mail: no such letter', { chatId: context.chatId, characterId: me.id, path });
      return fail(`No letter named "${name}" rests in your postbox. list_mail will show you what does.`);
    }

    moduleLogger.info('discard_mail: letter discarded', { chatId: context.chatId, characterId: me.id, path });
    return {
      success: true,
      message: `The letter "${name}" has been consigned to the wastepaper basket.`,
      path,
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unexpected error in discard_mail handler';
    moduleLogger.error(
      'discard_mail handler threw unexpectedly',
      { chatId: context.chatId },
      error instanceof Error ? error : undefined,
    );
    return fail(`The Post Office stumbled and the letter stays where it was — ${msg}`);
  }
}

export function formatDiscardMailResults(output: DiscardMailToolOutput): string {
  return output.success ? output.message : output.error || output.message;
}
