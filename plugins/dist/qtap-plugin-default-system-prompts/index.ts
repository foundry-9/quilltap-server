/**
 * Default System Prompts Plugin
 *
 * Provides built-in system prompt templates for various LLM models
 * in companion and romantic categories.
 *
 * Prompts are loaded from .md files in the prompts/ directory.
 * Filenames are prompt names (e.g., CLAUDE_COMPANION.md -> "CLAUDE_COMPANION").
 * Accessed as "default-system-prompts/PROMPT_NAME".
 */

import type { SystemPromptPlugin, SystemPromptData } from '@quilltap/plugin-types';
import { createSystemPromptPlugin } from '@quilltap/plugin-utils';
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';

// ============================================================================
// PROMPT LOADING
// ============================================================================

/**
 * Parse a prompt filename to extract model hint and category.
 * Format: MODEL_CATEGORY.md (e.g., CLAUDE_ROMANTIC.md, GPT-4O_COMPANION.md)
 * Last underscore-delimited part is category, rest is model hint.
 */
function parsePromptFilename(filename: string): { modelHint: string; category: string } {
  const baseName = filename.replace(/\.md$/i, '');
  const parts = baseName.split('_');
  if (parts.length < 2) {
    return { modelHint: baseName, category: 'GENERAL' };
  }
  const category = parts.pop()!;
  const modelHint = parts.join('_');
  return { modelHint, category };
}

/**
 * Load all .md files from the prompts/ directory adjacent to this module.
 */
function loadPrompts(): SystemPromptData[] {
  // __dirname works in CJS (esbuild output format)
  const promptsDir = join(dirname(__filename), 'prompts');
  const files = readdirSync(promptsDir).filter(f => f.endsWith('.md')).sort();
  const prompts: SystemPromptData[] = [];

  for (const file of files) {
    const content = readFileSync(join(promptsDir, file), 'utf-8');
    const name = file.replace(/\.md$/i, '');
    const { modelHint, category } = parsePromptFilename(file);
    prompts.push({ name, content, modelHint, category });
  }

  return prompts;
}

// ============================================================================
// PLUGIN EXPORT
// ============================================================================

export const plugin: SystemPromptPlugin = createSystemPromptPlugin({
  metadata: {
    pluginId: 'default-system-prompts',
    displayName: 'Default System Prompts',
    description: 'Built-in system prompt templates for various LLM models in companion and romantic categories',
    version: '1.0.0',
  },
  prompts: loadPrompts(),
});

const pluginExport = { plugin };
export default pluginExport;
