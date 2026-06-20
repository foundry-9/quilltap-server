/**
 * The ONE place SVAR types enter Quilltap.
 *
 * Quarantine boundary (per the SVAR integration plan): no file outside
 * `components/files/svar/` may import from `@svar-ui/*`. Everything else in the
 * adapter imports the SVAR types it needs from here, so if SVAR is ever swapped
 * out, this is the only file that changes.
 *
 * SVAR's `@svar-ui/react-filemanager` re-exports the store types
 * (`export * from '@svar-ui/filemanager-store'`), so we pull them from the
 * top-level wrapper rather than reaching into the transitive store package.
 *
 * @module components/files/svar/svar-types
 */

import type {
  IApi,
  IEntity,
  IParsedEntity,
  IFile,
  TID,
  TMethodsConfig,
} from '@svar-ui/react-filemanager'

export type { IApi, IEntity, IParsedEntity, IFile, TID, TMethodsConfig }

/** SVAR action names the adapter cares about (keys of TMethodsConfig). */
export type SvarAction = keyof TMethodsConfig

/** Payloads for the mutating + read events we translate, by action name. */
export type SvarRenamePayload = TMethodsConfig['rename-file']
export type SvarCreatePayload = TMethodsConfig['create-file']
export type SvarDeletePayload = TMethodsConfig['delete-files']
export type SvarMovePayload = TMethodsConfig['move-files']
export type SvarCopyPayload = TMethodsConfig['copy-files']
export type SvarOpenPayload = TMethodsConfig['open-file']
export type SvarDownloadPayload = TMethodsConfig['download-file']
