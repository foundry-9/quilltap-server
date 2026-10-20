/**
 * Edit Custom Tool Handler
 *
 * Saves or checks one of Pascal's custom-tool definitions on a model's behalf.
 * The file is always `Tools/<name>.tool.json` at the top level of the named
 * store — the only place the roster looks.
 *
 * A save is judged first by `validateToolDefinitionText`, the same judgement
 * discovery applies at load time, plus discovery's same-store rule (no two
 * definitions in one store may share a `name`). Only a definition that passes
 * both is written, and the write itself is `doc_write_file`'s handler — so
 * store access, the per-document `character_write` policy, the Librarian's
 * announcement and the reindex are exactly a document write's, with no second
 * write path into stores. A call without content writes nothing: it reads the
 * file as it stands (under the read policy) and passes the same judgement.
 * `action: "schema"` touches no store: it hands back the published JSON Schema
 * mirror (`public/schemas/qtap-custom-tool.schema.json`, held to the Zod
 * schema by its own test) and the two reference specimens, which is
 * everything a model needs to write a definition from scratch.
 *
 * Job-child safe: the write goes through the doc-edit write path, which the
 * child already buffers; nothing here reads back what it just wrote.
 */

import { logger } from '@/lib/logger';
import { getErrorMessage } from '@/lib/error-utils';
import {
  loadToolsFromMount,
  toolDefinitionPathFor,
  validateToolDefinitionText,
  type ToolDefinitionValidation,
} from '@/lib/pascal/custom-tools';
import { TOOLS_FOLDER } from '@/lib/pascal/custom-tool.types';
import { resolveDocEditPath, readFileWithMtime } from '@/lib/doc-edit';
import {
  assertCharacterMayRead,
  buildReadResolutionContext,
  buildWriteResolutionContext,
  uriForResolvedPath,
  type DocEditToolContext,
} from './doc-edit/shared';
import { handleWriteFile } from './doc-edit/text-handlers';
import { validateEditCustomToolInput, type EditCustomToolOutput } from '../edit-custom-tool-tool';
import customToolJsonSchema from '@/public/schemas/qtap-custom-tool.schema.json';
import rangeSpecimen from '@/docs/developer/CUSTOM_TOOL_SPEC.json';
import diceSpecimen from '@/docs/developer/CUSTOM_TOOL_SPEC_DICE.json';

const CONTEXT = 'edit-custom-tool-handler';

function failure(error: string, path?: string): EditCustomToolOutput {
  return { success: false, ...(path ? { path } : {}), error };
}

/** The validation verdict, worded for the model. */
function describeInvalid(path: string, verdict: Extract<ToolDefinitionValidation, { ok: false }>): string {
  return verdict.stage === 'json'
    ? `${path} ${verdict.reason}`
    : `${path} fails the custom-tool schema: ${verdict.reason}`;
}

/**
 * Another definition in the same store that already claims `name`, or null.
 * Read through discovery itself, so "clash" means what the roster means by it —
 * including a file that discovery has already set aside as a duplicate.
 */
async function findSameStoreClash(
  mountPointId: string,
  definitionPath: string,
  name: string
): Promise<string | null> {
  const { found, errors } = await loadToolsFromMount(mountPointId, 'global');
  const self = definitionPath.toLowerCase();
  const claims = [
    ...found.map((entry) => ({ path: entry.definitionPath, name: entry.definition.name })),
    ...errors
      .filter((error) => error.stage === 'duplicate' && error.name !== undefined)
      .map((error) => ({ path: error.definitionPath, name: error.name as string })),
  ];
  return claims.find((claim) => claim.name === name && claim.path.toLowerCase() !== self)?.path ?? null;
}

/** The content a caller handed over, as the exact text that would be saved. */
function contentToText(content: unknown): { ok: true; text: string } | { ok: false; error: string } {
  if (typeof content === 'string') return { ok: true, text: content };
  try {
    const text = JSON.stringify(content, null, 2);
    if (typeof text !== 'string') return { ok: false, error: 'content must be a JSON string or a JSON object.' };
    return { ok: true, text };
  } catch (error) {
    return { ok: false, error: `content could not be serialized as JSON: ${getErrorMessage(error)}` };
  }
}

/**
 * Execute the edit_custom_tool tool.
 */
