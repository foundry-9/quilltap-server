/**
 * Sample Prompts Loader
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
  logger.debug('Parsing prompt filename', { filename });

  // Remove .md extension
  const baseName = filename.replace(/\.md$/i, '');

  // Split by underscore - last part is category, rest is model
  const parts = baseName.split('_');
  if (parts.length < 2) {
    logger.debug('Filename has no underscore separator, using default category', {
      filename,
      baseName,
    });
    return { modelHint: baseName, category: 'GENERAL' };
  }

  const category = parts.pop()!;
  const modelHint = parts.join('_');

  logger.debug('Parsed prompt filename', {
    filename,
    modelHint,
    category,
  });

  return { modelHint, category };
}

/**
 * Load all sample prompts from the prompts/ directory
 */
export async function loadSamplePrompts(): Promise<SamplePromptData[]> {
  const promptsDir = path.join(process.cwd(), 'prompts');

  try {
    logger.debug('Loading sample prompts from directory', { promptsDir });

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

    logger.debug('Found markdown files in prompts directory', { count: mdFiles.length });

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

        logger.debug('Loaded sample prompt', { filename, modelHint, category });
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
