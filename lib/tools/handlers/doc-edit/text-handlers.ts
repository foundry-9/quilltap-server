/**
 * Text file tool handlers: doc_read_file, doc_write_file, doc_str_replace,
 * doc_insert_text, doc_grep, and doc_list_files.
 *
 * Extracted from doc-edit-handler.ts as part of the doc-edit handler split.
 *
 * @module tools/handlers/doc-edit/text-handlers
 */

import path from 'path';
import fs from 'fs/promises';
import {
  resolveDocEditPath,
  readFileWithMtime,
  writeFileWithMtimeCheck,
  getAccessibleMountPoints,
  resolveMountPointRef,
  isTextFile,
  findUniqueMatch,
  findAllMatches,
  type DocEditScope,
} from '@/lib/doc-edit';
import {
  detectMimeFromExtension,
  isJsonFamily,
  isJsonlMime,
  parseContent,
  serializeContent,
  validateJson,
  type JsonlLineResult,
} from '@/lib/doc-edit/mime-registry';

import type { DocReadFileInput, DocReadFileOutput } from '../../doc-read-file-tool';
import type { DocWriteFileInput, DocWriteFileOutput } from '../../doc-write-file-tool';
import type { DocStrReplaceInput, DocStrReplaceOutput } from '../../doc-str-replace-tool';
import type { DocInsertTextInput, DocInsertTextOutput } from '../../doc-insert-text-tool';
import type { DocGrepInput, DocGrepOutput, DocGrepMatch } from '../../doc-grep-tool';
import type { DocListFilesInput, DocListFilesOutput, DocFileInfo } from '../../doc-list-files-tool';
import { isAutomaticImagePath, isOsCruftName } from '@/lib/files/folder-utils';
import { getRepositories } from '@/lib/repositories/factory';
import { listDatabaseFiles } from '@/lib/mount-index/database-store';
import { resolveGroupMountPointIdsForCharacter } from '@/lib/mount-index/tiered-mount-pool';
import {
  logger,
  type DocEditToolContext,
  collectPeerCharacterIdsForReads,
  buildReadResolutionContext,
  buildWriteResolutionContext,
  resolveOfficialProjectMount,
  triggerReindexIfNeeded,
} from './shared';

/**
 * Get the line number for a character offset in content.
 */
function getLineNumber(content: string, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset && i < content.length; i++) {
    if (content[i] === '\n') line++;
  }
  return line;
}

// --- doc_read_file ---

