/**
 * Tool effects — the one resolver.
 *
 * Every tool declares what it does to the world (see `effect-types.ts`). The
 * built-in tools declare it beside their definitions (`xxxToolEffect`); this
 * module collects them into {@link BUILT_IN_TOOL_EFFECTS} and answers, for any
 * call — built-in, plugin, MCP or custom — what its effect is.
 *
 * Anything undeclared counts as `write`. The snapshot test
 * (`__tests__/tool-definitions-snapshot.test.ts`) fails when a registered
 * built-in tool has no entry here, so declaring an effect is as much a part of
 * adding a tool as registering it there.
 *
 * Consumers: the tool permit ({@link resolveToolPermit}, asked by the executor
 * in `lib/chat/tool-executor.ts` before every call — the real guarantee),
 * `buildTools()`'s tool-list filter, the autonomous-room destructive gate, and
 * the storyteller bid tier.
 *
 * @module tools/effects
 */

import {
  isComputedToolEffect,
  isWithinCeiling,
  UNDECLARED_TOOL_EFFECT,
  type ToolEffect,
  type ToolEffectLookups,
  type ToolEffectSpec,
} from './effect-types';
import { askCarinaToolEffect } from './ask-carina-tool';
import { attachImageToolEffect } from './attach-image-tool';
import { deleteAnnotationToolEffect } from './delete-annotation-tool';
import { describeImageToolEffect } from './describe-image-tool';
import { discardMailToolEffect } from './discard-mail-tool';
import { docCloseDocumentToolEffect } from './doc-close-document-tool';
import { docCopyFileToolEffect } from './doc-copy-file-tool';
import { docCreateFolderToolEffect } from './doc-create-folder-tool';
import { docDeleteBlobToolEffect } from './doc-delete-blob-tool';
import { docDeleteFileToolEffect } from './doc-delete-file-tool';
import { docDeleteFolderToolEffect } from './doc-delete-folder-tool';
import { docFocusToolEffect } from './doc-focus-tool';
import { docGrepToolEffect } from './doc-grep-tool';
import { docInsertTextToolEffect } from './doc-insert-text-tool';
import { docListBlobsToolEffect } from './doc-list-blobs-tool';
import { docListFilesToolEffect } from './doc-list-files-tool';
import { docMoveFileToolEffect } from './doc-move-file-tool';
import { docMoveFolderToolEffect } from './doc-move-folder-tool';
import { docOpenDocumentToolEffect } from './doc-open-document-tool';
import { docReadBlobToolEffect } from './doc-read-blob-tool';
import { docReadFileToolEffect } from './doc-read-file-tool';
import { docReadFrontmatterToolEffect } from './doc-read-frontmatter-tool';
import { docReadHeadingToolEffect } from './doc-read-heading-tool';
import { docStrReplaceToolEffect } from './doc-str-replace-tool';
import { docUpdateFrontmatterToolEffect } from './doc-update-frontmatter-tool';
import { docUpdateHeadingToolEffect } from './doc-update-heading-tool';
import { docWriteBlobToolEffect } from './doc-write-blob-tool';
import { docWriteFileToolEffect } from './doc-write-file-tool';
import { editCustomToolToolEffect } from './edit-custom-tool-tool';
import { helpNavigateToolEffect } from './help-navigate-tool';
import { helpSearchToolEffect } from './help-search-tool';
import { helpSettingsToolEffect } from './help-settings-tool';
import { imageGenerationToolEffect } from './image-generation-tool';
import { inventoryArchiveToolEffect } from './inventory-archive-tool';
import { inventoryCreateToolEffect } from './inventory-create-tool';
import { inventoryEquipToolEffect } from './inventory-equip-tool';
import { inventoryGiveToolEffect } from './inventory-give-tool';
import { inventoryListToolEffect } from './inventory-list-tool';
import { inventoryPickUpToolEffect } from './inventory-pick-up-tool';
import { inventoryReadToolEffect } from './inventory-read-tool';
import { inventoryUnequipToolEffect } from './inventory-unequip-tool';
import { inventoryUpdateToolEffect } from './inventory-update-tool';
import { keepImageToolEffect } from './keep-image-tool';
import { listImagesToolEffect } from './list-images-tool';
import { listMailToolEffect } from './list-mail-tool';
import { logCreateEntryToolEffect } from './log-create-entry-tool';
import { logGrepToolEffect } from './log-grep-tool';
import { logReadToolEffect } from './log-read-tool';
import { projectInfoToolEffect } from './project-info-tool';
import { readConversationToolEffect } from './read-conversation-tool';
import { readMailToolEffect } from './read-mail-tool';
import { requestFullContextToolEffect } from './request-full-context-tool';
import { rngToolEffect } from './rng-tool';
import { runCustomToolEffect } from './run-custom-tool';
import { runSqlToolEffect } from './run-sql-tool';
import { lookupCharacterToolEffect } from './lookup-character-tool';
import { lookupMemoriesToolEffect } from './lookup-memories-tool';
import { lookupMessagesToolEffect } from './lookup-messages-tool';
import { readMessagesToolEffect } from './read-messages-tool';
import { searchScriptoriumToolEffect } from './search-scriptorium-tool';
import { selfInventoryToolEffect } from './self-inventory-tool';
import { sendMailToolEffect } from './send-mail-tool';
import { stateToolEffect } from './state-tool';
import { submitFinalResponseToolEffect } from './submit-final-response-tool';
import { terminalListToolEffect } from './terminal-list-tool';
import { terminalReadToolEffect } from './terminal-read-tool';
import { upsertAnnotationToolEffect } from './upsert-annotation-tool';
import { wardrobeArchiveToolEffect } from './wardrobe-archive-tool';
import { wardrobeCreateToolEffect } from './wardrobe-create-tool';
import { wardrobeHistoryToolEffect } from './wardrobe-history-tool';
import { wardrobeListToolEffect } from './wardrobe-list-tool';
import { wardrobeReadToolEffect } from './wardrobe-read-tool';
import { wardrobeRollbackToolEffect } from './wardrobe-rollback-tool';
import { wardrobeTakeOffToolEffect } from './wardrobe-take-off-tool';
import { wardrobeUpdateToolEffect } from './wardrobe-update-tool';
import { wardrobeWearToolEffect } from './wardrobe-wear-tool';
import { webSearchToolEffect } from './web-search-tool';
import { whisperToolEffect } from './whisper-tool';

