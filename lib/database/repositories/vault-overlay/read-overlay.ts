/**
 * Batched read overlay: apply the vault file overlay to a list of characters
 * so every repository read path sees vault values transparently. Has its own
 * inlined fetch path (one IN(...) query per vault path plus two directory
 * listings) rather than calling the per-field readers, for performance.
 *
 * @module database/repositories/vault-overlay/read-overlay
 */

import { logger } from '@/lib/logger';
import { getRepositories } from '@/lib/repositories/factory';
import type {
  Character,
  PhysicalDescription,
  CharacterSystemPrompt,
  CharacterScenario,
} from '@/lib/schemas/types';
import type { DocMountDocumentWithLink as DocMountDocument } from '@/lib/database/repositories/doc-mount-documents.repository';

import {
  SINGLE_FILE_OVERLAY_PATHS,
  CHARACTER_PROPERTIES_JSON_PATH,
  CHARACTER_IDENTITY_MD_PATH,
  CHARACTER_DESCRIPTION_MD_PATH,
  CHARACTER_MANIFESTO_MD_PATH,
  CHARACTER_PERSONALITY_MD_PATH,
  CHARACTER_EXAMPLE_DIALOGUES_MD_PATH,
  CHARACTER_PHYSICAL_DESCRIPTION_MD_PATH,
  CHARACTER_PHYSICAL_PROMPTS_JSON_PATH,
  CHARACTER_PROMPTS_FOLDER,
  CHARACTER_SCENARIOS_FOLDER,
} from './schema';
import {
  hasLinkedVault,
  parseVaultProperties,
  parseVaultPhysicalPrompts,
  markdownToNullable,
  stableUuidFromString,
  parsePromptFile,
  parseScenarioFile,
} from './parsers';

/**
 * Apply the vault file overlay to a list of characters. Characters not flagged
 * for overlay (switch off OR no linked vault) are returned unchanged. Batched:
 * performs one IN(...) query per vault path plus two directory listings.
 */