export async function handleReadFile(
  input: DocReadFileInput,
  context: DocEditToolContext
): Promise<{ success: boolean; result?: DocReadFileOutput; error?: string; formattedText?: string }> {
  const scope = (input.scope || 'document_store') as DocEditScope;
  const resolved = await resolveDocEditPath(scope, input.path, await buildReadResolutionContext(input, context));

  // For database-backed stores, a non-text file (pdf/docx/arbitrary binary)
  // may still be readable if the blob has an extractedText representation.
  // Return that derived text with derivedFromBlob=true so callers know the
  // original bytes aren't what they're seeing.
  if (!isTextFile(resolved.relativePath)) {
    if (resolved.mountType === 'database' && resolved.mountPointId) {
      const repos = getRepositories();
      const blob = await repos.docMountBlobs.findByMountPointAndPath(
        resolved.mountPointId,
        resolved.relativePath
      );
      if (blob?.extractedText && blob.extractionStatus === 'converted') {
        const text = blob.extractedText;
        const lines = text.split('\n');
        const totalLines = lines.length;

        let outputLines = lines;
        let truncated = false;
        if (input.offset || input.limit) {
          const startLine = (input.offset || 1) - 1;
          const endLine = input.limit ? startLine + input.limit : lines.length;
          outputLines = lines.slice(startLine, endLine);
          truncated = endLine < lines.length;
        }

        const lineStart = input.offset || 1;
        const numberedLines = outputLines
          .map((line, i) => `[L${lineStart + i}] ${line}`)
          .join('\n');
        const header = `File: ${input.path} (extracted text from ${blob.storedMimeType}, ${totalLines} lines, ${blob.sizeBytes} original bytes)`;
        const truncMsg = truncated
          ? `\n[Truncated — showing lines ${lineStart}-${lineStart + outputLines.length - 1} of ${totalLines}]`
          : '';
        const formattedText = `${header}${truncMsg}\n\n${numberedLines}`;

        const result: DocReadFileOutput = {
          content: outputLines.join('\n'),
          mimeType: blob.storedMimeType,
          path: input.path,
          mtime: new Date(blob.updatedAt).getTime(),
          totalLines,
          truncated,
          derivedFromBlob: true,
        };
        return { success: true, result, formattedText };
      }
    }
    return { success: false, error: `File is not a supported text format: ${input.path}` };
  }

  const { content: rawContent, mtime, size } = await readFileWithMtime(resolved);
  const mime = detectMimeFromExtension(resolved.relativePath);

  let content: string | unknown = rawContent;
  let parsed = false;
  let parseError: { message: string; line?: number } | undefined;
  let formattedText: string;

  // For JSON/JSONL, parse the content
  if (isJsonFamily(mime)) {
    const parseResult = parseContent(rawContent, mime!);
    if (parseResult.ok) {
      content = parseResult.value;
      parsed = true;

      if (isJsonlMime(mime)) {
        const lines = parseResult.value as JsonlLineResult[];
        parsed = lines.some(l => !l.error);

        // Format JSONL for display
        const lines_formatted = lines.map(
          (l) => `[L${l.line}] ${l.error ? `PARSE ERROR: ${l.error}` : JSON.stringify(l.value)}`
        );
        formattedText = `File: ${input.path} (JSONL, ${lines.length} entries)\n\n${lines_formatted.join('\n')}`;
      } else {
        // Format JSON for display
        const formatted = JSON.stringify(content, null, 2);
        formattedText = `File: ${input.path} (JSON)\n\n${formatted}`;
      }
    } else {
      content = rawContent;
      parsed = false;
      parseError = { message: parseResult.error, line: parseResult.line };
      formattedText = `File: ${input.path} — Parse Error: ${parseResult.error}`;
    }
  } else {
    // Non-JSON: format with line numbers as before
    const lines = rawContent.split('\n');
    const totalLines = lines.length;

    let outputLines = lines;
    let truncated = false;

    if (input.offset || input.limit) {
      const startLine = (input.offset || 1) - 1;
      const endLine = input.limit ? startLine + input.limit : lines.length;
      outputLines = lines.slice(startLine, endLine);
      truncated = endLine < lines.length;
    }

    content = outputLines.join('\n');
    const lineStart = input.offset || 1;
    const numberedLines = outputLines.map((line, i) => `[L${lineStart + i}] ${line}`).join('\n');
    const header = `File: ${input.path} (${totalLines} lines, ${size} bytes)`;
    const truncMsg = truncated ? `\n[Truncated — showing lines ${lineStart}-${lineStart + outputLines.length - 1} of ${totalLines}]` : '';
    formattedText = `${header}${truncMsg}\n\n${numberedLines}`;
  }

  const lines = rawContent.split('\n');
  const result: DocReadFileOutput = {
    content,
    rawContent: isJsonFamily(mime) ? rawContent : undefined,
    parsed: isJsonFamily(mime) ? parsed : undefined,
    parseError: isJsonFamily(mime) ? parseError : undefined,
    mimeType: mime || undefined,
    path: input.path,
    mtime,
    totalLines: lines.length,
    truncated: false,
  };

  return {
    success: true,
    result,
    formattedText,
  };
}

// --- doc_write_file ---

export async function handleWriteFile(
  input: DocWriteFileInput,
  context: DocEditToolContext
): Promise<{ success: boolean; result?: DocWriteFileOutput; error?: string; formattedText?: string }> {
  const scope = (input.scope || 'document_store') as DocEditScope;
  const resolved = await resolveDocEditPath(scope, input.path, await buildWriteResolutionContext(input, context));

  if (!isTextFile(resolved.relativePath)) {
    return { success: false, error: `File is not a supported text format: ${input.path}` };
  }

  const mime = detectMimeFromExtension(resolved.relativePath);
  let contentToWrite: string;

  // Handle JSON/JSONL inputs
  if (isJsonFamily(mime)) {
    if (typeof input.content === 'string') {
      // String input: validate it as JSON
      const validation = validateJson(input.content, mime!);
      if (!validation.ok) {
        const errorMsg = isJsonlMime(mime)
          ? `Invalid JSONL: ${validation.error}`
          : `Invalid JSON: ${validation.error}`;
        logger.info('JSON validation failed on write', { path: input.path, error: validation.error });
        return { success: false, error: errorMsg };
      }
      contentToWrite = input.content;
    } else {
      // Native value input: serialize it
      const serialization = serializeContent(input.content, mime!, { pretty: true });
      if (!serialization.ok) {
        const errorMsg = `Cannot serialize content: ${serialization.error}`;
        logger.info('JSON serialization failed on write', { path: input.path, error: serialization.error });
        return { success: false, error: errorMsg };
      }
      contentToWrite = serialization.value;
    }
  } else {
    // Non-JSON: content must be string
    if (typeof input.content !== 'string') {
      return { success: false, error: `Non-JSON files require string content; got ${typeof input.content}` };
    }
    contentToWrite = input.content;
  }

  const { mtime } = await writeFileWithMtimeCheck(
    resolved,
    contentToWrite,
    input.expected_mtime
  );

  await triggerReindexIfNeeded(resolved);

  const result: DocWriteFileOutput = {
    success: true,
    path: input.path,
    mtime,
  };

  return {
    success: true,
    result,
    formattedText: `File written: ${input.path} (${contentToWrite.length} bytes, mtime: ${mtime})`,
  };
}

