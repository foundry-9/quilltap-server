/**
 * Markdown-specific doc-edit tool handlers: frontmatter and heading operations.
 *
 * Handles doc_read_frontmatter, doc_update_frontmatter, doc_read_heading, and
 * doc_update_heading.
 *
 * @module tools/handlers/doc-edit/markdown-handlers
 */

import {
  resolveDocEditPath,
  readFileWithMtime,
  writeFileWithMtimeCheck,
  isTextFile,
  parseFrontmatter,
  updateFrontmatterInContent,
  findHeadingSection,
  readHeadingContent,
  replaceHeadingContent,
  type DocEditScope,
} from '@/lib/doc-edit';

import type { DocReadFrontmatterInput, DocReadFrontmatterOutput } from '../../doc-read-frontmatter-tool';
import type { DocUpdateFrontmatterInput, DocUpdateFrontmatterOutput } from '../../doc-update-frontmatter-tool';
import type { DocReadHeadingInput, DocReadHeadingOutput } from '../../doc-read-heading-tool';
import type { DocUpdateHeadingInput, DocUpdateHeadingOutput } from '../../doc-update-heading-tool';

import {
  type DocEditToolContext,
  buildReadResolutionContext,
  buildWriteResolutionContext,
  triggerReindexIfNeeded,
} from './shared';

// --- doc_read_frontmatter ---

export async function handleReadFrontmatter(
  input: DocReadFrontmatterInput,
  context: DocEditToolContext
): Promise<{ success: boolean; result?: DocReadFrontmatterOutput; error?: string; formattedText?: string }> {
  const scope = (input.scope || 'document_store') as DocEditScope;
  const resolved = await resolveDocEditPath(scope, input.path, await buildReadResolutionContext(input, context));

  if (!isTextFile(resolved.relativePath)) {
    return { success: false, error: `File is not a supported text format: ${input.path}` };
  }

  const { content } = await readFileWithMtime(resolved);
  const parsed = parseFrontmatter(content);

  if (parsed.data === null) {
    return {
      success: true,
      result: { frontmatter: null, path: input.path },
      formattedText: `No frontmatter found in ${input.path}`,
    };
  }

  // Filter to specific keys if requested
  let frontmatter = parsed.data;
  if (input.keys && input.keys.length > 0) {
    const filtered: Record<string, unknown> = {};
    for (const key of input.keys) {
      if (key in frontmatter) {
        filtered[key] = frontmatter[key];
      }
    }
    frontmatter = filtered;
  }

  const result: DocReadFrontmatterOutput = {
    frontmatter,
    path: input.path,
  };

  return {
    success: true,
    result,
    formattedText: `Frontmatter from ${input.path}:\n\n${JSON.stringify(frontmatter, null, 2)}`,
  };
}

// --- doc_update_frontmatter ---

export async function handleUpdateFrontmatter(
  input: DocUpdateFrontmatterInput,
  context: DocEditToolContext
): Promise<{ success: boolean; result?: DocUpdateFrontmatterOutput; error?: string; formattedText?: string }> {
  const scope = (input.scope || 'document_store') as DocEditScope;
  const resolved = await resolveDocEditPath(scope, input.path, await buildWriteResolutionContext(input, context));

  if (!isTextFile(resolved.relativePath)) {
    return { success: false, error: `File is not a supported text format: ${input.path}` };
  }

  const { content } = await readFileWithMtime(resolved);

  const newContent = updateFrontmatterInContent(
    content,
    input.updates,
    input.replace_all ?? false
  );

  const { mtime } = await writeFileWithMtimeCheck(resolved, newContent);

  await triggerReindexIfNeeded(resolved);

  const result: DocUpdateFrontmatterOutput = {
    success: true,
    path: input.path,
    mtime,
  };

  const action = input.replace_all ? 'Replaced' : 'Updated';
  const keyCount = Object.keys(input.updates).length;

  return {
    success: true,
    result,
    formattedText: `${action} frontmatter in ${input.path} (${keyCount} keys, mtime: ${mtime})`,
  };
}

// --- doc_read_heading ---

export async function handleReadHeading(
  input: DocReadHeadingInput,
  context: DocEditToolContext
): Promise<{ success: boolean; result?: DocReadHeadingOutput; error?: string; formattedText?: string }> {
  const scope = (input.scope || 'document_store') as DocEditScope;
  const resolved = await resolveDocEditPath(scope, input.path, await buildReadResolutionContext(input, context));

  if (!isTextFile(resolved.relativePath)) {
    return { success: false, error: `File is not a supported text format: ${input.path}` };
  }

  const { content } = await readFileWithMtime(resolved);

  try {
    const heading = findHeadingSection(content, input.heading, input.level);
    const sectionContent = readHeadingContent(content, heading);

    const result: DocReadHeadingOutput = {
      content: sectionContent,
      heading: heading.text,
      level: heading.level,
      path: input.path,
    };

    return {
      success: true,
      result,
      formattedText: `Content under "${'#'.repeat(heading.level)} ${heading.text}" in ${input.path}:\n\n${sectionContent}`,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

// --- doc_update_heading ---

export async function handleUpdateHeading(
  input: DocUpdateHeadingInput,
  context: DocEditToolContext
): Promise<{ success: boolean; result?: DocUpdateHeadingOutput; error?: string; formattedText?: string }> {
  const scope = (input.scope || 'document_store') as DocEditScope;
  const resolved = await resolveDocEditPath(scope, input.path, await buildWriteResolutionContext(input, context));

  if (!isTextFile(resolved.relativePath)) {
    return { success: false, error: `File is not a supported text format: ${input.path}` };
  }

  const { content } = await readFileWithMtime(resolved);

  try {
    const heading = findHeadingSection(content, input.heading, input.level);
    const newContent = replaceHeadingContent(
      content,
      heading,
      input.content,
      input.preserve_subheadings !== false
    );

    const { mtime } = await writeFileWithMtimeCheck(resolved, newContent);

    await triggerReindexIfNeeded(resolved);

    const result: DocUpdateHeadingOutput = {
      success: true,
      path: input.path,
      mtime,
    };

    return {
      success: true,
      result,
      formattedText: `Updated content under "${'#'.repeat(heading.level)} ${heading.text}" in ${input.path} (mtime: ${mtime}). Note: your previous read of this file is now stale.`,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