export * from './effect-types';

/** Built-in tool name → declared effect. */
export const BUILT_IN_TOOL_EFFECTS: Readonly<Record<string, ToolEffectSpec>> = {
  ask_carina: askCarinaToolEffect,
  attach_image: attachImageToolEffect,
  delete_annotation: deleteAnnotationToolEffect,
  describe_image: describeImageToolEffect,
  discard_mail: discardMailToolEffect,
  doc_close_document: docCloseDocumentToolEffect,
  doc_copy_file: docCopyFileToolEffect,
  doc_create_folder: docCreateFolderToolEffect,
  doc_delete_blob: docDeleteBlobToolEffect,
  doc_delete_file: docDeleteFileToolEffect,
  doc_delete_folder: docDeleteFolderToolEffect,
  doc_focus: docFocusToolEffect,
  doc_grep: docGrepToolEffect,
  doc_insert_text: docInsertTextToolEffect,
  doc_list_blobs: docListBlobsToolEffect,
  doc_list_files: docListFilesToolEffect,
  doc_move_file: docMoveFileToolEffect,
  doc_move_folder: docMoveFolderToolEffect,
  doc_open_document: docOpenDocumentToolEffect,
  doc_read_blob: docReadBlobToolEffect,
  doc_read_file: docReadFileToolEffect,
  doc_read_frontmatter: docReadFrontmatterToolEffect,
  doc_read_heading: docReadHeadingToolEffect,
  doc_str_replace: docStrReplaceToolEffect,
  doc_update_frontmatter: docUpdateFrontmatterToolEffect,
  doc_update_heading: docUpdateHeadingToolEffect,
  doc_write_blob: docWriteBlobToolEffect,
  doc_write_file: docWriteFileToolEffect,
  edit_custom_tool: editCustomToolToolEffect,
  help_navigate: helpNavigateToolEffect,
  help_search: helpSearchToolEffect,
  help_settings: helpSettingsToolEffect,
  generate_image: imageGenerationToolEffect,
  inventory_archive: inventoryArchiveToolEffect,
  inventory_create: inventoryCreateToolEffect,
  inventory_equip: inventoryEquipToolEffect,
  inventory_give: inventoryGiveToolEffect,
  inventory_list: inventoryListToolEffect,
  inventory_pick_up: inventoryPickUpToolEffect,
  inventory_read: inventoryReadToolEffect,
  inventory_unequip: inventoryUnequipToolEffect,
  inventory_update: inventoryUpdateToolEffect,
  keep_image: keepImageToolEffect,
  list_images: listImagesToolEffect,
  list_mail: listMailToolEffect,
  log_create_entry: logCreateEntryToolEffect,
  log_grep: logGrepToolEffect,
  log_read: logReadToolEffect,
  project_info: projectInfoToolEffect,
  read_conversation: readConversationToolEffect,
  read_mail: readMailToolEffect,
  request_full_context: requestFullContextToolEffect,
  rng: rngToolEffect,
  run_custom: runCustomToolEffect,
  run_sql: runSqlToolEffect,
  lookup_character: lookupCharacterToolEffect,
  lookup_memories: lookupMemoriesToolEffect,
  lookup_messages: lookupMessagesToolEffect,
  read_messages: readMessagesToolEffect,
  search: searchScriptoriumToolEffect,
  self_inventory: selfInventoryToolEffect,
  send_mail: sendMailToolEffect,
  state: stateToolEffect,
  submit_final_response: submitFinalResponseToolEffect,
  terminal_list: terminalListToolEffect,
  terminal_read: terminalReadToolEffect,
  upsert_annotation: upsertAnnotationToolEffect,
  wardrobe_archive: wardrobeArchiveToolEffect,
  wardrobe_create: wardrobeCreateToolEffect,
  wardrobe_history: wardrobeHistoryToolEffect,
  wardrobe_list: wardrobeListToolEffect,
  wardrobe_read: wardrobeReadToolEffect,
  wardrobe_rollback: wardrobeRollbackToolEffect,
  wardrobe_take_off: wardrobeTakeOffToolEffect,
  wardrobe_update: wardrobeUpdateToolEffect,
  wardrobe_wear: wardrobeWearToolEffect,
  search_web: webSearchToolEffect,
  whisper: whisperToolEffect,
};