// --- doc_str_replace ---

export async function handleStrReplace(
  input: DocStrReplaceInput,
  context: DocEditToolContext
): Promise<{ success: boolean; result?: DocStrReplaceOutput; error?: string; formattedText?: string }> {
  const scope = (input.scope || 'document_store') as DocEditScope;
  const resolved = await resolveDocEditPath(scope, input.path, await buildWriteResolutionContext(input, context));

  if (!isTextFile(resolved.relativePath)) {
    return { success: false, error: `File is not a supported text format: ${input.path}` };
  }

  const { content } = await readFileWithMtime(resolved);

  const matchResult = findUniqueMatch(content, input.find, {
    caseSensitive: input.case_sensitive !== false,
    normalizeDiacritics: input.normalize_diacritics !== false,
  });

  if (!matchResult.found) {
    if (matchResult.count === 0) {
      return {
        success: false,
        error: `Text not found in file. The exact text to find was not present in ${input.path}. Make sure you are using the exact text from your most recent read of this file.`,
        formattedText: `Error: Text not found in ${input.path}. No matches for the find text. Re-read the file and use the exact text.`,
      };
    }
    return {
      success: false,
      error: `Multiple matches (${matchResult.count}) found in file. Include more surrounding context in the find text to make it unique.`,
      formattedText: `Error: ${matchResult.count} matches found in ${input.path}. Include more surrounding context to make the match unique.`,
    };
  }

  // Perform the replacement
  const newContent =
    content.substring(0, matchResult.index) +
    input.replace +
    content.substring(matchResult.index + matchResult.length);

  const { mtime } = await writeFileWithMtimeCheck(resolved, newContent);

  await triggerReindexIfNeeded(resolved);

  const lineNumber = getLineNumber(content, matchResult.index);

  const result: DocStrReplaceOutput = {
    success: true,
    path: input.path,
    mtime,
    line_number: lineNumber,
  };

  return {
    success: true,
    result,
    formattedText: `Replaced text at line ${lineNumber} in ${input.path} (mtime: ${mtime}). Note: your previous read of this file is now stale — re-read before making further edits.`,
  };
}

// --- doc_insert_text ---

