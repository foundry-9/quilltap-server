/**
 * Errors the document core raises, shared by its two kinds of caller — the
 * operator's Document Mode routes (which map them to HTTP) and the `doc_*`
 * tools (which surface their messages as tool errors).
 *
 * @module lib/documents/core/errors
 */

/**
 * The document changed underneath the caller: a rename/create target already
 * exists, or a write's mtime precondition failed because the file was edited
 * elsewhere since it was read. Routes map it to a 409.
 */
export class DocumentConflictError extends Error {}

/** The requested document does not exist. */
export class DocumentMissingError extends Error {}

/** Thrown when an editor write targets a file Document Mode only views. */
export class DocumentReadOnlyError extends Error {}