/** Everything an effect lookup may need beyond the call itself. */
export interface ToolEffectContext extends ToolEffectLookups {
  /** Plugin / MCP tool name → declared effect. A plugin tool missing here counts as `write`. */
  pluginToolEffects?: ReadonlyMap<string, ToolEffect>;
}

/** The declared spec for a tool, or undefined when it declares none. */
export function toolEffectSpecOf(name: string): ToolEffectSpec | undefined {
  return Object.prototype.hasOwnProperty.call(BUILT_IN_TOOL_EFFECTS, name) ? BUILT_IN_TOOL_EFFECTS[name] : undefined;
}

/**
 * The effect of one call. A computed built-in effect sees the call's input
 * (validated by the tool's own schema; invalid input counts as `write`).
 */
export function effectOfToolCall(name: string, input: unknown, ctx: ToolEffectContext = {}): ToolEffect {
  const spec = toolEffectSpecOf(name);
  if (spec !== undefined) return isComputedToolEffect(spec) ? spec(input, ctx) : spec;
  return ctx.pluginToolEffects?.get(name) ?? UNDECLARED_TOOL_EFFECT;
}

/**
 * The highest effect any call of this tool can have — its static effect, or a
 * computed effect's `maxEffect`. Used where one answer per tool is needed: the
 * tool-list filter, the autonomous-room destructive gate, a bid's named tools.
 */
export function maxEffectOfTool(name: string, ctx: ToolEffectContext = {}): ToolEffect {
  const spec = toolEffectSpecOf(name);
  if (spec !== undefined) return isComputedToolEffect(spec) ? spec.maxEffect : spec;
  return ctx.pluginToolEffects?.get(name) ?? UNDECLARED_TOOL_EFFECT;
}

/** The tool result's text when a call is refused for exceeding the turn's ceiling. */
export function describeCeilingRefusal(name: string, effect: ToolEffect, ceiling: ToolEffect): string {
  return (
    `Not run: \`${name}\` is a ${effect} call, and this turn allows only ${ceilingPhrase(ceiling)}. ` +
    'Nothing was changed. Carry on without it.'
  );
}

