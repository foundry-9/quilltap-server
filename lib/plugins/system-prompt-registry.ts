/**
 * System Prompt Registry
 *
 * Singleton registry for managing loaded system prompt plugins.
 * Handles loading prompts from plugin modules and provides
 * access to available plugin-provided system prompts.
 *
 * System prompts are identified by "pluginShortName/promptName",
 * e.g., "default-system-prompts/CLAUDE_COMPANION".
 *
 * @module plugins/system-prompt-registry
 */

import { logger } from '@/lib/logger';
import { getErrorMessage } from '@/lib/error-utils';
import { AbstractRegistry } from '@/lib/plugins/base-registry';

// ============================================================================
// TYPES
// ============================================================================

/**
 * Interface matching the SystemPromptPlugin from @quilltap/plugin-types.
 * Defined locally to avoid import issues with the external package in the core app.
 */
interface SystemPromptPluginData {
  metadata: {
    pluginId: string;
    displayName: string;
    description?: string;
    version?: string;
  };
  prompts: Array<{
    name: string;
    content: string;
    modelHint: string;
    category: string;
  }>;
  initialize?: () => void | Promise<void>;
}

/**
 * A loaded system prompt from a plugin
 */
export interface LoadedSystemPrompt {
  /** Prompt identifier: "pluginShortName/promptName" */
  id: string;

  /** Human-readable display name (e.g., "Claude Companion") */
  name: string;

  /** The full prompt content (markdown) */
  content: string;

  /** Model hint (e.g., "CLAUDE", "GPT-4O") */
  modelHint: string;

  /** Category (e.g., "COMPANION", "ROMANTIC") */
  category: string;

  /** Source plugin name */
  pluginName: string;

  /** Plugin version */
  version: string;

  /** Always true for plugin prompts */
  isBuiltIn: true;
}

/**
 * Prompt loading error
 */
export interface SystemPromptLoadError {
  promptId: string;
  pluginName: string;
  error: string;
  details?: unknown;
}

/**
 * System prompt registry state
 */
export interface SystemPromptRegistryState {
  initialized: boolean;
  prompts: Map<string, LoadedSystemPrompt>;
  errors: SystemPromptLoadError[];
  lastInitTime: Date | null;
}

// ============================================================================
// GLOBAL STATE PERSISTENCE
// ============================================================================

declare global {
  var __quilltapSystemPromptRegistryState: SystemPromptRegistryState | undefined;
}

// ============================================================================
// SYSTEM PROMPT REGISTRY CLASS
// ============================================================================

class SystemPromptRegistry extends AbstractRegistry<SystemPromptRegistryState> {
  protected readonly registryName = 'system-prompt-registry';
  protected readonly globalStateKey = '__quilltapSystemPromptRegistryState';

  protected createEmptyState(): SystemPromptRegistryState {
    return {
      initialized: false,
      prompts: new Map(),
      errors: [],
      lastInitTime: null,
    };
  }

  /**
   * Initialize the system prompt registry with loaded plugin modules
   */
  async initialize(plugins: SystemPromptPluginData[]): Promise<void> {
    // Clear existing state
    this.state.prompts.clear();
    this.state.errors = [];

    for (const plugin of plugins) {
      try {
        // Call plugin initializer if provided
        if (plugin.initialize) {
          await plugin.initialize();
        }

        this.loadPromptsFromPlugin(plugin);
      } catch (error) {
        const errorMessage = getErrorMessage(error);
        this.registryLogger.error('Failed to load system prompts from plugin', {
          plugin: plugin.metadata.pluginId,
          error: errorMessage,
        });
        this.state.errors.push({
          promptId: plugin.metadata.pluginId,
          pluginName: plugin.metadata.pluginId,
          error: errorMessage,
        });
      }
    }

    this.state.initialized = true;
    this.state.lastInitTime = new Date();

    this.registryLogger.info('System prompt registry initialized', {
      totalPrompts: this.state.prompts.size,
      plugins: plugins.length,
      errors: this.state.errors.length,
    });
  }