export async function applyDocumentStoreOverlay(
  characters: Character[],
): Promise<Character[]> {
  if (characters.length === 0) {
    return characters;
  }

  const candidates = characters.filter(hasLinkedVault);
  if (candidates.length === 0) {
    return characters;
  }

  const mountPointIds = Array.from(
    new Set(candidates.map((c) => c.characterDocumentMountPointId as string)),
  );

  const repos = getRepositories();

  const contentByMountByPath = new Map<string, Map<string, string>>();
  for (const path of SINGLE_FILE_OVERLAY_PATHS) {
    contentByMountByPath.set(path, new Map<string, string>());
  }
  const promptsByMount = new Map<string, DocMountDocument[]>();
  const scenariosByMount = new Map<string, DocMountDocument[]>();

  try {
    const singleFileResults = await Promise.all(
      SINGLE_FILE_OVERLAY_PATHS.map((path) =>
        repos.docMountDocuments.findManyByMountPointsAndPath(mountPointIds, path),
      ),
    );
    for (let i = 0; i < SINGLE_FILE_OVERLAY_PATHS.length; i++) {
      const path = SINGLE_FILE_OVERLAY_PATHS[i];
      const byMount = contentByMountByPath.get(path)!;
      for (const doc of singleFileResults[i]) {
        byMount.set(doc.mountPointId, doc.content);
      }
    }

    const [promptDocs, scenarioDocs] = await Promise.all([
      repos.docMountDocuments.findManyByMountPointsInFolder(
        mountPointIds,
        CHARACTER_PROMPTS_FOLDER,
        '.md',
      ),
      repos.docMountDocuments.findManyByMountPointsInFolder(
        mountPointIds,
        CHARACTER_SCENARIOS_FOLDER,
        '.md',
      ),
    ]);
    for (const doc of promptDocs) {
      let list = promptsByMount.get(doc.mountPointId);
      if (!list) {
        list = [];
        promptsByMount.set(doc.mountPointId, list);
      }
      list.push(doc);
    }
    for (const doc of scenarioDocs) {
      let list = scenariosByMount.get(doc.mountPointId);
      if (!list) {
        list = [];
        scenariosByMount.set(doc.mountPointId, list);
      }
      list.push(doc);
    }
  } catch (error) {
    logger.warn('Failed to load vault files for character overlay; falling back to DB values', {
      error: error instanceof Error ? error.message : String(error),
      mountPointIdCount: mountPointIds.length,
    });
    return characters;
  }

  const propsByMount = contentByMountByPath.get(CHARACTER_PROPERTIES_JSON_PATH)!;
  const idByMount = contentByMountByPath.get(CHARACTER_IDENTITY_MD_PATH)!;
  const descByMount = contentByMountByPath.get(CHARACTER_DESCRIPTION_MD_PATH)!;
  const manifestoByMount = contentByMountByPath.get(CHARACTER_MANIFESTO_MD_PATH)!;
  const persByMount = contentByMountByPath.get(CHARACTER_PERSONALITY_MD_PATH)!;
  const dialoguesByMount = contentByMountByPath.get(CHARACTER_EXAMPLE_DIALOGUES_MD_PATH)!;
  const physDescByMount = contentByMountByPath.get(CHARACTER_PHYSICAL_DESCRIPTION_MD_PATH)!;
  const physPromptsByMount = contentByMountByPath.get(CHARACTER_PHYSICAL_PROMPTS_JSON_PATH)!;

  return characters.map((character) => {
    if (!hasLinkedVault(character)) {
      return character;
    }
    const mountId = character.characterDocumentMountPointId as string;
    let out: Character = character;

    // properties.json: pronouns, aliases, title, firstMessage, talkativeness
    // (systemTransparency is access-control state — DB column only, not vault-mirrored)
    const propsRaw = propsByMount.get(mountId);
    if (propsRaw !== undefined) {
      const parsed = parseVaultProperties(propsRaw, character.id);
      if (parsed) {
        out = {
          ...out,
          pronouns: parsed.pronouns,
          aliases: parsed.aliases,
          title: parsed.title,
          firstMessage: parsed.firstMessage,
          talkativeness: parsed.talkativeness,
        };
      }
    }

    // identity.md
    const idRaw = idByMount.get(mountId);
    if (idRaw !== undefined) {
      out = { ...out, identity: markdownToNullable(idRaw) };
    }

    // description.md
    const descRaw = descByMount.get(mountId);
    if (descRaw !== undefined) {
      out = { ...out, description: markdownToNullable(descRaw) };
    }

    // manifesto.md
    const manifestoRaw = manifestoByMount.get(mountId);
    if (manifestoRaw !== undefined) {
      out = { ...out, manifesto: markdownToNullable(manifestoRaw) };
    }

    // personality.md
    const persRaw = persByMount.get(mountId);
    if (persRaw !== undefined) {
      out = { ...out, personality: markdownToNullable(persRaw) };
    }

    // example-dialogues.md
    const dialoguesRaw = dialoguesByMount.get(mountId);
    if (dialoguesRaw !== undefined) {
      out = { ...out, exampleDialogues: markdownToNullable(dialoguesRaw) };
    }

    // physical-description.md + physical-prompts.json populate the singular
    // physicalDescription. Vault is authoritative post-cutover: any vault
    // file present replaces the (now nonexistent) DB column.
    const physDescRaw = physDescByMount.get(mountId);
    const physPromptsRaw = physPromptsByMount.get(mountId);
    const hasPhysicalOverlayInput = physDescRaw !== undefined || physPromptsRaw !== undefined;

    if (hasPhysicalOverlayInput) {
      const base = out.physicalDescription ?? null;
      const patched: PhysicalDescription = base
        ? { ...base }
        : {
            id: stableUuidFromString(`physical:${mountId}`),
            name: 'default',
            usageContext: null,
            shortPrompt: null,
            mediumPrompt: null,
            longPrompt: null,
            completePrompt: null,
            fullDescription: null,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          };

      if (physDescRaw !== undefined) {
        patched.fullDescription = markdownToNullable(physDescRaw);
      }

      if (physPromptsRaw !== undefined) {
        const parsedPrompts = parseVaultPhysicalPrompts(physPromptsRaw, character.id);
        if (parsedPrompts) {
          patched.shortPrompt = parsedPrompts.short;
          patched.mediumPrompt = parsedPrompts.medium;
          patched.longPrompt = parsedPrompts.long;
          patched.completePrompt = parsedPrompts.complete;
        }
      }

      out = { ...out, physicalDescription: patched };
    }

    // Prompts/*.md → systemPrompts. Vault-authoritative: an empty or
    // all-unparseable folder yields an empty array, never the DB column.
    const promptDocs = promptsByMount.get(mountId) ?? [];
    const parsedPrompts = promptDocs
      .slice()
      .sort((a, b) => a.relativePath.localeCompare(b.relativePath))
      .map((doc) => parsePromptFile(doc, character.id))
      .filter((p): p is CharacterSystemPrompt => p !== null);
    let normalizedPrompts: CharacterSystemPrompt[] = parsedPrompts;
    if (parsedPrompts.length > 0) {
      // Ensure exactly one isDefault. If the frontmatter declares multiple
      // defaults, keep only the first; if none are marked default, promote
      // the first alphabetically so downstream consumers can always pick a
      // default without falling through to the empty-array branch.
      let seenDefault = false;
      normalizedPrompts = parsedPrompts.map((p) => {
        if (p.isDefault) {
          if (seenDefault) {
            return { ...p, isDefault: false };
          }
          seenDefault = true;
          return p;
        }
        return p;
      });
      if (!seenDefault) {
        normalizedPrompts[0] = { ...normalizedPrompts[0], isDefault: true };
      }
    }
    out = { ...out, systemPrompts: normalizedPrompts };

    // Scenarios/*.md → scenarios. Vault-authoritative: an empty or
    // all-unparseable folder yields an empty array, never the DB column.
    const scenarioDocs = scenariosByMount.get(mountId) ?? [];
    const parsedScenarios = scenarioDocs
      .slice()
      .sort((a, b) => a.relativePath.localeCompare(b.relativePath))
      .map((doc) => parseScenarioFile(doc, character.id))
      .filter((s): s is CharacterScenario => s !== null);
    out = { ...out, scenarios: parsedScenarios };

    return out;
  });
}

/**
 * Apply the overlay to a single character (or null). Convenience wrapper
 * around the batched function.
 */
export async function applyDocumentStoreOverlayOne(
  character: Character | null,
): Promise<Character | null> {
  if (!character) {
    return character;
  }
  const [overlaid] = await applyDocumentStoreOverlay([character]);
  return overlaid ?? character;
}