export async function executeEditCustomTool(
  input: unknown,
  context: DocEditToolContext
): Promise<EditCustomToolOutput> {
  const parsed = validateEditCustomToolInput(input);
  if (!parsed) {
    logger.warn('edit_custom_tool validation failed', { context: CONTEXT, chatId: context.chatId, input });
    return failure('Invalid input: `mount_point` and `file` are required unless `action` is "schema".');
  }

  if (parsed.action === 'schema') {
    logger.debug('edit_custom_tool: schema requested', {
      context: CONTEXT,
      chatId: context.chatId,
      characterId: context.characterId,
    });
    return { success: true, action: 'schema', schema: customToolJsonSchema, examples: [rangeSpecimen, diceSpecimen] };
  }

  const { mount_point: mountPoint, file, content } = parsed;
  // The input schema's refine already demands both; this narrows the types.
  if (mountPoint === undefined || file === undefined) {
    return failure('Invalid input: `mount_point` and `file` are required unless `action` is "schema".');
  }
  const definitionPath = toolDefinitionPathFor(file);
  if (!definitionPath) {
    return failure(
      `"${file}" is not a custom-tool file name. Give the bare name ("unlock") or the file name ("unlock.tool.json"); definitions live directly inside the store's top-level ${TOOLS_FOLDER}/ folder, never in a subfolder.`
    );
  }

  // `null` is how some models spell "omitted".
  const checkOnly = content === undefined || content === null;

  logger.debug('edit_custom_tool called', {
    context: CONTEXT,
    chatId: context.chatId,
    characterId: context.characterId,
    mountPoint,
    definitionPath,
    checkOnly,
  });

  try {
    if (checkOnly) {
      const resolved = await resolveDocEditPath(
        'document_store',
        definitionPath,
        await buildReadResolutionContext({ mount_point: mountPoint }, context)
      );
      await assertCharacterMayRead(resolved, context);

      let text: string;
      try {
        ({ content: text } = await readFileWithMtime(resolved));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          return failure(`There is no ${definitionPath} in "${mountPoint}" to validate.`, definitionPath);
        }
        throw error;
      }

      const verdict = validateToolDefinitionText(text, { mountPointId: resolved.mountPointId, definitionPath });
      if (!verdict.ok) {
        logger.debug('edit_custom_tool: existing definition is invalid', { context: CONTEXT, definitionPath, stage: verdict.stage });
        return failure(describeInvalid(definitionPath, verdict), definitionPath);
      }
      const clash = await findSameStoreClash(resolved.mountPointId!, definitionPath, verdict.definition.name);
      if (clash) {
        return failure(
          `${definitionPath} is valid on its own, but ${clash} in the same store also defines "${verdict.definition.name}", so the roster loads only one of them. Rename one.`,
          definitionPath
        );
      }

      return {
        success: true,
        action: 'validated',
        path: definitionPath,
        uri: await uriForResolvedPath(resolved),
        name: verdict.definition.name,
      };
    }

    const serialized = contentToText(content);
    if (!serialized.ok) return failure(serialized.error, definitionPath);

    const verdict = validateToolDefinitionText(serialized.text, { definitionPath });
    if (!verdict.ok) {
      logger.debug('edit_custom_tool: refused an invalid definition', { context: CONTEXT, definitionPath, stage: verdict.stage });
      return failure(`Not saved. ${describeInvalid(definitionPath, verdict)}`, definitionPath);
    }

    // Resolve through the write context before reading the store's roster, so
    // a store the caller may not write to fails as a write would.
    const resolved = await resolveDocEditPath(
      'document_store',
      definitionPath,
      await buildWriteResolutionContext({ mount_point: mountPoint }, context)
    );
    const clash = await findSameStoreClash(resolved.mountPointId!, definitionPath, verdict.definition.name);
    if (clash) {
      return failure(
        `Not saved. ${clash} in "${mountPoint}" already defines "${verdict.definition.name}", and one store may not hold two definitions of the same name. Edit that file instead, or choose another name.`,
        definitionPath
      );
    }

    const written = await handleWriteFile(
      { scope: 'document_store', mount_point: mountPoint, path: definitionPath, content: serialized.text },
      context
    );
    if (!written.success) {
      return failure(`Not saved. ${written.error ?? 'The write failed.'}`, definitionPath);
    }

    logger.info('Custom tool definition saved', {
      context: CONTEXT,
      chatId: context.chatId,
      characterId: context.characterId,
      mountPointId: resolved.mountPointId,
      definitionPath,
      name: verdict.definition.name,
    });

    return {
      success: true,
      action: 'saved',
      path: definitionPath,
      uri: written.result?.uri,
      name: verdict.definition.name,
    };
  } catch (error) {
    logger.warn('edit_custom_tool failed', {
      context: CONTEXT,
      chatId: context.chatId,
      mountPoint,
      definitionPath,
      error: getErrorMessage(error),
    });
    return failure(getErrorMessage(error), definitionPath);
  }
}

/**
 * Format an edit_custom_tool result for the model's context.
 */
export function formatEditCustomToolResults(output: EditCustomToolOutput): string {
  if (!output.success) {
    return `Custom tool edit error: ${output.error || 'Unknown error'}`;
  }
  if (output.action === 'schema') {
    return [
      'The custom-tool definition format: `schema` is the JSON Schema every Tools/<name>.tool.json file must satisfy, and `examples` are reference definitions that pass it (between them they exercise every feature, so read their descriptions and messages as commentary).',
      '`roll` is either a range object or a dice string, never both. Write the definition, then save it with edit_custom_tool (`mount_point`, `file`, `content`); a failed save says exactly what to fix.',
    ].join(' ');
  }
  const where = output.uri ?? output.path;
  return output.action === 'saved'
    ? `Saved "${output.name}" to ${where}. It passed schema validation.`
    : `${where} is a valid custom tool definition ("${output.name}").`;
}
