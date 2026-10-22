/**
 * Tool definition parameters — snapshot test
 *
 * Captures the OpenAI-shape `parameters` JSON Schema derived from each tool's
 * Zod input schema. Any drift between the Zod source of truth and the JSON
 * output (intended or accidental) will fail this snapshot and force a
 * deliberate review of what changed before it ships to providers.
 *
 * If a snapshot diff is intentional (e.g., a new tool parameter, a tightened
 * constraint), update with `npx jest -u lib/tools/__tests__/tool-definitions-snapshot.test.ts`
 * and review the diff in the PR.
 */

import { askCarinaToolDefinition } from '../ask-carina-tool'
import { attachImageToolDefinition } from '../attach-image-tool'
import { deleteAnnotationToolDefinition } from '../delete-annotation-tool'
import { describeImageToolDefinition } from '../describe-image-tool'
import { docCloseDocumentToolDefinition } from '../doc-close-document-tool'
import { docCopyFileToolDefinition } from '../doc-copy-file-tool'
import { docCreateFolderToolDefinition } from '../doc-create-folder-tool'
import { docDeleteBlobToolDefinition } from '../doc-delete-blob-tool'
import { docDeleteFileToolDefinition } from '../doc-delete-file-tool'
import { docDeleteFolderToolDefinition } from '../doc-delete-folder-tool'
import { docFocusToolDefinition } from '../doc-focus-tool'
import { docGrepToolDefinition } from '../doc-grep-tool'
import { docInsertTextToolDefinition } from '../doc-insert-text-tool'
import { docListBlobsToolDefinition } from '../doc-list-blobs-tool'
import { docListFilesToolDefinition } from '../doc-list-files-tool'
import { docMoveFileToolDefinition } from '../doc-move-file-tool'
import { docMoveFolderToolDefinition } from '../doc-move-folder-tool'
import { docOpenDocumentToolDefinition } from '../doc-open-document-tool'
import { docReadBlobToolDefinition } from '../doc-read-blob-tool'
import { docReadFileToolDefinition } from '../doc-read-file-tool'
import { docReadFrontmatterToolDefinition } from '../doc-read-frontmatter-tool'
import { docReadHeadingToolDefinition } from '../doc-read-heading-tool'
import { docStrReplaceToolDefinition } from '../doc-str-replace-tool'
import { docUpdateFrontmatterToolDefinition } from '../doc-update-frontmatter-tool'
import { docUpdateHeadingToolDefinition } from '../doc-update-heading-tool'
import { docWriteBlobToolDefinition } from '../doc-write-blob-tool'
import { docWriteFileToolDefinition } from '../doc-write-file-tool'
import { helpNavigateToolDefinition } from '../help-navigate-tool'
import { helpSearchToolDefinition } from '../help-search-tool'
import { helpSettingsToolDefinition } from '../help-settings-tool'
import { imageGenerationToolDefinition } from '../image-generation-tool'
import { keepImageToolDefinition } from '../keep-image-tool'
import { listMailToolDefinition } from '../list-mail-tool'
import { readMailToolDefinition } from '../read-mail-tool'
import { discardMailToolDefinition } from '../discard-mail-tool'
import { listImagesToolDefinition } from '../list-images-tool'
import { sendMailToolDefinition } from '../send-mail-tool'
import { projectInfoToolDefinition } from '../project-info-tool'
import { readConversationToolDefinition } from '../read-conversation-tool'
import { logCreateEntryToolDefinition } from '../log-create-entry-tool'
import { logGrepToolDefinition } from '../log-grep-tool'
import { logReadToolDefinition } from '../log-read-tool'
import { requestFullContextToolDefinition } from '../request-full-context-tool'
import { rngToolDefinition } from '../rng-tool'
import { runCustomToolDefinition } from '../run-custom-tool'
import { editCustomToolToolDefinition } from '../edit-custom-tool-tool'
import { runSqlToolDefinition } from '../run-sql-tool'
import {
  searchScriptoriumToolDefinition,
  searchScriptoriumBrahmaToolDefinition,
  searchScriptoriumScenarioToolDefinition,
} from '../search-scriptorium-tool'
import { selfInventoryToolDefinition } from '../self-inventory-tool'
import { stateToolDefinition } from '../state-tool'
import { submitFinalResponseToolDefinition } from '../submit-final-response-tool'
import { terminalListToolDefinition } from '../terminal-list-tool'
import { terminalReadToolDefinition } from '../terminal-read-tool'
import { upsertAnnotationToolDefinition } from '../upsert-annotation-tool'
import { wardrobeListToolDefinition } from '../wardrobe-list-tool'
import { wardrobeReadToolDefinition } from '../wardrobe-read-tool'
import { wardrobeCreateToolDefinition } from '../wardrobe-create-tool'
import { wardrobeUpdateToolDefinition } from '../wardrobe-update-tool'
import { wardrobeArchiveToolDefinition } from '../wardrobe-archive-tool'
import { wardrobeWearToolDefinition } from '../wardrobe-wear-tool'
import { wardrobeTakeOffToolDefinition } from '../wardrobe-take-off-tool'
import { wardrobeRollbackToolDefinition } from '../wardrobe-rollback-tool'
import { wardrobeHistoryToolDefinition } from '../wardrobe-history-tool'
import { inventoryListToolDefinition } from '../inventory-list-tool'
import { inventoryReadToolDefinition } from '../inventory-read-tool'
import { inventoryEquipToolDefinition } from '../inventory-equip-tool'
import { inventoryUnequipToolDefinition } from '../inventory-unequip-tool'
import { inventoryPickUpToolDefinition } from '../inventory-pick-up-tool'
import { inventoryCreateToolDefinition } from '../inventory-create-tool'
import { inventoryUpdateToolDefinition } from '../inventory-update-tool'
import { inventoryArchiveToolDefinition } from '../inventory-archive-tool'
import { inventoryGiveToolDefinition } from '../inventory-give-tool'
import { webSearchToolDefinition } from '../web-search-tool'
import { whisperToolDefinition } from '../whisper-tool'
import { BUILT_IN_TOOL_EFFECTS, effectOfToolCall, isComputedToolEffect, TOOL_EFFECTS } from '../effects'

