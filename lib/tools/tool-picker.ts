/**
 * The tool picker — how each built-in tool appears in the per-chat tool
 * settings (`GET /api/v1/tools`), beside its definition.
 *
 * Every built-in tool with a declared effect (`BUILT_IN_TOOL_EFFECTS`) has an
 * entry: either *listed* — display name, description, category, its
 * definition (for `?includeSchemas=true`) and what a chat must have for it to
 * be available — or *unlisted*, with the reason. The snapshot test fails on a
 * tool with neither, which is what keeps the picker from drifting behind the
 * tool set again (the route's hand list had: thirteen declared tools were
 * absent and `doc_copy_file` had no availability rule).
 *
 * @module tools/tool-picker
 */

import { askCarinaToolDefinition } from './ask-carina-tool';
import { attachImageToolDefinition } from './attach-image-tool';
import { describeImageToolDefinition } from './describe-image-tool';
import { discardMailToolDefinition } from './discard-mail-tool';
import { docCopyFileToolDefinition } from './doc-copy-file-tool';
import { docCreateFolderToolDefinition } from './doc-create-folder-tool';
import { docDeleteFileToolDefinition } from './doc-delete-file-tool';
import { docDeleteFolderToolDefinition } from './doc-delete-folder-tool';
import { docGrepToolDefinition } from './doc-grep-tool';
import { docInsertTextToolDefinition } from './doc-insert-text-tool';
import { docListFilesToolDefinition } from './doc-list-files-tool';
import { docMoveFileToolDefinition } from './doc-move-file-tool';
import { docReadFileToolDefinition } from './doc-read-file-tool';
import { docReadFrontmatterToolDefinition } from './doc-read-frontmatter-tool';
import { docReadHeadingToolDefinition } from './doc-read-heading-tool';
import { docStrReplaceToolDefinition } from './doc-str-replace-tool';
import { docUpdateFrontmatterToolDefinition } from './doc-update-frontmatter-tool';
import { docUpdateHeadingToolDefinition } from './doc-update-heading-tool';
import { docWriteFileToolDefinition } from './doc-write-file-tool';
import { editCustomToolToolDefinition } from './edit-custom-tool-tool';
import { helpNavigateToolDefinition } from './help-navigate-tool';
import { helpSearchToolDefinition } from './help-search-tool';
import { helpSettingsToolDefinition } from './help-settings-tool';
import { imageGenerationToolDefinition } from './image-generation-tool';
import { inventoryArchiveToolDefinition } from './inventory-archive-tool';
import { inventoryCreateToolDefinition } from './inventory-create-tool';
import { inventoryEquipToolDefinition } from './inventory-equip-tool';
import { inventoryGiveToolDefinition } from './inventory-give-tool';
import { inventoryListToolDefinition } from './inventory-list-tool';
import { inventoryPickUpToolDefinition } from './inventory-pick-up-tool';
import { inventoryReadToolDefinition } from './inventory-read-tool';
import { inventoryUnequipToolDefinition } from './inventory-unequip-tool';
import { inventoryUpdateToolDefinition } from './inventory-update-tool';
import { keepImageToolDefinition } from './keep-image-tool';
import { listImagesToolDefinition } from './list-images-tool';
import { listMailToolDefinition } from './list-mail-tool';
import { logCreateEntryToolDefinition } from './log-create-entry-tool';
import { logGrepToolDefinition } from './log-grep-tool';
import { logReadToolDefinition } from './log-read-tool';
import { projectInfoToolDefinition } from './project-info-tool';
import { readMailToolDefinition } from './read-mail-tool';
import { rngToolDefinition } from './rng-tool';
import { runCustomToolDefinition } from './run-custom-tool';
import { searchScriptoriumToolDefinition } from './search-scriptorium-tool';
import { selfInventoryToolDefinition } from './self-inventory-tool';
import { sendMailToolDefinition } from './send-mail-tool';
import { stateToolDefinition } from './state-tool';
import { wardrobeArchiveToolDefinition } from './wardrobe-archive-tool';
import { wardrobeCreateToolDefinition } from './wardrobe-create-tool';
import { wardrobeHistoryToolDefinition } from './wardrobe-history-tool';
import { wardrobeListToolDefinition } from './wardrobe-list-tool';
import { wardrobeReadToolDefinition } from './wardrobe-read-tool';
import { wardrobeRollbackToolDefinition } from './wardrobe-rollback-tool';
import { wardrobeTakeOffToolDefinition } from './wardrobe-take-off-tool';
import { wardrobeUpdateToolDefinition } from './wardrobe-update-tool';
import { wardrobeWearToolDefinition } from './wardrobe-wear-tool';
import { webSearchToolDefinition } from './web-search-tool';
import { whisperToolDefinition } from './whisper-tool';

