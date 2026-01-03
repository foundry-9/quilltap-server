/**
 * Roleplay Template Registry
 *
 * Singleton registry for managing loaded roleplay template plugins.
 * Handles loading templates from plugin manifests and provides
 * access to available plugin-provided templates.
 *
 * @module plugins/roleplay-template-registry
 */

import { logger } from '@/lib/logger';
import { getEnabledPluginsByCapability } from '@/lib/plugins';
import type { LoadedPlugin } from '@/lib/plugins/manifest-loader';
import { getErrorMessage } from '@/lib/errors';
import type { AnnotationButton, RenderingPattern, DialogueDetection } from '@/lib/schemas/template.types';

// ============================================================================
// TYPES
// ============================================================================

/**
 * A loaded roleplay template from a plugin
 */
export interface LoadedRoleplayTemplate {
  /** Template identifier (derived from plugin name) */
  id: string;

  /** Template display name */
  name: string;

  /** Template description */
  description?: string;

  /** The system prompt with formatting instructions */
  systemPrompt: string;

  /** Categorization tags */
  tags: string[];

  /** Formatting toolbar annotation buttons */
  annotationButtons?: AnnotationButton[];

  /** Patterns for styling roleplay text in message content */
  renderingPatterns?: RenderingPattern[];

  /** Optional dialogue detection for paragraph-level styling */
  dialogueDetection?: DialogueDetection;

  /** Source plugin name */
  pluginName: string;

  /** Plugin version */
  version: string;

  /** Always true for plugin templates */
  isBuiltIn: true;
}

/**
 * Template loading error
 */
export interface TemplateLoadError {
  templateId: string;
  pluginName: string;
  error: string;
  details?: unknown;
}

/**
 * Template registry state
 */
export interface TemplateRegistryState {
  initialized: boolean;
  templates: Map<string, LoadedRoleplayTemplate>;
  errors: TemplateLoadError[];
  lastInitTime: Date | null;
}

// ============================================================================
// ROLEPLAY TEMPLATE REGISTRY CLASS
// ============================================================================

class RoleplayTemplateRegistry {
  private state: TemplateRegistryState = {
    initialized: false,
    templates: new Map(),
    errors: [],
    lastInitTime: null,
  };

  private logger = logger.child({
    module: 'roleplay-template-registry',
  });

  /**
   * Initialize the template registry by loading templates from enabled ROLEPLAY_TEMPLATE plugins
   */
  async initialize(): Promise<void> {
    const startTime = Date.now();
    this.logger.info('Initializing roleplay template registry');

    // Clear existing state
    this.state.templates.clear();
    this.state.errors = [];

    // Get enabled roleplay template plugins
    const templatePlugins = getEnabledPluginsByCapability('ROLEPLAY_TEMPLATE');

    this.logger.debug('Found roleplay template plugins', {
      count: templatePlugins.length,
      plugins: templatePlugins.map(p => p.manifest.name),
    });

    // Load each template plugin
    for (const plugin of templatePlugins) {
      try {
        this.loadTemplateFromPlugin(plugin);
      } catch (error) {
        const errorMessage = getErrorMessage(error);
        this.logger.error('Failed to load roleplay template from plugin', {
          plugin: plugin.manifest.name,
          error: errorMessage,
        });
        this.state.errors.push({
          templateId: this.extractTemplateId(plugin.manifest.name),
          pluginName: plugin.manifest.name,
          error: errorMessage,
        });
      }
    }

    this.state.initialized = true;
    this.state.lastInitTime = new Date();

    const duration = Date.now() - startTime;
    this.logger.info('Roleplay template registry initialized', {
      duration: `${duration}ms`,
      templateCount: this.state.templates.size,
      errorCount: this.state.errors.length,
      templates: Array.from(this.state.templates.keys()),
    });
  }

  /**
   * Extract template ID from plugin name
   * qtap-plugin-template-quilltap-rp -> quilltap-rp
   */
  private extractTemplateId(pluginName: string): string {
    const prefix = 'qtap-plugin-template-';
    if (pluginName.startsWith(prefix)) {
      return pluginName.slice(prefix.length);
    }
    // Fallback: use full plugin name
    return pluginName.replace('qtap-plugin-', '');
  }