const ALL_TOOLS = {
  askCarina: askCarinaToolDefinition,
  attachImage: attachImageToolDefinition,
  deleteAnnotation: deleteAnnotationToolDefinition,
  describeImage: describeImageToolDefinition,
  docCloseDocument: docCloseDocumentToolDefinition,
  docCopyFile: docCopyFileToolDefinition,
  docCreateFolder: docCreateFolderToolDefinition,
  docDeleteBlob: docDeleteBlobToolDefinition,
  docDeleteFile: docDeleteFileToolDefinition,
  docDeleteFolder: docDeleteFolderToolDefinition,
  docFocus: docFocusToolDefinition,
  docGrep: docGrepToolDefinition,
  docInsertText: docInsertTextToolDefinition,
  docListBlobs: docListBlobsToolDefinition,
  docListFiles: docListFilesToolDefinition,
  docMoveFile: docMoveFileToolDefinition,
  docMoveFolder: docMoveFolderToolDefinition,
  docOpenDocument: docOpenDocumentToolDefinition,
  docReadBlob: docReadBlobToolDefinition,
  docReadFile: docReadFileToolDefinition,
  docReadFrontmatter: docReadFrontmatterToolDefinition,
  docReadHeading: docReadHeadingToolDefinition,
  docStrReplace: docStrReplaceToolDefinition,
  docUpdateFrontmatter: docUpdateFrontmatterToolDefinition,
  docUpdateHeading: docUpdateHeadingToolDefinition,
  docWriteBlob: docWriteBlobToolDefinition,
  docWriteFile: docWriteFileToolDefinition,
  helpNavigate: helpNavigateToolDefinition,
  helpSearch: helpSearchToolDefinition,
  helpSettings: helpSettingsToolDefinition,
  imageGeneration: imageGenerationToolDefinition,
  inventoryList: inventoryListToolDefinition,
  inventoryRead: inventoryReadToolDefinition,
  inventoryEquip: inventoryEquipToolDefinition,
  inventoryUnequip: inventoryUnequipToolDefinition,
  inventoryPickUp: inventoryPickUpToolDefinition,
  inventoryCreate: inventoryCreateToolDefinition,
  inventoryUpdate: inventoryUpdateToolDefinition,
  inventoryArchive: inventoryArchiveToolDefinition,
  inventoryGive: inventoryGiveToolDefinition,
  keepImage: keepImageToolDefinition,
  listMail: listMailToolDefinition,
  readMail: readMailToolDefinition,
  discardMail: discardMailToolDefinition,
  listImages: listImagesToolDefinition,
  sendMail: sendMailToolDefinition,
  projectInfo: projectInfoToolDefinition,
  readConversation: readConversationToolDefinition,
  logCreateEntry: logCreateEntryToolDefinition,
  logGrep: logGrepToolDefinition,
  logRead: logReadToolDefinition,
  requestFullContext: requestFullContextToolDefinition,
  rng: rngToolDefinition,
  runCustom: runCustomToolDefinition,
  editCustomTool: editCustomToolToolDefinition,
  runSql: runSqlToolDefinition,
  searchScriptorium: searchScriptoriumToolDefinition,
  searchScriptoriumBrahma: searchScriptoriumBrahmaToolDefinition,
  searchScriptoriumScenario: searchScriptoriumScenarioToolDefinition,
  selfInventory: selfInventoryToolDefinition,
  state: stateToolDefinition,
  submitFinalResponse: submitFinalResponseToolDefinition,
  terminalList: terminalListToolDefinition,
  terminalRead: terminalReadToolDefinition,
  upsertAnnotation: upsertAnnotationToolDefinition,
  wardrobeList: wardrobeListToolDefinition,
  wardrobeRead: wardrobeReadToolDefinition,
  wardrobeCreate: wardrobeCreateToolDefinition,
  wardrobeUpdate: wardrobeUpdateToolDefinition,
  wardrobeArchive: wardrobeArchiveToolDefinition,
  wardrobeWear: wardrobeWearToolDefinition,
  wardrobeTakeOff: wardrobeTakeOffToolDefinition,
  wardrobeRollback: wardrobeRollbackToolDefinition,
  wardrobeHistory: wardrobeHistoryToolDefinition,
  webSearch: webSearchToolDefinition,
  whisper: whisperToolDefinition,
}

