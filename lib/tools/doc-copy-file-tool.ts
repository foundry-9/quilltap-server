/**
 * @fileoverview Tool definition for copying a file from one document store to another.
 *
 * Cross-store only: source_mount_point and dest_mount_point must resolve to
 * different mount points. For same-store duplication, the LLM can still read
 * the file and write a copy, or a future tool can add that capability.
 *
 * Text files only, matching doc_move_file / doc_write_file. Binary assets are
 * out of scope here — the blob family (doc_*_blob) handles those.
 *
 * Destination path semantics:
 *   - Empty / "." / "/"  → copy to dest store root using source basename
 *   - Existing directory → copy into directory using source basename
 *   - Otherwise          → treat as full path (parent folders auto-created)
 *
 * Refuses to overwrite an existing destination file, matching doc_move_file.
 */

export const docCopyFileTool = {
  type: 'function',
  function: {
    name: 'doc_copy_file',
    description:
      'Copy a file from one document store to a different document store. The source and destination must be in different document stores. If dest_path points to an existing folder, the file is copied into it using the source filename; otherwise dest_path is treated as the full destination path (with filename). Parent directories are created automatically. Will not overwrite an existing file at the destination.',
    parameters: {
      type: 'object',
      properties: {
        source_mount_point: {
          type: 'string',
          description: 'Name (or ID) of the document store to copy the file from.',
        },
        source_path: {
          type: 'string',
          description: 'Relative path to the source file within the source document store.',
        },
        dest_mount_point: {
          type: 'string',
          description: 'Name (or ID) of the document store to copy the file into. Must be different from source_mount_point.',
        },
        dest_path: {
          type: 'string',
          description: 'Destination path within the destination document store. If this path already exists as a directory, the file is dropped into it with the source filename. Otherwise it is treated as the full path with filename. Use "" or "." to copy to the root of the destination store.',
        },
      },
      required: ['source_mount_point', 'source_path', 'dest_mount_point', 'dest_path'],
    },
  },
};

/**
 * Validates input for doc_copy_file tool.
 */
export function validateDocCopyFileInput(input: unknown): input is DocCopyFileInput {
  if (typeof input !== 'object' || input === null) {
    return false;
  }

  const obj = input as Record<string, unknown>;

  if (typeof obj.source_mount_point !== 'string' || obj.source_mount_point.length === 0) {
    return false;
  }
  if (typeof obj.source_path !== 'string' || obj.source_path.length === 0) {
    return false;
  }
  if (typeof obj.dest_mount_point !== 'string' || obj.dest_mount_point.length === 0) {
    return false;
  }
  if (typeof obj.dest_path !== 'string') {
    return false;
  }

  return true;
}

export interface DocCopyFileInput {
  source_mount_point: string;
  source_path: string;
  dest_mount_point: string;
  dest_path: string;
}

export interface DocCopyFileOutput {
  success: boolean;
  source_mount_point: string;
  source_path: string;
  dest_mount_point: string;
  dest_path: string;
  mtime: number;
}
