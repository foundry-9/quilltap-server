/**
 * The document core: every file-level job on a document in a store — read
 * (with the one blob fallback), write (with the one refresh), rename/move
 * (with the one `chat_documents` sweep), delete, create, and the read-only
 * view classification.
 *
 * Two kinds of caller drive it and keep only what is theirs: the operator's
 * Document Mode routes (`lib/documents/operator-doc-actions` /
 * `operator-doc-http` — access contexts, HTTP mapping, Librarian posts) and
 * the `doc_*` tool handlers (`lib/tools/handlers/doc-edit/` — the
 * character's resolution context, policy gates, tool-result shapes). Below
 * it sit the `lib/doc-edit` primitives and the database store. A grep-test
 * (`__tests__/unit/lib/documents/core-chokepoint.test.ts`) keeps both kinds
 * of caller off those primitives.
 *
 * @module lib/documents/core
 */

export { DocumentConflictError, DocumentMissingError, DocumentReadOnlyError } from './errors';
export { readDocument, statDocument, documentExists, type DocumentRead } from './read';
export { writeDocument, afterDocumentWrite, ensureDocument } from './write';
export {
  renameDocument,
  computeRenameTarget,
  sweepChatDocumentsAfterMove,
  type RenameDocumentResult,
  type RenameTarget,
} from './move';
export { deleteDocument } from './delete';
export { viewTargetFor } from './view-target';