function ceilingPhrase(ceiling: ToolEffect): string {
  switch (ceiling) {
    case 'none':
      return 'tools with no effect (no lookups, no changes)';
    case 'read':
      return 'lookups (read-only tools)';
    case 'write':
      return 'lookups and changes, not deletions';
    case 'destroy':
      return 'any tool';
  }
}

// ---------------------------------------------------------------------------
// The tool permit — "may this seat run this tool now?"
// ---------------------------------------------------------------------------

/**
 * What a seat was offered this turn. A model-driven loop carries the names of
 * the tools it listed (`buildTools()` builds it, after the per-character
 * switches, the surface flags and the chat's disabled tools are applied); a run
 * the operator started by hand (the Salon's Run Tool) carries `operator`, which
 * skips the membership test but never the ceiling or the operator-surface gate.
 */
export type ToolOffer =
  | { readonly kind: 'offered'; readonly names: ReadonlySet<string> }
  | { readonly kind: 'operator' };

/** The offer for a model-driven loop: exactly these tool names. */
export function offeredTools(names: Iterable<string>): ToolOffer {
  return { kind: 'offered', names: new Set(names) };
}

/** The offer for a run the operator started by hand. */
export const OPERATOR_TOOL_OFFER: ToolOffer = Object.freeze({ kind: 'operator' as const });

/**
 * Tools that only ever run on the operator surface (the Brahma Console):
 * read-only SQL and the lookup shortcuts, which read every character's
 * memories and every conversation. Refused off that surface whatever the offer.
 */
export const OPERATOR_SURFACE_ONLY_TOOLS: ReadonlySet<string> = new Set([
  'run_sql',
  'lookup_character',
  'lookup_memories',
  'lookup_messages',
  'read_messages',
]);

/** Everything the permit needs beyond the call itself. */
export interface ToolPermitContext extends ToolEffectContext {
  /** What this seat was offered this turn; absent means nothing was, and every call is refused. */
  offer: ToolOffer | undefined;
  /** The highest effect a call may have this turn; unset = no ceiling. */
  effectCeiling?: ToolEffect;
  /** The call runs on the operator surface (the Brahma Console). */
  operatorSurface?: boolean;
}

export type ToolPermitRefusal = 'no-offer' | 'operator-surface-only' | 'not-offered' | 'above-ceiling';

export type ToolPermit =
  | { readonly permitted: true; readonly effect: ToolEffect }
  | {
      readonly permitted: false;
      readonly refusal: ToolPermitRefusal;
      readonly effect: ToolEffect;
      /** The tool result's text: says the call was not run and why. */
      readonly message: string;
    };

/**
 * May this seat run this tool now? In order: an offer must exist; an
 * operator-surface-only tool needs the operator surface; a model-driven call
 * must name a tool it was offered; and the call's effect must sit within the
 * turn's ceiling. The executor asks this before every call — it is the
 * guarantee, and the tool list only spares the model offers it cannot use.
 */
export function resolveToolPermit(name: string, input: unknown, ctx: ToolPermitContext): ToolPermit {
  const effect = effectOfToolCall(name, input, ctx);

  if (!ctx.offer) {
    return {
      permitted: false,
      refusal: 'no-offer',
      effect,
      message: `Not run: \`${name}\` was called with no tool slate for this turn. Nothing was changed.`,
    };
  }

  if (OPERATOR_SURFACE_ONLY_TOOLS.has(name) && !ctx.operatorSurface) {
    return {
      permitted: false,
      refusal: 'operator-surface-only',
      effect,
      message: `${name} is only available in the Brahma Console.`,
    };
  }

  if (ctx.offer.kind === 'offered' && !ctx.offer.names.has(name)) {
    return {
      permitted: false,
      refusal: 'not-offered',
      effect,
      message:
        `Not run: \`${name}\` is not among the tools offered to you this turn. ` +
        'Nothing was changed. Carry on without it.',
    };
  }

  if (ctx.effectCeiling && !isWithinCeiling(effect, ctx.effectCeiling)) {
    return {
      permitted: false,
      refusal: 'above-ceiling',
      effect,
      message: describeCeilingRefusal(name, effect, ctx.effectCeiling),
    };
  }

  return { permitted: true, effect };
}