  /**
   * Load a template from a plugin
   */
  private loadTemplateFromPlugin(plugin: LoadedPlugin): void {
    const templateConfig = plugin.manifest.roleplayTemplateConfig;

    if (!templateConfig) {
      throw new Error('Plugin does not have roleplayTemplateConfig');
    }

    const templateId = this.extractTemplateId(plugin.manifest.name);

    this.logger.debug('Loading roleplay template from plugin', {
      templateId,
      plugin: plugin.manifest.name,
      name: templateConfig.name,
    });

    // Validate required fields
    if (!templateConfig.name || !templateConfig.systemPrompt) {
      throw new Error('Template config missing required fields: name, systemPrompt');
    }

    // Create the loaded template
    const loadedTemplate: LoadedRoleplayTemplate = {
      id: templateId,
      name: templateConfig.name,
      description: templateConfig.description,
      systemPrompt: templateConfig.systemPrompt,
      tags: templateConfig.tags || [],
      annotationButtons: templateConfig.annotationButtons || [],
      renderingPatterns: templateConfig.renderingPatterns || [],
      dialogueDetection: templateConfig.dialogueDetection ?? undefined,
      pluginName: plugin.manifest.name,
      version: plugin.manifest.version,
      isBuiltIn: true, // Plugin templates are always treated as built-in
    };

    // Register the template
    this.state.templates.set(templateId, loadedTemplate);

    this.logger.info('Roleplay template loaded successfully', {
      templateId,
      name: loadedTemplate.name,
      pluginName: plugin.manifest.name,
    });
  }

  // ============================================================================
  // PUBLIC API
  // ============================================================================

  /**
   * Get all available plugin templates
   */
  getAll(): LoadedRoleplayTemplate[] {
    return Array.from(this.state.templates.values());
  }

  /**
   * Get a specific template by ID
   */
  get(templateId: string): LoadedRoleplayTemplate | null {
    return this.state.templates.get(templateId) || null;
  }

  /**
   * Check if a template exists
   */
  has(templateId: string): boolean {
    return this.state.templates.has(templateId);
  }

  /**
   * Get all template IDs
   */
  getTemplateIds(): string[] {
    return Array.from(this.state.templates.keys());
  }

  /**
   * Get templates by tag
   */
  getByTag(tag: string): LoadedRoleplayTemplate[] {
    return this.getAll().filter(template =>
      template.tags.some(t => t.toLowerCase() === tag.toLowerCase())
    );
  }

  /**
   * Get all unique tags across all templates
   */
  getAllTags(): string[] {
    const tags = new Set<string>();
    for (const template of this.state.templates.values()) {
      for (const tag of template.tags) {
        tags.add(tag.toLowerCase());
      }
    }
    return Array.from(tags).sort();
  }

  /**
   * Get registry statistics
   */
  getStats() {
    return {
      total: this.state.templates.size,
      errors: this.state.errors.length,
      initialized: this.state.initialized,
      lastInitTime: this.state.lastInitTime?.toISOString() || null,
    };
  }

  /**
   * Get all loading errors
   */
  getErrors(): TemplateLoadError[] {
    return [...this.state.errors];
  }

  /**
   * Check if registry is initialized
   */
  isInitialized(): boolean {
    return this.state.initialized;
  }

  /**
   * Reset the registry (for testing)
   */
  reset(): void {
    this.state.initialized = false;
    this.state.templates.clear();
    this.state.errors = [];
    this.state.lastInitTime = null;
    this.logger.debug('Roleplay template registry reset');
  }

  /**
   * Export registry state (for debugging/admin UI)
   */
  exportState() {
    return {
      initialized: this.state.initialized,
      lastInitTime: this.state.lastInitTime?.toISOString() || null,
      templates: this.getAll().map(template => ({
        id: template.id,
        name: template.name,
        description: template.description,
        tags: template.tags,
        pluginName: template.pluginName,
        version: template.version,
        systemPromptLength: template.systemPrompt.length,
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
 * Global roleplay template registry instance
 */
export const roleplayTemplateRegistry = new RoleplayTemplateRegistry();

// ============================================================================
// CONVENIENCE FUNCTIONS
// ============================================================================

/**
 * Get all available plugin roleplay templates
 */
export function getAllPluginRoleplayTemplates(): LoadedRoleplayTemplate[] {
  return roleplayTemplateRegistry.getAll();
}

/**
 * Get a specific plugin roleplay template
 */
export function getPluginRoleplayTemplate(templateId: string): LoadedRoleplayTemplate | null {
  return roleplayTemplateRegistry.get(templateId);
}

/**
 * Check if a plugin roleplay template exists
 */
export function hasPluginRoleplayTemplate(templateId: string): boolean {
  return roleplayTemplateRegistry.has(templateId);
}

/**
 * Get plugin roleplay template registry statistics
 */
export function getRoleplayTemplateRegistryStats() {
  return roleplayTemplateRegistry.getStats();
}

/**
 * Initialize the roleplay template registry
 * Should be called after plugin system is initialized
 */
export async function initializeRoleplayTemplateRegistry(): Promise<void> {
  await roleplayTemplateRegistry.initialize();
}
