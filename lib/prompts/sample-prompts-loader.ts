/**
 * Sample Prompts Loader
 *
 * @deprecated System prompts are now provided by SYSTEM_PROMPT plugins
 * (e.g., qtap-plugin-default-system-prompts). This loader is kept as a
 * fallback for backward compatibility but will be removed in a future version.
 * See lib/plugins/system-prompt-registry.ts for the new approach.
 *
 * Utility for loading sample prompt files from the prompts/ directory.
 * Parses filenames in MODEL_CATEGORY.md format (e.g., CLAUDE_ROMANTIC.md).
 */

import fs from 'fs/promises';
import path from 'path';
import { logger } from '@/lib/logger';

export interface SamplePromptData {
  name: string;
  content: string;
  modelHint: string;  // e.g., "CLAUDE", "GPT-4O"
  category: string;   // e.g., "COMPANION", "ROMANTIC"
  filename: string;
}

/**
 * Parse a prompt filename to extract model hint and category
 * Format: MODEL_CATEGORY.md (e.g., CLAUDE_ROMANTIC.md, GPT-4O_COMPANION.md)
 */
export function parsePromptFilename(filename: string): { modelHint: string; category: string } {
  // Remove .md extension
  const baseName = filename.replace(/\.md$/i, '');

  // Split by underscore - last part is category, rest is model
  const parts = baseName.split('_');
  if (parts.length < 2) {
    return { modelHint: baseName, category: 'GENERAL' };
  }

  const category = parts.pop()!;
  const modelHint = parts.join('_');
  return { modelHint, category };
}

/**
 * Load all sample prompts from the prompts/ directory
 */
export async function loadSamplePrompts(): Promise<SamplePromptData[]> {
  const promptsDir = path.join(process.cwd(), 'prompts');

  try {
    // Check if directory exists
    try {
      await fs.access(promptsDir);
    } catch {
      logger.warn('Prompts directory does not exist', { promptsDir });
      return [];
    }

    // Read all .md files
    const files = await fs.readdir(promptsDir);
    const mdFiles = files.filter(f => f.endsWith('.md'));
    const prompts: SamplePromptData[] = [];

    for (const filename of mdFiles) {
      try {
        const filePath = path.join(promptsDir, filename);
        const content = await fs.readFile(filePath, 'utf-8');
        const { modelHint, category } = parsePromptFilename(filename);

        // Create a human-readable name
        const name = `${modelHint} ${category.charAt(0) + category.slice(1).toLowerCase()}`;

        prompts.push({
          name,
          content,
          modelHint,
          category,
          filename,
        });
      } catch (error) {
        logger.error('Error loading sample prompt file', {
          filename,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    logger.info('Loaded sample prompts', { count: prompts.length });
    return prompts;
  } catch (error) {
    logger.error('Error loading sample prompts', {
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}