/** What a chat must have for a tool to be available in it. */
export type ToolRequirement =
  | 'imageProfile'
  | 'project'
  | 'documentStores'
  | 'webSearch'
  | 'multiCharacter'
  | 'canDressThemselves'
  | 'canCreateOutfits'
  | 'canManageInventory';

/** A tool the picker lists. */
export interface ListedToolPickerEntry {
  listed: true;
  name: string;
  description: string;
  category: string;
  /** The OpenAI-format definition; its `parameters` are served with `?includeSchemas=true`. */
  definition: { function: { name: string; parameters?: Record<string, unknown> } };
  /** Checked in order; the first unmet one is the reason given. */
  requires?: readonly ToolRequirement[];
}

/** A built-in tool the picker deliberately leaves out. */
export interface UnlistedToolPickerEntry {
  listed: false;
  reason: string;
}

export type ToolPickerEntry = ListedToolPickerEntry | UnlistedToolPickerEntry;

/** One entry per built-in tool, in picker order (listed first). */
export const BUILT_IN_TOOL_PICKER: Readonly<Record<string, ToolPickerEntry>> = {
  ask_carina: {
    listed: true,
    name: 'Ask Carina',
    description: 'Ask a designated answerer character a quick standalone question without joining the conversation',
    category: 'utility',
    definition: askCarinaToolDefinition,
  },
  send_mail: {
    listed: true,
    name: 'Send Mail',
    description: 'Post a Markdown letter to another character, delivered by Suparṇā into their vault mailbox',
    category: 'utility',
    definition: sendMailToolDefinition,
  },
  list_mail: {
    listed: true,
    name: 'List Mail',
    description: 'List the letters in your own mailbox, with the exact way to read, answer, or discard each',
    category: 'utility',
    definition: listMailToolDefinition,
  },
  read_mail: {
    listed: true,
    name: 'Read Mail',
    description: 'Read a letter from your own mailbox by its file name',
    category: 'utility',
    definition: readMailToolDefinition,
  },
  discard_mail: {
    listed: true,
    name: 'Discard Mail',
    description: 'Throw away a letter from your own mailbox by its file name',
    category: 'utility',
    definition: discardMailToolDefinition,
  },
  generate_image: {
    listed: true,
    name: 'Generate Image',
    description: 'Generate images using AI image generation providers',
    category: 'media',
    definition: imageGenerationToolDefinition,
    requires: ['imageProfile'],
  },
  search: {
    listed: true,
    name: 'Search',
    description: 'Search through the Scriptorium (character memories, past conversations, and story backgrounds)',
    category: 'search',
    definition: searchScriptoriumToolDefinition,
  },
  search_web: {
    listed: true,
    name: 'Search Web',
    description: 'Search the web for current information',
    category: 'search',
    definition: webSearchToolDefinition,
    requires: ['webSearch'],
  },
  project_info: {
    listed: true,
    name: 'Project Info',
    description: 'Access project information and files',
    category: 'project',
    definition: projectInfoToolDefinition,
    requires: ['project'],
  },
  help_search: {
    listed: true,
    name: 'Help Search',
    description: 'Search Quilltap help documentation for features, settings, and usage guidance',
    category: 'help',
    definition: helpSearchToolDefinition,
  },
  help_settings: {
    listed: true,
    name: 'Help Settings',
    description: 'Read instance settings to understand current configuration (API keys are never shown)',
    category: 'help',
    definition: helpSettingsToolDefinition,
  },
  help_navigate: {
    listed: true,
    name: 'Help Navigate',
    description: 'Navigate the user\'s browser to a specific Quilltap page or settings section',
    category: 'help',
    definition: helpNavigateToolDefinition,
  },
  rng: {
    listed: true,
    name: 'Random Number Generator',
    description: 'Roll dice, flip coins, or randomly select a chat participant (spin the bottle)',
    category: 'utility',
    definition: rngToolDefinition,
  },
  run_custom: {
    listed: true,
    name: 'Custom Tools',
    description: "Run one of this scene's user-authored custom tools (Tools/*.tool.json) — Pascal rolls it server-side and announces the outcome. Only offered when the chat can actually see at least one valid definition.",
    category: 'pascal',
    definition: runCustomToolDefinition,
  },
  edit_custom_tool: {
    listed: true,
    name: 'Edit Custom Tool',
    description: "Save or validate a custom tool definition (Tools/<name>.tool.json at the top level of a document store), or fetch the definition format (JSON Schema and worked examples) to write one from scratch. Every save is schema-validated first, and an invalid definition is not written.",
    category: 'pascal',
    definition: editCustomToolToolDefinition,
  },
  state: {
    listed: true,
    name: 'State Manager',
    description: 'Get, set, or delete persistent key-value state for the chat',
    category: 'utility',
    definition: stateToolDefinition,
  },
  log_create_entry: {
    listed: true,
    name: 'Write Log Entry',
    description: 'Write a timestamped line to the log, recorded against this chat and the writing character',
    category: 'log',
    definition: logCreateEntryToolDefinition,
  },
  log_grep: {
    listed: true,
    name: 'Search Log',
    description: 'Search every log entry in the instance by regular expression',
    category: 'log',
    definition: logGrepToolDefinition,
  },
  log_read: {
    listed: true,
    name: 'Read Log',
    description: 'Read log entries by chat, by character, and/or by a span of time',
    category: 'log',
    definition: logReadToolDefinition,
  },
  self_inventory: {
    listed: true,
    name: 'Self-Inventory',
    description: 'Return an introspection report for the calling character: vault files, memory and chat stats, assembled system prompt, and last-turn LLM token usage',
    category: 'utility',
    definition: selfInventoryToolDefinition,
  },
  whisper: {
    listed: true,
    name: 'Whisper',
    description: 'Send a private message to a specific character in a multi-character chat',
    category: 'utility',
    definition: whisperToolDefinition,
    requires: ['multiCharacter'],
  },
  wardrobe_list: {
    listed: true,
    name: 'List Wardrobe',
    description: 'Browse wardrobe items (own plus shared project / Quilltap General items) for the current character',
    category: 'wardrobe',
    definition: wardrobeListToolDefinition,
    requires: ['canDressThemselves'],
  },
  wardrobe_read: {
    listed: true,
    name: 'Read Wardrobe Item',
    description: 'Read the full detail of one wardrobe item, including its Portrait Cue',
    category: 'wardrobe',
    definition: wardrobeReadToolDefinition,
    requires: ['canDressThemselves'],
  },
  wardrobe_create: {
    listed: true,
    name: 'Create Wardrobe Item',
    description: 'Create a new wardrobe item, optionally equip it, or gift it to another character',
    category: 'wardrobe',
    definition: wardrobeCreateToolDefinition,
    requires: ['canCreateOutfits'],
  },
  wardrobe_update: {
    listed: true,
    name: 'Update Wardrobe Item',
    description: 'Edit the stored fields of an existing wardrobe item (own items only)',
    category: 'wardrobe',
    definition: wardrobeUpdateToolDefinition,
    requires: ['canCreateOutfits'],
  },
  wardrobe_archive: {
    listed: true,
    name: 'Archive Wardrobe Item',
    description: 'Retire a wardrobe item (own items only; restorable by a human)',
    category: 'wardrobe',
    definition: wardrobeArchiveToolDefinition,
    requires: ['canCreateOutfits'],
  },
  wardrobe_wear: {
    listed: true,
    name: 'Wear Wardrobe Items',
    description: 'Put on one or more wardrobe items (single garments or composite outfits)',
    category: 'wardrobe',
    definition: wardrobeWearToolDefinition,
    requires: ['canDressThemselves'],
  },
  wardrobe_take_off: {
    listed: true,
    name: 'Take Off Wardrobe Items',
    description: 'Take off worn wardrobe items or empty slots',
    category: 'wardrobe',
    definition: wardrobeTakeOffToolDefinition,
    requires: ['canDressThemselves'],
  },
  wardrobe_rollback: {
    listed: true,
    name: 'Return to an Earlier Outfit',
    description: 'Return to an outfit worn earlier in this chat, by its number',
    category: 'wardrobe',
    definition: wardrobeRollbackToolDefinition,
    requires: ['canDressThemselves'],
  },
  wardrobe_history: {
    listed: true,
    name: 'Outfit History',
    description: 'List the numbered outfits worn in this chat',
    category: 'wardrobe',
    definition: wardrobeHistoryToolDefinition,
    requires: ['canDressThemselves'],
  },
  inventory_list: {
    listed: true,
    name: 'List Inventory',
    description: "List the objects the character carries and can reach, with their states",
    category: 'inventory',
    definition: inventoryListToolDefinition,
    requires: ['canManageInventory'],
  },
  inventory_read: {
    listed: true,
    name: 'Read Inventory Object',
    description: "Read one object in full: descriptions, metadata, archetype, kit members",
    category: 'inventory',
    definition: inventoryReadToolDefinition,
    requires: ['canManageInventory'],
  },
  inventory_equip: {
    listed: true,
    name: 'Equip Objects',
    description: "Take up objects or kits in this chat",
    category: 'inventory',
    definition: inventoryEquipToolDefinition,
    requires: ['canManageInventory'],
  },
  inventory_unequip: {
    listed: true,
    name: 'Unequip Objects',
    description: "Set down carried objects in this chat",
    category: 'inventory',
    definition: inventoryUnequipToolDefinition,
    requires: ['canManageInventory'],
  },
  inventory_pick_up: {
    listed: true,
    name: 'Pick Up Object',
    description: "Make an instance of a reachable archetype in the character's vault, optionally equipped",
    category: 'inventory',
    definition: inventoryPickUpToolDefinition,
    requires: ['canManageInventory'],
  },
  inventory_create: {
    listed: true,
    name: 'Create Object',
    description: "Make a new object of the character's own",
    category: 'inventory',
    definition: inventoryCreateToolDefinition,
    requires: ['canManageInventory'],
  },
  inventory_update: {
    listed: true,
    name: 'Update Object',
    description: "Change one of the character's own objects",
    category: 'inventory',
    definition: inventoryUpdateToolDefinition,
    requires: ['canManageInventory'],
  },
  inventory_archive: {
    listed: true,
    name: 'Archive Object',
    description: "Put away (or restore) one of the character's own objects",
    category: 'inventory',
    definition: inventoryArchiveToolDefinition,
    requires: ['canManageInventory'],
  },
  inventory_give: {
    listed: true,
    name: 'Give Object',
    description: "Hand one of the character's own objects to another participant",
    category: 'inventory',
    definition: inventoryGiveToolDefinition,
    requires: ['canManageInventory'],
  },
  doc_read_file: {
    listed: true,
    name: 'Read Document',
    description: 'Read file contents from document stores or project files',
    category: 'documents',
    definition: docReadFileToolDefinition,
    requires: ['documentStores'],
  },
  doc_write_file: {
    listed: true,
    name: 'Write Document',
    description: 'Write or create a file in document stores or project files',
    category: 'documents',
    definition: docWriteFileToolDefinition,
    requires: ['documentStores'],
  },
  doc_str_replace: {
    listed: true,
    name: 'Find & Replace in Document',
    description: 'Find and replace exact text in a file (unique match required)',
    category: 'documents',
    definition: docStrReplaceToolDefinition,
    requires: ['documentStores'],
  },
  doc_insert_text: {
    listed: true,
    name: 'Insert Text in Document',
    description: 'Insert text at a specific position in a file',
    category: 'documents',
    definition: docInsertTextToolDefinition,
    requires: ['documentStores'],
  },
  doc_grep: {
    listed: true,
    name: 'Search Documents',
    description: 'Search for text across files in document stores and project files',
    category: 'documents',
    definition: docGrepToolDefinition,
    requires: ['documentStores'],
  },
  doc_list_files: {
    listed: true,
    name: 'List Documents',
    description: 'List files available in document stores and project files',
    category: 'documents',
    definition: docListFilesToolDefinition,
    requires: ['documentStores'],
  },
  doc_read_frontmatter: {
    listed: true,
    name: 'Read Frontmatter',
    description: 'Read YAML frontmatter from a markdown file',
    category: 'documents',
    definition: docReadFrontmatterToolDefinition,
    requires: ['documentStores'],
  },
  doc_update_frontmatter: {
    listed: true,
    name: 'Update Frontmatter',
    description: 'Update YAML frontmatter properties in a markdown file',
    category: 'documents',
    definition: docUpdateFrontmatterToolDefinition,
    requires: ['documentStores'],
  },
  doc_read_heading: {
    listed: true,
    name: 'Read Heading Section',
    description: 'Read all content under a specific heading in a markdown file',
    category: 'documents',
    definition: docReadHeadingToolDefinition,
    requires: ['documentStores'],
  },
  doc_update_heading: {
    listed: true,
    name: 'Update Heading Section',
    description: 'Replace content under a specific heading in a markdown file',
    category: 'documents',
    definition: docUpdateHeadingToolDefinition,
    requires: ['documentStores'],
  },
  doc_move_file: {
    listed: true,
    name: 'Move/Rename Document',
    description: 'Move or rename a file in document stores or project files',
    category: 'documents',
    definition: docMoveFileToolDefinition,
    requires: ['documentStores'],
  },
  doc_copy_file: {
    listed: true,
    name: 'Copy Document',
    description: 'Copy a file from one document store to a different document store',
    category: 'documents',
    definition: docCopyFileToolDefinition,
    requires: ['documentStores'],
  },
  doc_delete_file: {
    listed: true,
    name: 'Delete Document',
    description: 'Permanently delete a file from document stores or project files',
    category: 'documents',
    definition: docDeleteFileToolDefinition,
    requires: ['documentStores'],
  },
  doc_create_folder: {
    listed: true,
    name: 'Create Folder',
    description: 'Create a new folder in document stores or project files',
    category: 'documents',
    definition: docCreateFolderToolDefinition,
    requires: ['documentStores'],
  },
  doc_delete_folder: {
    listed: true,
    name: 'Delete Folder',
    description: 'Delete an empty folder from document stores or project files',
    category: 'documents',
    definition: docDeleteFolderToolDefinition,
    requires: ['documentStores'],
  },
  keep_image: {
    listed: true,
    name: 'Keep Image',
    description: "Save a generated image to the character's photo album with optional caption and tags",
    category: 'photos',
    definition: keepImageToolDefinition,
  },
  list_images: {
    listed: true,
    name: 'List Kept Images',
    description: 'Search or list images previously saved to the photo album',
    category: 'photos',
    definition: listImagesToolDefinition,
  },
  attach_image: {
    listed: true,
    name: 'Attach Kept Image',
    description: 'Re-attach a previously kept image to the current chat message',
    category: 'photos',
    definition: attachImageToolDefinition,
  },
  describe_image: {
    listed: true,
    name: 'Describe Image',
    description: 'Look at an image and report what it depicts',
    category: 'photos',
    definition: describeImageToolDefinition,
  },
  delete_annotation: { listed: false, reason: "Not yet listed: whether the picker shows it awaits decision 4 of refactor-4-13-api-input-schemas.md." },
  doc_close_document: { listed: false, reason: "Not yet listed: whether the picker shows it awaits decision 4 of refactor-4-13-api-input-schemas.md." },
  doc_delete_blob: { listed: false, reason: "Not yet listed: whether the picker shows it awaits decision 4 of refactor-4-13-api-input-schemas.md." },
  doc_focus: { listed: false, reason: "Not yet listed: whether the picker shows it awaits decision 4 of refactor-4-13-api-input-schemas.md." },
  doc_list_blobs: { listed: false, reason: "Not yet listed: whether the picker shows it awaits decision 4 of refactor-4-13-api-input-schemas.md." },
  doc_move_folder: { listed: false, reason: "Not yet listed: whether the picker shows it awaits decision 4 of refactor-4-13-api-input-schemas.md." },
  doc_open_document: { listed: false, reason: "Not yet listed: whether the picker shows it awaits decision 4 of refactor-4-13-api-input-schemas.md." },
  doc_read_blob: { listed: false, reason: "Not yet listed: whether the picker shows it awaits decision 4 of refactor-4-13-api-input-schemas.md." },
  doc_write_blob: { listed: false, reason: "Not yet listed: whether the picker shows it awaits decision 4 of refactor-4-13-api-input-schemas.md." },
  lookup_character: { listed: false, reason: "Brahma's Console only (operator surface)." },
  lookup_memories: { listed: false, reason: "Brahma's Console only (operator surface)." },
  lookup_messages: { listed: false, reason: "Brahma's Console only (operator surface)." },
  read_conversation: { listed: false, reason: "Not yet listed: whether the picker shows it awaits decision 4 of refactor-4-13-api-input-schemas.md." },
  read_messages: { listed: false, reason: "Brahma's Console only (operator surface)." },
  request_full_context: { listed: false, reason: "A safety valve: always offered, never switchable." },
  run_sql: { listed: false, reason: "Brahma's Console only (operator surface)." },
  submit_final_response: { listed: false, reason: "Agent mode's own closing call, not a tool an operator chooses." },
  terminal_list: { listed: false, reason: "Not yet listed: whether the picker shows it awaits decision 4 of refactor-4-13-api-input-schemas.md." },
  terminal_read: { listed: false, reason: "Not yet listed: whether the picker shows it awaits decision 4 of refactor-4-13-api-input-schemas.md." },
  upsert_annotation: { listed: false, reason: "Not yet listed: whether the picker shows it awaits decision 4 of refactor-4-13-api-input-schemas.md." },
};