export async function handleInsertText(
  input: DocInsertTextInput,
  context: DocEditToolContext
): Promise<{ success: boolean; result?: DocInsertTextOutput; error?: string; formattedText?: string }> {
  const scope = (input.scope || 'document_store') as DocEditScope;
  const resolved = await resolveDocEditPath(scope, input.path, await buildWriteResolutionContext(input, context));

  if (!isTextFile(resolved.relativePath)) {
    return { success: false, error: `File is not a supported text format: ${input.path}` };
  }

  const { content } = await readFileWithMtime(resolved);

  let insertOffset: number;
  let description: string;

  if (input.position.at === 'start') {
    insertOffset = 0;
    description = 'start of file';
  } else if (input.position.at === 'end') {
    insertOffset = content.length;
    description = 'end of file';
  } else {
    // Anchor-based positioning
    const anchor = input.position.before || input.position.after;
    if (!anchor) {
      return { success: false, error: 'Position must specify before, after, or at' };
    }

    const matchResult = findUniqueMatch(content, anchor, {
      caseSensitive: true,
      normalizeDiacritics: input.normalize_diacritics !== false,
    });

    if (!matchResult.found) {
      if (matchResult.count === 0) {
        return {
          success: false,
          error: `Anchor text not found in file. Make sure you are using exact text from your most recent read.`,
        };
      }
      return {
        success: false,
        error: `Multiple matches (${matchResult.count}) for anchor text. Include more context to make it unique.`,
      };
    }

    if (input.position.before) {
      insertOffset = matchResult.index;
      description = `before "${anchor.substring(0, 40)}${anchor.length > 40 ? '...' : ''}"`;
    } else {
      insertOffset = matchResult.index + matchResult.length;
      description = `after "${anchor.substring(0, 40)}${anchor.length > 40 ? '...' : ''}"`;
    }
  }

  const newContent =
    content.substring(0, insertOffset) +
    input.content +
    content.substring(insertOffset);

  const { mtime } = await writeFileWithMtimeCheck(resolved, newContent);

  await triggerReindexIfNeeded(resolved);

  const lineNumber = getLineNumber(newContent, insertOffset);

  const result: DocInsertTextOutput = {
    success: true,
    path: input.path,
    mtime,
    line_number: lineNumber,
  };

  return {
    success: true,
    result,
    formattedText: `Inserted text at ${description} (line ${lineNumber}) in ${input.path} (mtime: ${mtime}). Note: your previous read of this file is now stale.`,
  };
}

// --- doc_grep ---