describe('tool definitions: derived OpenAI parameters', () => {
  for (const [key, tool] of Object.entries(ALL_TOOLS)) {
    it(`${key}: parameters snapshot`, () => {
      expect(tool.function.parameters).toMatchSnapshot()
    })
  }

  it('every tool exposes name + description + parameters', () => {
    for (const [key, tool] of Object.entries(ALL_TOOLS)) {
      expect(tool.function.name).toBeTruthy()
      expect(tool.function.description).toBeTruthy()
      expect(tool.function.parameters).toBeTruthy()
      expect((tool.function.parameters as Record<string, unknown>).type).toBe('object')
    }
    expect.assertions(Object.entries(ALL_TOOLS).length * 4)
  })
})

describe('tool definitions: declared effects', () => {
  it('every registered tool declares an effect', () => {
    const missing = Object.values(ALL_TOOLS)
      .map((tool) => tool.function.name)
      .filter((name) => !(name in BUILT_IN_TOOL_EFFECTS))
    expect(missing).toEqual([])
  })

  it('every declared effect names a registered tool', () => {
    const registered = new Set(Object.values(ALL_TOOLS).map((tool) => tool.function.name))
    expect(Object.keys(BUILT_IN_TOOL_EFFECTS).filter((name) => !registered.has(name))).toEqual([])
  })

  it('effects snapshot (static effect, or "computed (max <effect>)")', () => {
    const table = Object.fromEntries(
      Object.entries(BUILT_IN_TOOL_EFFECTS)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([name, spec]) => [name, isComputedToolEffect(spec) ? `computed (max ${spec.maxEffect})` : spec])
    )
    expect(table).toMatchSnapshot()
  })

  it('every static effect is a known level', () => {
    for (const spec of Object.values(BUILT_IN_TOOL_EFFECTS)) {
      if (!isComputedToolEffect(spec)) expect(TOOL_EFFECTS).toContain(spec)
    }
  })

  // A computed effect must cover every branch its schema allows, and never
  // exceed the maximum it declares.
  const COMPUTED_EXAMPLES: Record<string, Array<[unknown, string]>> = {
    state: [
      [{ operation: 'fetch' }, 'read'],
      [{ operation: 'fetch', context: 'project', path: 'a.b' }, 'read'],
      [{ operation: 'set', path: 'a', value: 1 }, 'write'],
      [{ operation: 'delete', path: 'a' }, 'write'],
      [{ operation: 'explode' }, 'write'],
    ],
    edit_custom_tool: [
      [{ action: 'schema' }, 'none'],
      [{ mount_point: 'self', file: 'unlock' }, 'read'],
      [{ mount_point: 'self', file: 'unlock', content: '{}' }, 'write'],
      [{}, 'write'],
    ],
    doc_open_document: [
      [{ path: 'Notes/today.md' }, 'read'],
      [{ uri: 'qtap://Some Store/a.md' }, 'read'],
      [{ title: 'Blank' }, 'write'],
      [{}, 'write'],
    ],
    run_custom: [
      [{ tool: 'peek' }, 'read'],
      [{ tool: 'unlock' }, 'write'],
      [{ tool: 'unknown' }, 'write'],
      [{}, 'write'],
    ],
  }
  const lookups = { customToolEffects: new Map([['peek', 'read' as const], ['unlock', 'write' as const]]) }

  it('every computed tool has examples', () => {
    const computed = Object.entries(BUILT_IN_TOOL_EFFECTS)
      .filter(([, spec]) => isComputedToolEffect(spec))
      .map(([name]) => name)
      .sort()
    expect(computed).toEqual(Object.keys(COMPUTED_EXAMPLES).sort())
  })

  for (const [name, examples] of Object.entries(COMPUTED_EXAMPLES)) {
    it(`${name}: computed effect covers each branch`, () => {
      const spec = BUILT_IN_TOOL_EFFECTS[name]
      for (const [input, expected] of examples) {
        expect(effectOfToolCall(name, input, lookups)).toBe(expected)
      }
      if (isComputedToolEffect(spec)) {
        for (const [input] of examples) {
          const order = ['none', 'read', 'write', 'destroy']
          expect(order.indexOf(spec(input, lookups))).toBeLessThanOrEqual(order.indexOf(spec.maxEffect))
        }
      }
    })
  }
})