  /**
   * Load prompts from a single plugin
   */
  private loadPromptsFromPlugin(plugin: SystemPromptPluginData): void {
    const pluginId = plugin.metadata.pluginId;
    const version = plugin.metadata.version || '0.0.0';

    if (!plugin.prompts || plugin.prompts.length === 0) {
      throw new Error('Plugin does not provide any prompts');
    }

    // Check for duplicate names within the plugin
    const names = new Set<string>();
    for (const prompt of plugin.prompts) {
      if (names.has(prompt.name)) {
        throw new Error(`Duplicate prompt name within plugin: "${prompt.name}"`);
      }
      names.add(prompt.name);
    }

    for (const prompt of plugin.prompts) {
      const promptId = `${pluginId}/${prompt.name}`;

      if (!prompt.name || !prompt.content) {
        this.state.errors.push({
          promptId,
          pluginName: pluginId,
          error: 'Prompt missing required fields: name, content',
        });
        continue;
      }

      // Generate a human-readable name from the prompt data
      const displayName = `${prompt.modelHint} ${prompt.category.charAt(0) + prompt.category.slice(1).toLowerCase()}`;

      const loadedPrompt: LoadedSystemPrompt = {
        id: promptId,
        name: displayName,
        content: prompt.content,
        modelHint: prompt.modelHint,
        category: prompt.category,
        pluginName: pluginId,
        version,
        isBuiltIn: true,
      };

      this.state.prompts.set(promptId, loadedPrompt);

      this.registryLogger.debug('Loaded system prompt', {
        promptId,
        modelHint: prompt.modelHint,
        category: prompt.category,
      });
    }
  }

  // ============================================================================
  // PUBLIC API
  // ============================================================================

  /**
   * Get all available plugin system prompts
   */
  getAll(): LoadedSystemPrompt[] {
    return Array.from(this.state.prompts.values());
  }

  /**
   * Get a specific prompt by ID (pluginShortName/promptName)
   */
  get(promptId: string): LoadedSystemPrompt | null {
    return this.state.prompts.get(promptId) || null;
  }

  /**
   * Check if a prompt exists
   */
  has(promptId: string): boolean {
    return this.state.prompts.has(promptId);
  }

  /**
   * Get all prompt IDs
   */
  getPromptIds(): string[] {
    return Array.from(this.state.prompts.keys());
  }

  /**
   * Get prompts by category
   */
  getByCategory(category: string): LoadedSystemPrompt[] {
    return this.getAll().filter(p =>
      p.category.toLowerCase() === category.toLowerCase()
    );
  }

  /**
   * Get prompts by model hint
   */
  getByModelHint(modelHint: string): LoadedSystemPrompt[] {
    return this.getAll().filter(p =>
      p.modelHint.toLowerCase() === modelHint.toLowerCase()
    );
  }

  /**
   * Get all unique categories
   */
  getAllCategories(): string[] {
    const categories = new Set<string>();
    for (const prompt of this.state.prompts.values()) {
      categories.add(prompt.category);
    }
    return Array.from(categories).sort();
  }

  /**
   * Get all unique model hints
   */
  getAllModelHints(): string[] {
    const hints = new Set<string>();
    for (const prompt of this.state.prompts.values()) {
      hints.add(prompt.modelHint);
    }
    return Array.from(hints).sort();
  }

  /**
   * Get registry statistics
   */
  getStats() {
    return {
      total: this.state.prompts.size,
      errors: this.state.errors.length,
      initialized: this.state.initialized,
      lastInitTime: this.state.lastInitTime?.toISOString() || null,
    };
  }

  /**
   * Get all loading errors
   */
  getErrors(): SystemPromptLoadError[] {
    return [...this.state.errors];
  }

  /**
   * Export registry state (for debugging/admin UI)
   */
  exportState() {
    return {
      initialized: this.state.initialized,
      lastInitTime: this.state.lastInitTime?.toISOString() || null,
      prompts: this.getAll().map(prompt => ({
        id: prompt.id,
        name: prompt.name,
        modelHint: prompt.modelHint,
        category: prompt.category,
        pluginName: prompt.pluginName,
        version: prompt.version,
        contentLength: prompt.content.length,
      })),
      errors: this.state.errors,
      stats: this.getStats(),
    };
  }
}

// ============================================================================
// SINGLETON INSTANCE
// ============================================================================

/**
 * Global system prompt registry instance
 */
export const systemPromptRegistry = new SystemPromptRegistry();

// ============================================================================
// CONVENIENCE FUNCTIONS
// ============================================================================

/**
 * Get all available plugin system prompts
 */
export function getAllPluginSystemPrompts(): LoadedSystemPrompt[] {
  return systemPromptRegistry.getAll();
}

/**
 * Get a specific plugin system prompt
 */
export function getPluginSystemPrompt(promptId: string): LoadedSystemPrompt | null {
  return systemPromptRegistry.get(promptId);
}

/**
 * Get system prompt registry statistics
 */
export function getSystemPromptRegistryStats() {
  return systemPromptRegistry.getStats();
}

/**
 * Initialize the system prompt registry with loaded plugin modules.
 * Should be called after plugin system has loaded SYSTEM_PROMPT modules.
 */
export async function initializeSystemPromptRegistry(plugins: SystemPromptPluginData[]): Promise<void> {
  await systemPromptRegistry.initialize(plugins);
}