export async function handleGrep(
  input: DocGrepInput,
  context: DocEditToolContext
): Promise<{ success: boolean; result?: DocGrepOutput; error?: string; formattedText?: string }> {
  if (!context.projectId) {
    return { success: false, error: 'Grep requires a project context' };
  }

  const maxResults = Math.min(input.max_results || 100, 500);
  const contextLines = input.context_lines || 0;
  const matches: DocGrepMatch[] = [];

  // Build search pattern
  let searchPattern: RegExp;
  try {
    if (input.is_regex) {
      searchPattern = new RegExp(input.query, input.case_sensitive ? 'g' : 'gi');
    } else {
      // Escape regex special chars for literal matching
      const escaped = input.query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      searchPattern = new RegExp(escaped, input.case_sensitive ? 'g' : 'gi');
    }
  } catch (err) {
    return { success: false, error: `Invalid regex pattern: ${err instanceof Error ? err.message : String(err)}` };
  }

  // Helper to search a single file
  const searchFile = async (
    absolutePath: string,
    displayPath: string,
    mountPointName?: string
  ): Promise<void> => {
    if (matches.length >= maxResults) return;
    if (!isTextFile(absolutePath)) return;

    try {
      const content = await fs.readFile(absolutePath, 'utf-8');

      // For diacritics normalization, we need custom matching
      if (input.normalize_diacritics !== false && !input.is_regex) {
        const normalizedMatches = findAllMatches(content, input.query, {
          caseSensitive: input.case_sensitive ?? false,
          normalizeDiacritics: true,
        });

        const lines = content.split('\n');
        for (const match of normalizedMatches) {
          if (matches.length >= maxResults) break;
          const lineNum = getLineNumber(content, match.index);
          const lineIdx = lineNum - 1;

          const grepMatch: DocGrepMatch = {
            path: displayPath,
            mount_point: mountPointName,
            line_number: lineNum,
            match: lines[lineIdx] || '',
          };

          if (contextLines > 0) {
            grepMatch.context_before = lines.slice(Math.max(0, lineIdx - contextLines), lineIdx);
            grepMatch.context_after = lines.slice(lineIdx + 1, lineIdx + 1 + contextLines);
          }

          matches.push(grepMatch);
        }
      } else {
        // Regex-based search
        const lines = content.split('\n');
        for (let i = 0; i < lines.length && matches.length < maxResults; i++) {
          if (searchPattern.test(lines[i])) {
            searchPattern.lastIndex = 0; // Reset for global regex

            const grepMatch: DocGrepMatch = {
              path: displayPath,
              mount_point: mountPointName,
              line_number: i + 1,
              match: lines[i],
            };

            if (contextLines > 0) {
              grepMatch.context_before = lines.slice(Math.max(0, i - contextLines), i);
              grepMatch.context_after = lines.slice(i + 1, i + 1 + contextLines);
            }

            matches.push(grepMatch);
          }
          searchPattern.lastIndex = 0; // Reset for next line test
        }
      }
    } catch {
      // Skip files that can't be read
    }
  };

  // Walk a directory and search files
  const walkAndSearch = async (
    baseDir: string,
    displayPrefix: string,
    mountPointName?: string,
    folder?: string
  ): Promise<void> => {
    const startDir = folder ? path.join(baseDir, folder) : baseDir;

    try {
      const walkRecursive = async (dir: string): Promise<void> => {
        if (matches.length >= maxResults) return;

        const entries = await fs.readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (matches.length >= maxResults) return;

          const fullPath = path.join(dir, entry.name);
          const relativePath = path.relative(baseDir, fullPath);

          if (entry.isDirectory()) {
            // Skip hidden directories
            if (entry.name.startsWith('.')) continue;
            await walkRecursive(fullPath);
          } else if (entry.isFile()) {
            if (input.path && !relativePath.startsWith(input.path)) continue;
            const displayPath = displayPrefix ? `${displayPrefix}/${relativePath}` : relativePath;
            await searchFile(fullPath, displayPath, mountPointName);
          }
        }
      };

      await walkRecursive(startDir);
    } catch {
    }
  };

  // Helper to search a blob of in-memory content (used for DB-backed stores
  // where bytes come from doc_mount_documents rather than the filesystem).
  const searchContent = (
    content: string,
    displayPath: string,
    mountPointName?: string
  ): void => {
    if (matches.length >= maxResults) return;
    if (input.normalize_diacritics !== false && !input.is_regex) {
      const normalizedMatches = findAllMatches(content, input.query, {
        caseSensitive: input.case_sensitive ?? false,
        normalizeDiacritics: true,
      });
      const lines = content.split('\n');
      for (const match of normalizedMatches) {
        if (matches.length >= maxResults) break;
        const lineNum = getLineNumber(content, match.index);
        const lineIdx = lineNum - 1;
        const grepMatch: DocGrepMatch = {
          path: displayPath,
          mount_point: mountPointName,
          line_number: lineNum,
          match: lines[lineIdx] || '',
        };
        if (contextLines > 0) {
          grepMatch.context_before = lines.slice(Math.max(0, lineIdx - contextLines), lineIdx);
          grepMatch.context_after = lines.slice(lineIdx + 1, lineIdx + 1 + contextLines);
        }
        matches.push(grepMatch);
      }
    } else {
      const lines = content.split('\n');
      for (let i = 0; i < lines.length && matches.length < maxResults; i++) {
        if (searchPattern.test(lines[i])) {
          searchPattern.lastIndex = 0;
          const grepMatch: DocGrepMatch = {
            path: displayPath,
            mount_point: mountPointName,
            line_number: i + 1,
            match: lines[i],
          };
          if (contextLines > 0) {
            grepMatch.context_before = lines.slice(Math.max(0, i - contextLines), i);
            grepMatch.context_after = lines.slice(i + 1, i + 1 + contextLines);
          }
          matches.push(grepMatch);
        }
        searchPattern.lastIndex = 0;
      }
    }
  };

  // Search document store mount points. Translate the reserved self-token to
  // the acting character's own vault ID so `mount_point: "self"` filters to it,
  // mirroring the path resolver; any other value passes through unchanged.
  {
    const mountPointFilter = input.mount_point
      ? await resolveMountPointRef(input.mount_point, context.characterId)
      : undefined;
    const peerCharacterIds = await collectPeerCharacterIdsForReads(context);
    const mountPoints = await getAccessibleMountPoints(context.projectId, context.characterId, peerCharacterIds);

    for (const mp of mountPoints) {
      if (mountPointFilter && mp.name.toLowerCase() !== mountPointFilter.toLowerCase() && mp.id !== mountPointFilter) {
        continue;
      }
      if (mp.mountType === 'database') {
        const repos = getRepositories();
        const documents = await repos.docMountDocuments.findByMountPointId(mp.id);
        for (const doc of documents) {
          if (matches.length >= maxResults) break;
          if (input.path && !doc.relativePath.startsWith(input.path)) continue;
          searchContent(doc.content, doc.relativePath, mp.name);
        }
        continue;
      }
      await walkAndSearch(mp.basePath, '', mp.name);
    }
  }

  // Search project files
  //
  // The document-store iteration above already covers the project's official
  // mount (it's linked via project_doc_mount_links and surfaces through
  // getAccessibleMountPoints). Falling through to walk the legacy on-disk
  // directory would either duplicate matches or, post-migration, search a
  // stale snapshot. We only walk the legacy fs for projects that haven't
  // been migrated to a database-backed official store yet.
  if (!input.mount_point) {
    const officialMount = await resolveOfficialProjectMount(context.projectId);
    if (!officialMount) {
      const { getFilesDir } = await import('@/lib/paths');
      const projectDir = path.join(getFilesDir(), context.projectId);
      try {
        await fs.access(projectDir);
        await walkAndSearch(projectDir, '[project]');
      } catch {
        // Project dir doesn't exist, skip
      }
    }
  }

  const result: DocGrepOutput = {
    matches,
    total_matches: matches.length,
  };

  // Format for LLM
  if (matches.length === 0) {
    return {
      success: true,
      result,
      formattedText: `No matches found for "${input.query}"`,
    };
  }

  const formatted = matches.map(m => {
    const prefix = m.mount_point ? `[${m.mount_point}] ` : '';
    let text = `${prefix}${m.path}:${m.line_number}: ${m.match}`;
    if (m.context_before?.length) {
      text = m.context_before.map(l => `  ${l}`).join('\n') + '\n' + text;
    }
    if (m.context_after?.length) {
      text = text + '\n' + m.context_after.map(l => `  ${l}`).join('\n');
    }
    return text;
  }).join('\n\n');

  return {
    success: true,
    result,
    formattedText: `Found ${matches.length} matches for "${input.query}":\n\n${formatted}`,
  };
}

