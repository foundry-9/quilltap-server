/**
 * The character vault: the layout table and everything derived from it.
 * See `layout.ts` for the table and `docs/developer/DDL.md` (characters) for
 * the row/vault split.
 *
 * @module characters/vault
 */

export * from './layout';
export * from './file-schemas';
export {
  hasLinkedVault,
  markdownToNullable,
  stableUuidFromString,
  parsePromptFile,
  parseScenarioFile,
  parseScenarioFilesSorted,
  parseVaultProperties,
  parseVaultMetadata,
  parseVaultPhysicalPrompts,
  isPromptItemDocument,
  isScenarioItemDocument,
} from './parsers';
export { applyDocumentStoreOverlay, applyDocumentStoreOverlayOne } from './hydrate';
export {
  writeCharacterVaultManagedFields,
  applyDocumentStoreWriteOverlay,
  type VaultManagedFieldsWriteInput,
  type VaultManagedFieldsWriteResult,
} from './write';
export { readVaultFile, readVaultFileStrict, readCharacterVaultPropertiesForWrite } from './readers';
export {
  scaffoldCharacterMount,
  ensureCharacterMetadataFile,
  ensureCharacterPropertiesFile,
  ensureCharacterPhysicalFiles,
  METADATA_JSON_SEED,
  PROPERTIES_JSON_SEED,
  type CharacterScaffoldResult,
} from './scaffold';