/** The facts about one chat that the requirements are checked against. */
export interface ToolAvailabilityContext {
  hasImageProfile: boolean;
  hasProject: boolean;
  hasDocumentStores: boolean;
  allowsWebSearch: boolean;
  webSearchConfigured: boolean;
  isMultiCharacter: boolean;
  canDressThemselves: boolean;
  canCreateOutfits: boolean;
  canManageInventory: boolean;
}

/** Why a requirement is unmet, or null when it is met. */
function unmetReason(requirement: ToolRequirement, ctx: ToolAvailabilityContext): string | null {
  switch (requirement) {
    case 'imageProfile':
      return ctx.hasImageProfile ? null : 'Requires an image generation profile to be configured for the character';
    case 'project':
      return ctx.hasProject ? null : 'Chat must be associated with a project';
    case 'documentStores':
      if (!ctx.hasProject) return 'Chat must be associated with a project';
      return ctx.hasDocumentStores
        ? null
        : 'Project must have linked document stores (configure in Project > The Scriptorium)';
    case 'webSearch':
      if (!ctx.allowsWebSearch) return 'Web search must be enabled in the connection profile';
      return ctx.webSearchConfigured
        ? null
        : 'No search provider configured. Please add a search provider API key in Settings > API Keys.';
    case 'multiCharacter':
      return ctx.isMultiCharacter ? null : 'Whisper requires a multi-character chat with more than one active character';
    case 'canDressThemselves':
      return ctx.canDressThemselves ? null : 'Character does not have wardrobe self-dressing enabled';
    case 'canCreateOutfits':
      return ctx.canCreateOutfits ? null : 'Character does not have wardrobe item creation enabled';
    case 'canManageInventory':
      return ctx.canManageInventory ? null : 'Character does not have inventory management enabled';
  }
}

/** Whether a listed tool is available in a chat, and if not, why. */
export function toolAvailability(
  entry: ListedToolPickerEntry,
  ctx: ToolAvailabilityContext,
): { available: true } | { available: false; unavailableReason: string } {
  for (const requirement of entry.requires ?? []) {
    const reason = unmetReason(requirement, ctx);
    if (reason) return { available: false, unavailableReason: reason };
  }
  return { available: true };
}

/** The listed entries, in picker order, with their ids. */
export function listedPickerTools(): Array<[string, ListedToolPickerEntry]> {
  return Object.entries(BUILT_IN_TOOL_PICKER).filter(
    (pair): pair is [string, ListedToolPickerEntry] => pair[1].listed,
  );
}