// --- doc_list_files ---

export async function handleListFiles(
  input: DocListFilesInput,
  context: DocEditToolContext
): Promise<{ success: boolean; result?: DocListFilesOutput; error?: string; formattedText?: string }> {
  if (!context.projectId) {
    return { success: false, error: 'List files requires a project context' };
  }

  const files: DocFileInfo[] = [];
  const recursive = input.recursive !== false;

  // Helper to check glob pattern match (simple implementation)
  const matchesGlob = (filename: string, pattern: string): boolean => {
    if (!pattern) return true;
    // Simple glob: *.ext matching
    if (pattern.startsWith('*.')) {
      return filename.endsWith(pattern.substring(1));
    }
    // Direct match
    return filename === pattern;
  };

  // Walk directory and collect file info
  const collectFiles = async (
    baseDir: string,
    scope: DocFileInfo['scope'],
    mountPointName?: string,
    folder?: string
  ): Promise<void> => {
    const startDir = folder ? path.join(baseDir, folder) : baseDir;

    try {
      const walkRecursive = async (dir: string): Promise<void> => {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          const relativePath = path.relative(baseDir, fullPath);

          if (entry.isDirectory()) {
            if (entry.name.startsWith('.')) continue; // Skip hidden dirs
            // Add folder entry
            files.push({
              path: relativePath,
              mount_point: mountPointName,
              scope,
              size: 0,
              modified: 0,
              kind: 'folder',
            });
            if (recursive) await walkRecursive(fullPath);
          } else if (entry.isFile()) {
            if (input.pattern && !matchesGlob(entry.name, input.pattern)) continue;

            try {
              const stat = await fs.stat(fullPath);
              files.push({
                path: relativePath,
                mount_point: mountPointName,
                scope,
                size: stat.size,
                modified: stat.mtime.getTime(),
                kind: 'file',
              });
            } catch {
              // Skip files we can't stat
            }
          }
        }
      };

      await walkRecursive(startDir);
    } catch {
      // Directory doesn't exist or can't be read
    }
  };

  const shouldIncludeDocStore = !input.scope || input.scope === 'document_store' || input.scope === 'group';
  const shouldIncludeProject = !input.scope || input.scope === 'project';
  const shouldIncludeGeneral = !input.scope || input.scope === 'general';

  // Resolve group mount IDs once so per-mount tagging is O(1)
  const groupMountIds = new Set(await resolveGroupMountPointIdsForCharacter(context.characterId));

  // List document store files. Translate the reserved self-token to the acting
  // character's own vault ID so `mount_point: "self"` filters to it, mirroring
  // the path resolver; any other value passes through unchanged.
  if (shouldIncludeDocStore) {
    const mountPointFilter = input.mount_point
      ? await resolveMountPointRef(input.mount_point, context.characterId)
      : undefined;
    const peerCharacterIds = await collectPeerCharacterIdsForReads(context);
    const mountPoints = await getAccessibleMountPoints(context.projectId, context.characterId, peerCharacterIds);
    for (const mp of mountPoints) {
      if (mountPointFilter && mp.name.toLowerCase() !== mountPointFilter.toLowerCase() && mp.id !== mountPointFilter) {
        continue;
      }
      // When scope is 'group', skip any mount that is not a group store
      if (input.scope === 'group' && !groupMountIds.has(mp.id)) {
        continue;
      }
      const mpScope = groupMountIds.has(mp.id) ? 'group' : 'document_store';
      if (mp.mountType === 'database') {
        // Bytes live in doc_mount_documents; list from the mirror doc_mount_files rows.
        const dbEntries = await listDatabaseFiles(mp.id, input.folder ? { folder: input.folder } : {});
        for (const entry of dbEntries) {
          if (input.pattern && !matchesGlob(entry.fileName, input.pattern)) continue;
          files.push({
            path: entry.relativePath,
            mount_point: mp.name,
            scope: mpScope,
            size: entry.fileSizeBytes,
            modified: new Date(entry.lastModified).getTime(),
            kind: entry.kind as 'file' | 'folder' | undefined,
          });
        }
        continue;
      }
      await collectFiles(mp.basePath, mpScope, mp.name, input.folder);
    }
  }

  // List project files
  //
  // Once a project has been migrated to a database-backed official store,
  // `scope: 'project'` is an alias for that mount (matches what Prospero
  // advertises and what resolveProjectPath dispatches to). To avoid reading
  // a stale on-disk directory from before the migration — or duplicating
  // entries the document-store branch already emitted — we route through
  // the official mount when one exists.
  if (shouldIncludeProject) {
    const officialMount = await resolveOfficialProjectMount(context.projectId);
    if (officialMount) {
      // When listing every scope (no input.scope filter) the document-store
      // branch above has already enumerated this mount; only emit it again
      // when scope was explicitly 'project' so the caller sees results.
      if (input.scope === 'project') {
        if (officialMount.mountType === 'database') {
          const dbEntries = await listDatabaseFiles(
            officialMount.id,
            input.folder ? { folder: input.folder } : {}
          );
          for (const entry of dbEntries) {
            if (input.pattern && !matchesGlob(entry.fileName, input.pattern)) continue;
            files.push({
              path: entry.relativePath,
              mount_point: officialMount.name,
              scope: 'project',
              size: entry.fileSizeBytes,
              modified: new Date(entry.lastModified).getTime(),
              kind: entry.kind as 'file' | 'folder' | undefined,
            });
          }
        } else if (officialMount.basePath) {
          await collectFiles(officialMount.basePath, 'project', officialMount.name, input.folder);
        }
      }
    } else {
      const { getFilesDir } = await import('@/lib/paths');
      const projectDir = path.join(getFilesDir(), context.projectId);
      await collectFiles(projectDir, 'project', undefined, input.folder);
    }
  }

  // List general files
  if (shouldIncludeGeneral) {
    const { getFilesDir } = await import('@/lib/paths');
    const generalDir = path.join(getFilesDir(), '_general');
    await collectFiles(generalDir, 'general', undefined, input.folder);
  }

  // Post-collection filter: always strip OS cruft; strip auto-images unless opted in.
  const filteredFiles = files.filter(entry => {
    const segments = entry.path.split('/');
    const basename = segments[segments.length - 1] ?? '';
    if (isOsCruftName(basename)) {
      return false;
    }
    if (!input.includeAutomaticImages && isAutomaticImagePath(entry.path)) {
      return false;
    }
    return true;
  });

  const result: DocListFilesOutput = {
    files: filteredFiles,
    total: filteredFiles.length,
  };

  // Format for LLM
  if (filteredFiles.length === 0) {
    return {
      success: true,
      result,
      formattedText: 'No files found.',
    };
  }

  const formatted = filteredFiles.map(f => {
    const prefix = f.mount_point ? `[${f.mount_point}] ` : `[${f.scope}] `;
    if (f.kind === 'folder') {
      return `${prefix}[folder] ${f.path}`;
    }
    const sizeStr = f.size < 1024 ? `${f.size}B` : f.size < 1048576 ? `${(f.size / 1024).toFixed(1)}KB` : `${(f.size / 1048576).toFixed(1)}MB`;
    return `${prefix}${f.path}  (${sizeStr})`;
  }).join('\n');

  return {
    success: true,
    result,
    formattedText: `${filteredFiles.length} files:\n\n${formatted}`,
  };
}
