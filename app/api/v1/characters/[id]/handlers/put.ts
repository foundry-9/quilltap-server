/**
 * Characters API v1 - PUT Handler
 *
 * PUT /api/v1/characters/[id] - Update a character
 * PUT /api/v1/characters/[id]?action=depiction-guidelines - Write the Ariel Clause file
 * PUT /api/v1/characters/[id]?action=patch-metadata - Set / unset fact-sheet keys
 *
 * The body schema is derived from the entity (`lib/characters/api-schemas.ts`)
 * and strict: an unknown key is a 400. Prompts and scenarios are not taken
 * here — they have their own per-item routes.
 */

import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { exists } from '@/lib/api/middleware';
import { dispatchAction } from '@/lib/api/middleware/actions';
import type { CharacterRow, PhysicalDescription } from '@/lib/schemas/types';
import { logger } from '@/lib/logger';
import { badRequest, conflict, notFound, successResponse } from '@/lib/api/responses';
import type { RequestContext } from '@/lib/api/middleware';
import { writeStoreFile, DEPICTION_GUIDELINES_FILENAME } from '@/lib/image-gen/aesthetic';
import { readVaultFile } from '@/lib/characters/vault/readers';
import { parseVaultPhysicalPrompts } from '@/lib/characters/vault/parsers';
import { CHARACTER_PHYSICAL_PROMPTS_JSON_PATH, physicalDescriptionIdFor } from '@/lib/characters/vault/layout';
import { updateCharacterSchema } from '@/lib/characters/api-schemas';
import { CharacterArchivedError } from '@/lib/characters/archive-guard';
import {
  CharacterMetadataUnreadableError,
  type CharacterUpdate,
} from '@/lib/database/repositories/characters.repository';
import { publishRealtime } from '@/lib/realtime/bus';
import { recompileCharacterSeats } from '@/lib/services/system-prompt-compiler/character-fanout';

/** `?action=patch-metadata`: keys to set and keys to remove, merged server-side. */
const patchMetadataSchema = z
  .object({
    set: z.record(z.string(), z.unknown()).optional(),
    unset: z.array(z.string()).optional(),
  })
  .strict();

export async function handlePut(
  req: NextRequest,
  ctx: RequestContext,
  id: string
): Promise<NextResponse> {
  const { repos } = ctx;

  // Existence/ownership check only — the raw row, so a character with a broken
  // vault can still be edited (the write routes managed fields back to the
  // vault). findById would throw CharacterVaultUnavailableError → 503.
  const existingCharacter = await repos.characters.findByIdRaw(id);

  if (!exists(existingCharacter)) {
    return notFound('Character');
  }

  return dispatchAction(
    req,
    {
      // The depiction-guidelines (Ariel Clause) file lives in the character's
      // vault root, not the character row. A side-store write, so it carries
      // the archive guard itself.
      'depiction-guidelines': async () => {
        if (existingCharacter.archivedAt) {
          throw new CharacterArchivedError(id);
        }
        const mountId = existingCharacter.characterDocumentMountPointId;
        if (!mountId) {
          return badRequest('Character has no document vault to store depiction guidelines');
        }
        const aestheticBody = await req.json().catch(() => ({}));
        const content = typeof aestheticBody?.content === 'string' ? aestheticBody.content : '';
        await writeStoreFile(mountId, DEPICTION_GUIDELINES_FILENAME, content);
        logger.info('[Characters v1] Depiction guidelines updated', {
          characterId: id,
          length: content.trim().length,
          deleted: content.trim().length === 0,
        });
        publishRealtime('characters', id);
        return successResponse({ success: true });
      },

      // Key-level fact-sheet edits, merged under the character's write chain so
      // two editors (the fact-sheet card, the progressions card) never race a
      // read-merge-replace. The repository primitive stays whole-object replace.
      'patch-metadata': async () => {
        const patch = patchMetadataSchema.parse(await req.json());
        try {
          const character = await repos.characters.patchMetadata(id, {
            set: patch.set ?? {},
            unset: patch.unset ?? [],
          });
          if (!character) return notFound('Character');
          publishRealtime('characters', id);
          return NextResponse.json({ character });
        } catch (error) {
          if (error instanceof CharacterMetadataUnreadableError) {
            return conflict(error.message);
          }
          throw error;
        }
      },
    },
    () => handleUpdateCharacter(req, ctx, id, existingCharacter)
  );
}

async function handleUpdateCharacter(
  req: NextRequest,
  ctx: RequestContext,
  id: string,
  existingCharacter: CharacterRow
): Promise<NextResponse> {
  const { repos } = ctx;
  const body = await req.json();
  const validated = updateCharacterSchema.parse(body);

  // The default prompt is recorded both as this column and as the `isDefault`
  // flag on the prompt itself, so it goes through the repository chokepoint
  // below instead of being written raw.
  const { defaultSystemPromptId, physicalDescription, ...rest } = validated;
  const updatePayload: CharacterUpdate = { ...rest };

  if (physicalDescription !== undefined) {
    if (physicalDescription === null) {
      // Clear means clear: both files emptied, `humanoid` kept (#149).
      updatePayload.physicalDescription = null;
    } else {
      // The id is the server's, derived from the vault (D5); no client mints one.
      const now = new Date().toISOString();
      const mountPointId = existingCharacter.characterDocumentMountPointId;
      updatePayload.physicalDescription = {
        ...physicalDescription,
        id: mountPointId ? physicalDescriptionIdFor(mountPointId) : crypto.randomUUID(),
        createdAt: now,
        updatedAt: now,
      } as PhysicalDescription;
    }
  }

  // The Humanoid flag is baked into every chat's cached identity stack for
  // this character, which a character edit does not otherwise invalidate.
  // Read the vault's current value so a flip can be fanned out below.
  const incomingHumanoid = physicalDescription ? physicalDescription.humanoid : undefined;
  let previousHumanoid: boolean | undefined;
  if (incomingHumanoid !== undefined && existingCharacter.characterDocumentMountPointId) {
    const raw = await readVaultFile(existingCharacter.characterDocumentMountPointId, CHARACTER_PHYSICAL_PROMPTS_JSON_PATH, id);
    previousHumanoid = (raw === null ? null : parseVaultPhysicalPrompts(raw, id))?.humanoid ?? true;
  }

  // A PUT carrying nothing but the default prompt leaves an empty payload, and
  // an empty patch is not a write anyone asked for — the archive guard reads one
  // as an unsanctioned edit.
  let character =
    Object.keys(updatePayload).length > 0
      ? await repos.characters.update(id, updatePayload)
      : await repos.characters.findById(id);

  if (defaultSystemPromptId !== undefined) {
    const updated = await repos.characters.setDefaultSystemPrompt(id, defaultSystemPromptId);
    if (!updated) {
      return badRequest('System prompt not found on this character');
    }
    character = updated;
  }

  if (previousHumanoid !== undefined && previousHumanoid !== incomingHumanoid) {
    const fanout = await recompileCharacterSeats(id, { reason: 'humanoid flag changed' });
    logger.debug('[Characters v1] Humanoid flag changed; identity stacks recompiled', {
      characterId: id,
      humanoid: incomingHumanoid,
      ...fanout,
    });
  }

  revalidatePath('/');
  // A second tab (or the workspace's other pane) refetches on this topic.
  publishRealtime('characters', id);

  logger.info('[Characters v1] Character updated', { characterId: id, fields: Object.keys(validated) });

  return NextResponse.json({ character });
}
