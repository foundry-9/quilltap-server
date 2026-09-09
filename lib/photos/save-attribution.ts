/**
 * Who a Salon image-save is attributed to.
 *
 * There are two doors onto the same album picker — the message toolbar's
 * bookmark (`POST /chats/{id}/messages/{messageId}?action=save-image`) and the
 * chat gallery's Save (`POST /chats/{id}?action=save-image`) — and they must
 * write the same name into the kept-image sidecar's frontmatter, because that
 * name is what the Commonplace Book and every later reader see. This is the one
 * place that decides it.
 *
 * The rule: if the chosen album *is* a participant's character vault, the save
 * is that character's, matching the LLM `keep_image` flow. Otherwise it is the
 * operator's, under the name of whichever persona they are speaking as — the
 * actively-impersonated one when there is one, else the first user-controlled
 * participant, else the account's own name.
 *
 * @module photos/save-attribution
 */

import { logger } from '@/lib/logger';
import { getCharacterVaultStore } from '@/lib/file-storage/character-vault-bridge';
import type { RepositoryContainer } from '@/lib/database/repositories';
import type { ChatMetadata } from '@/lib/schemas/chat.types';
import type { SaveImageAttribution } from './save-image-to-album';

const log = logger.child({ module: 'photos.save-attribution' });

/**
 * Resolve the attribution for a save into `mountPointId` from `chat`.
 *
 * Never throws and never returns null: an unresolvable persona falls back to
 * the account name, and an unresolvable name falls back to "Quilltap", because
 * a save with an odd byline is a better outcome than a save that fails.
 *
 * @param chat The chat the image is being saved out of.
 * @param mountPointId The album chosen in the dialog.
 * @param user The operator, for the last-resort name and id.
 * @param repos Repository container.
 */
export async function resolveSaveAttribution(
  chat: ChatMetadata,
  mountPointId: string,
  user: { id?: string | null; name?: string | null },
  repos: RepositoryContainer,
): Promise<SaveImageAttribution> {
  // Is the chosen album a participant's own vault?
  for (const participant of chat.participants ?? []) {
    if (participant.type !== 'CHARACTER' || !participant.characterId) continue;
    const vault = await getCharacterVaultStore(participant.characterId);
    if (!vault || vault.mountPointId !== mountPointId) continue;
    const character = await repos.characters.findById(participant.characterId);
    const attribution: SaveImageAttribution = {
      name: character?.name ?? vault.mountPointName,
      id: participant.characterId,
      role: 'character',
    };
    log.debug('Save attributed to a character vault', {
      chatId: chat.id,
      mountPointId,
      characterId: participant.characterId,
    });
    return attribution;
  }

  // Otherwise the operator, under whichever persona they are speaking as.
  let userPersonaName: string | null = null;
  let userPersonaId: string | null = null;
  const activeTypingId = chat.activeTypingParticipantId ?? null;
  const activeParticipant = activeTypingId
    ? chat.participants?.find((p) => p.id === activeTypingId && p.controlledBy === 'user')
    : undefined;
  const fallbackParticipant = chat.participants?.find((p) => p.controlledBy === 'user');
  const userParticipant = activeParticipant ?? fallbackParticipant;
  if (userParticipant?.characterId) {
    const character = await repos.characters.findById(userParticipant.characterId);
    if (character?.name) {
      userPersonaName = character.name;
      userPersonaId = character.id;
    }
  }

  const attribution: SaveImageAttribution = {
    name: userPersonaName ?? user.name ?? 'Quilltap',
    id: userPersonaId ?? user.id ?? null,
    role: 'user',
  };
  log.debug('Save attributed to the operator', {
    chatId: chat.id,
    mountPointId,
    personaId: userPersonaId,
  });
  return attribution;
}
