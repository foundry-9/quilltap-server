/**
 * System Prompt Registry Tests
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import {
  systemPromptRegistry,
  initializeSystemPromptRegistry,
  getAllPluginSystemPrompts,
  getPluginSystemPrompt,
  getSystemPromptRegistryStats,
} from '@/lib/plugins/system-prompt-registry';

// Local type matching the interface expected by initialize()
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

// ============================================================================
// TEST DATA
// ============================================================================

function makePlugin(overrides: Partial<SystemPromptPluginData> & { metadata: SystemPromptPluginData['metadata'] }): SystemPromptPluginData {
  return {
    prompts: [],
    ...overrides,
  };
}

const pluginAlpha: SystemPromptPluginData = makePlugin({
  metadata: {
    pluginId: 'alpha-prompts',
    displayName: 'Alpha Prompts',
    version: '1.2.0',
  },
  prompts: [
    {
      name: 'CLAUDE_COMPANION',
      content: 'You are a helpful companion.',
      modelHint: 'CLAUDE',
      category: 'COMPANION',
    },
    {
      name: 'GPT_ROMANTIC',
      content: 'You are a romantic partner.',
      modelHint: 'GPT-4O',
      category: 'ROMANTIC',
    },
  ],
});

const pluginBeta: SystemPromptPluginData = makePlugin({
  metadata: {
    pluginId: 'beta-prompts',
    displayName: 'Beta Prompts',
    version: '0.5.0',
  },
  prompts: [
    {
      name: 'GROK_NARRATOR',
      content: 'You are a narrator for an epic tale.',
      modelHint: 'GROK',
      category: 'NARRATOR',
    },
  ],
});

// ============================================================================
// TESTS
// ============================================================================

describe('System Prompt Registry', () => {
  beforeEach(() => {
    systemPromptRegistry.reset();
  });

  // --------------------------------------------------------------------------
  // Initialization
  // --------------------------------------------------------------------------

  describe('initialization', () => {
    it('should initialize with valid plugin data containing system prompts', async () => {
      await initializeSystemPromptRegistry([pluginAlpha]);

      expect(systemPromptRegistry.isInitialized()).toBe(true);
      expect(systemPromptRegistry.getAll()).toHaveLength(2);
    });

    it('should initialize with an empty plugins array', async () => {
      await initializeSystemPromptRegistry([]);

      expect(systemPromptRegistry.isInitialized()).toBe(true);
      expect(systemPromptRegistry.getAll()).toHaveLength(0);
    });

    it('should call plugin initialize() if provided', async () => {
      let called = false;
      const pluginWithInit: SystemPromptPluginData = {
        ...pluginBeta,
        initialize: async () => { called = true; },
      };

      await initializeSystemPromptRegistry([pluginWithInit]);
      expect(called).toBe(true);
    });

    it('should re-initialize and replace previous state', async () => {
      await initializeSystemPromptRegistry([pluginAlpha]);
      expect(systemPromptRegistry.getAll()).toHaveLength(2);

      // Re-initialize with a different plugin set
      await initializeSystemPromptRegistry([pluginBeta]);
      expect(systemPromptRegistry.getAll()).toHaveLength(1);

      // Old prompts should be gone
      expect(systemPromptRegistry.get('alpha-prompts/CLAUDE_COMPANION')).toBeNull();
      // New prompt should be present
      expect(systemPromptRegistry.get('beta-prompts/GROK_NARRATOR')).not.toBeNull();
    });
  });

  // --------------------------------------------------------------------------
  // Getting all prompts
  // --------------------------------------------------------------------------

  describe('getAll / getAllPluginSystemPrompts', () => {
    it('should return all loaded prompts after initialization', async () => {
      await initializeSystemPromptRegistry([pluginAlpha, pluginBeta]);

      const all = getAllPluginSystemPrompts();
      expect(all).toHaveLength(3);

      const ids = all.map(p => p.id);
      expect(ids).toContain('alpha-prompts/CLAUDE_COMPANION');
      expect(ids).toContain('alpha-prompts/GPT_ROMANTIC');
      expect(ids).toContain('beta-prompts/GROK_NARRATOR');
    });

    it('should return an empty array before initialization', () => {
      expect(getAllPluginSystemPrompts()).toHaveLength(0);
    });
  });

  // --------------------------------------------------------------------------
  // Getting a specific prompt
  // --------------------------------------------------------------------------

  describe('get / getPluginSystemPrompt', () => {
    beforeEach(async () => {
      await initializeSystemPromptRegistry([pluginAlpha, pluginBeta]);
    });

    it('should return a prompt by its composite ID', () => {
      const prompt = getPluginSystemPrompt('alpha-prompts/CLAUDE_COMPANION');
      expect(prompt).not.toBeNull();
      expect(prompt!.id).toBe('alpha-prompts/CLAUDE_COMPANION');
      expect(prompt!.content).toBe('You are a helpful companion.');
      expect(prompt!.modelHint).toBe('CLAUDE');
      expect(prompt!.category).toBe('COMPANION');
      expect(prompt!.pluginName).toBe('alpha-prompts');
      expect(prompt!.version).toBe('1.2.0');
      expect(prompt!.isBuiltIn).toBe(true);
    });

    it('should return null for a non-existent prompt', () => {
      expect(getPluginSystemPrompt('nonexistent/MISSING')).toBeNull();
    });

    it('should return null for an existing plugin but wrong prompt name', () => {
      expect(getPluginSystemPrompt('alpha-prompts/NONEXISTENT')).toBeNull();
    });
  });

  // --------------------------------------------------------------------------
  // Registry stats
  // --------------------------------------------------------------------------

  describe('getStats / getSystemPromptRegistryStats', () => {
    it('should reflect loaded prompts correctly', async () => {
      await initializeSystemPromptRegistry([pluginAlpha, pluginBeta]);

      const stats = getSystemPromptRegistryStats();
      expect(stats.total).toBe(3);
      expect(stats.errors).toBe(0);
      expect(stats.initialized).toBe(true);
      expect(stats.lastInitTime).not.toBeNull();
    });

    it('should report uninitialized state before initialize', () => {
      const stats = getSystemPromptRegistryStats();
      expect(stats.total).toBe(0);
      expect(stats.initialized).toBe(false);
      expect(stats.lastInitTime).toBeNull();
    });
  });

  // --------------------------------------------------------------------------
  // Error handling for malformed plugin data
  // --------------------------------------------------------------------------

  describe('error handling', () => {
    it('should record an error when a plugin has no prompts', async () => {
      const emptyPlugin: SystemPromptPluginData = makePlugin({
        metadata: { pluginId: 'empty-plugin', displayName: 'Empty' },
        prompts: [],
      });

      await initializeSystemPromptRegistry([emptyPlugin]);

      const errors = systemPromptRegistry.getErrors();
      expect(errors).toHaveLength(1);
      expect(errors[0].pluginName).toBe('empty-plugin');
      expect(errors[0].error).toContain('does not provide any prompts');
    });

    it('should skip prompts missing required fields and record errors', async () => {
      const malformedPlugin: SystemPromptPluginData = makePlugin({
        metadata: { pluginId: 'malformed', displayName: 'Malformed', version: '1.0.0' },
        prompts: [
          { name: '', content: 'some content', modelHint: 'CLAUDE', category: 'TEST' },
          { name: 'VALID_PROMPT', content: 'Valid content here', modelHint: 'CLAUDE', category: 'COMPANION' },
        ],
      });

      await initializeSystemPromptRegistry([malformedPlugin]);

      // The prompt with empty name should be recorded as an error
      const errors = systemPromptRegistry.getErrors();
      expect(errors).toHaveLength(1);
      expect(errors[0].error).toContain('missing required fields');

      // The valid prompt should still be loaded
      expect(systemPromptRegistry.get('malformed/VALID_PROMPT')).not.toBeNull();
    });

    it('should record an error when plugin initialize() throws', async () => {
      const throwingPlugin: SystemPromptPluginData = {
        metadata: { pluginId: 'throwing-plugin', displayName: 'Thrower', version: '1.0.0' },
        prompts: [{ name: 'A', content: 'content', modelHint: 'X', category: 'Y' }],
        initialize: () => { throw new Error('Init kaboom'); },
      };

      await initializeSystemPromptRegistry([throwingPlugin]);

      const errors = systemPromptRegistry.getErrors();
      expect(errors).toHaveLength(1);
      expect(errors[0].error).toContain('Init kaboom');
      // Prompts from this plugin should not be loaded
      expect(systemPromptRegistry.get('throwing-plugin/A')).toBeNull();
    });

    it('should record an error for duplicate prompt names within a plugin', async () => {
      const dupPlugin: SystemPromptPluginData = makePlugin({
        metadata: { pluginId: 'dup-plugin', displayName: 'Dup', version: '1.0.0' },
        prompts: [
          { name: 'SAME_NAME', content: 'first', modelHint: 'CLAUDE', category: 'A' },
          { name: 'SAME_NAME', content: 'second', modelHint: 'GPT', category: 'B' },
        ],
      });

      await initializeSystemPromptRegistry([dupPlugin]);

      const errors = systemPromptRegistry.getErrors();
      expect(errors).toHaveLength(1);
      expect(errors[0].error).toContain('Duplicate prompt name');
    });
  });

  // --------------------------------------------------------------------------
  // Multiple plugins with multiple prompts
  // --------------------------------------------------------------------------

  describe('multiple plugins with multiple prompts', () => {
    it('should load all prompts from all plugins', async () => {
      const plugin1: SystemPromptPluginData = makePlugin({
        metadata: { pluginId: 'multi-1', displayName: 'Multi 1', version: '1.0.0' },
        prompts: [
          { name: 'A', content: 'content-a', modelHint: 'CLAUDE', category: 'COMPANION' },
          { name: 'B', content: 'content-b', modelHint: 'GPT-4O', category: 'ROMANTIC' },
        ],
      });

      const plugin2: SystemPromptPluginData = makePlugin({
        metadata: { pluginId: 'multi-2', displayName: 'Multi 2', version: '2.0.0' },
        prompts: [
          { name: 'C', content: 'content-c', modelHint: 'GROK', category: 'NARRATOR' },
          { name: 'D', content: 'content-d', modelHint: 'CLAUDE', category: 'COMPANION' },
          { name: 'E', content: 'content-e', modelHint: 'GPT-4O', category: 'COMPANION' },
        ],
      });

      await initializeSystemPromptRegistry([plugin1, plugin2]);

      expect(systemPromptRegistry.getAll()).toHaveLength(5);
      expect(systemPromptRegistry.get('multi-1/A')).not.toBeNull();
      expect(systemPromptRegistry.get('multi-1/B')).not.toBeNull();
      expect(systemPromptRegistry.get('multi-2/C')).not.toBeNull();
      expect(systemPromptRegistry.get('multi-2/D')).not.toBeNull();
      expect(systemPromptRegistry.get('multi-2/E')).not.toBeNull();
    });

    it('should correctly attribute version from each plugin', async () => {
      await initializeSystemPromptRegistry([pluginAlpha, pluginBeta]);

      const alphaPrompt = systemPromptRegistry.get('alpha-prompts/CLAUDE_COMPANION');
      expect(alphaPrompt!.version).toBe('1.2.0');

      const betaPrompt = systemPromptRegistry.get('beta-prompts/GROK_NARRATOR');
      expect(betaPrompt!.version).toBe('0.5.0');
    });

    it('should default version to 0.0.0 when not specified', async () => {
      const noVersionPlugin: SystemPromptPluginData = makePlugin({
        metadata: { pluginId: 'no-ver', displayName: 'No Version' },
        prompts: [
          { name: 'PROMPT', content: 'content', modelHint: 'CLAUDE', category: 'TEST' },
        ],
      });

      await initializeSystemPromptRegistry([noVersionPlugin]);

      const prompt = systemPromptRegistry.get('no-ver/PROMPT');
      expect(prompt!.version).toBe('0.0.0');
    });
  });

  // --------------------------------------------------------------------------
  // Additional registry methods
  // --------------------------------------------------------------------------

  describe('has', () => {
    beforeEach(async () => {
      await initializeSystemPromptRegistry([pluginAlpha]);
    });

    it('should return true for existing prompt', () => {
      expect(systemPromptRegistry.has('alpha-prompts/CLAUDE_COMPANION')).toBe(true);
    });

    it('should return false for non-existent prompt', () => {
      expect(systemPromptRegistry.has('alpha-prompts/NOPE')).toBe(false);
    });
  });

  describe('getPromptIds', () => {
    it('should return all prompt IDs', async () => {
      await initializeSystemPromptRegistry([pluginAlpha]);

      const ids = systemPromptRegistry.getPromptIds();
      expect(ids).toHaveLength(2);
      expect(ids).toContain('alpha-prompts/CLAUDE_COMPANION');
      expect(ids).toContain('alpha-prompts/GPT_ROMANTIC');
    });
  });

  describe('getByCategory', () => {
    beforeEach(async () => {
      await initializeSystemPromptRegistry([pluginAlpha, pluginBeta]);
    });

    it('should return prompts matching the category (case-insensitive)', () => {
      const companions = systemPromptRegistry.getByCategory('companion');
      expect(companions).toHaveLength(1);
      expect(companions[0].id).toBe('alpha-prompts/CLAUDE_COMPANION');
    });

    it('should return empty array for unknown category', () => {
      expect(systemPromptRegistry.getByCategory('NONEXISTENT')).toHaveLength(0);
    });
  });

  describe('getByModelHint', () => {
    beforeEach(async () => {
      await initializeSystemPromptRegistry([pluginAlpha, pluginBeta]);
    });

    it('should return prompts matching the model hint (case-insensitive)', () => {
      const claudePrompts = systemPromptRegistry.getByModelHint('claude');
      expect(claudePrompts).toHaveLength(1);
      expect(claudePrompts[0].id).toBe('alpha-prompts/CLAUDE_COMPANION');
    });

    it('should return empty array for unknown model hint', () => {
      expect(systemPromptRegistry.getByModelHint('LLAMA')).toHaveLength(0);
    });
  });

  describe('getAllCategories', () => {
    it('should return sorted unique categories', async () => {
      await initializeSystemPromptRegistry([pluginAlpha, pluginBeta]);

      const categories = systemPromptRegistry.getAllCategories();
      expect(categories).toEqual(['COMPANION', 'NARRATOR', 'ROMANTIC']);
    });
  });

  describe('getAllModelHints', () => {
    it('should return sorted unique model hints', async () => {
      await initializeSystemPromptRegistry([pluginAlpha, pluginBeta]);

      const hints = systemPromptRegistry.getAllModelHints();
      expect(hints).toEqual(['CLAUDE', 'GPT-4O', 'GROK']);
    });
  });

  describe('exportState', () => {
    it('should export complete state for debugging', async () => {
      await initializeSystemPromptRegistry([pluginAlpha]);

      const state = systemPromptRegistry.exportState();
      expect(state.initialized).toBe(true);
      expect(state.lastInitTime).not.toBeNull();
      expect(state.prompts).toHaveLength(2);
      expect(state.prompts[0]).toHaveProperty('id');
      expect(state.prompts[0]).toHaveProperty('contentLength');
      expect(state.prompts[0]).not.toHaveProperty('content'); // content is replaced by contentLength
      expect(state.stats.total).toBe(2);
      expect(state.errors).toEqual([]);
    });
  });

  describe('reset', () => {
    it('should clear all state', async () => {
      await initializeSystemPromptRegistry([pluginAlpha, pluginBeta]);
      expect(systemPromptRegistry.getAll()).toHaveLength(3);

      systemPromptRegistry.reset();

      expect(systemPromptRegistry.isInitialized()).toBe(false);
      expect(systemPromptRegistry.getAll()).toHaveLength(0);
      expect(systemPromptRegistry.getErrors()).toHaveLength(0);
    });
  });
});
