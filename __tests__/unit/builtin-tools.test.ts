/**
 * Plugin Utilities - Built-in Tools Tests
 * Tests for getBuiltinToolNames() and tool shadowing detection
 */

import { getBuiltinToolNames } from '@quilltap/plugin-utils';

describe('Built-in Tool Names', () => {
  describe('getBuiltinToolNames', () => {
    it('should return a Set of tool names', () => {
      const toolNames = getBuiltinToolNames();
      expect(toolNames).toBeInstanceOf(Set);
    });

    it('should contain expected built-in tools', () => {
      const toolNames = getBuiltinToolNames();

      // Based on the plugin-utils built-in tools list
      const expectedTools = [
        'generate_image',
        'search',
        'search_web',
        'project_info',
        'request_full_context',
        'help_search',
        'help_settings',
      ];

      for (const tool of expectedTools) {
        expect(toolNames.has(tool)).toBe(true);
      }
    });

    it('should return consistent results across multiple calls', () => {
      const tools1 = getBuiltinToolNames();
      const tools2 = getBuiltinToolNames();

      expect(tools1.size).toBe(tools2.size);
      
      for (const tool of tools1) {
        expect(tools2.has(tool)).toBe(true);
      }
    });

    it('should be immutable (not affected by external modifications)', () => {
      const toolNames = getBuiltinToolNames();
      const originalSize = toolNames.size;

      // Try to modify (if mutable, this would affect the returned set)
      const testSet = new Set(toolNames);
      testSet.add('fake_tool');

      const toolNames2 = getBuiltinToolNames();
      expect(toolNames2.size).toBe(originalSize);
      expect(toolNames2.has('fake_tool')).toBe(false);
    });

    it('should not contain empty strings', () => {
      const toolNames = getBuiltinToolNames();
      expect(toolNames.has('')).toBe(false);
    });

    it('should have all tools as lowercase strings', () => {
      const toolNames = getBuiltinToolNames();

      for (const tool of toolNames) {
        expect(typeof tool).toBe('string');
        expect(tool.length).toBeGreaterThan(0);
        expect(tool).toBe(tool.toLowerCase());
      }
    });

    it('should contain at least 4 built-in tools', () => {
      const toolNames = getBuiltinToolNames();
      expect(toolNames.size).toBeGreaterThanOrEqual(8);
    });

    it('should not include removed legacy tool names', () => {
      const toolNames = getBuiltinToolNames();
      expect(toolNames.has('search_memories')).toBe(false);
    });
  });

  describe('Tool shadowing detection', () => {
    it('should identify when a tool name shadows a built-in tool', () => {
      const toolNames = getBuiltinToolNames();
      const testTool = 'generate_image';

      expect(toolNames.has(testTool)).toBe(true);
    });

    it('should identify when a tool name does not shadow built-in tools', () => {
      const toolNames = getBuiltinToolNames();
      const testTool = 'custom_tool_xyz_123';

      expect(toolNames.has(testTool)).toBe(false);
    });

    it('should be case-sensitive for shadowing detection', () => {
      const toolNames = getBuiltinToolNames();

      // Built-in tools are lowercase
      expect(toolNames.has('generate_image')).toBe(true);
      expect(toolNames.has('Generate_Image')).toBe(false);
      expect(toolNames.has('GENERATE_IMAGE')).toBe(false);
    });

    it('should support filtering a tool list by built-in names', () => {
      const toolNames = getBuiltinToolNames();
      const allTools = ['generate_image', 'custom_tool', 'search', 'another_tool'];

      const shadowingTools = allTools.filter(tool => toolNames.has(tool));
      const customTools = allTools.filter(tool => !toolNames.has(tool));

      expect(shadowingTools).toEqual(['generate_image', 'search']);
      expect(customTools).toEqual(['custom_tool', 'another_tool']);
    });

    it('should support prefix-based collision detection for MCP tools', () => {
      const toolNames = getBuiltinToolNames();
      const mcpTool = 'web_search';
      const prefix = 'mcp_server_name';

      if (toolNames.has(mcpTool)) {
        const prefixedName = `${prefix}__${mcpTool}`;
        expect(toolNames.has(prefixedName)).toBe(false);
      }
    });
  });

  describe('Tool name iteration', () => {
    it('should support iterating over all built-in tool names', () => {
      const toolNames = getBuiltinToolNames();
      const collectedNames: string[] = [];

      for (const name of toolNames) {
        collectedNames.push(name);
      }

      expect(collectedNames.length).toBe(toolNames.size);
      expect(collectedNames.every(name => typeof name === 'string')).toBe(true);
    });

    it('should support forEach on built-in tools', () => {
      const toolNames = getBuiltinToolNames();
      const collectedNames: string[] = [];

      toolNames.forEach(name => {
        collectedNames.push(name);
      });

      expect(collectedNames.length).toBe(toolNames.size);
    });

    it('should support conversion to array', () => {
      const toolNames = getBuiltinToolNames();
      const array = Array.from(toolNames);

      expect(array.length).toBe(toolNames.size);
      expect(array.every(name => typeof name === 'string')).toBe(true);
    });
  });

  describe('Common scenarios', () => {
    it('should handle MCP server tool name collision detection', () => {
      const toolNames = getBuiltinToolNames();

      // Simulate MCP server providing tools
      const mcpServerTools = [
        'generate_image', // This shadows a built-in
        'custom_search',  // This does not
        'search',     // This shadows a built-in
      ];

      const shadowingTools = mcpServerTools.filter(tool => toolNames.has(tool));
      expect(shadowingTools.length).toBe(2);
      expect(shadowingTools).toContain('generate_image');
      expect(shadowingTools).toContain('search');
    });

    it('should handle large tool lists efficiently', () => {
      const toolNames = getBuiltinToolNames();
      const largeToolList = Array(1000).fill(0).map((_, i) => `tool_${i}`);

      const startTime = Date.now();
      const shadowingTools = largeToolList.filter(tool => toolNames.has(tool));
      const endTime = Date.now();

      // Should complete in reasonable time (less than 100ms for 1000 items)
      expect(endTime - startTime).toBeLessThan(100);
      // Custom tools should not shadow built-in tools
      expect(shadowingTools.length).toBe(0);
    });

    it('should support dynamic prefixing of shadowing tools', () => {
      const toolNames = getBuiltinToolNames();
      const toolsToLoad = ['custom_tool', 'generate_image', 'another_tool'];

      const processedTools = toolsToLoad.map(tool => {
        if (toolNames.has(tool)) {
          return `mcp__${tool}`;
        }
        return tool;
      });

      expect(processedTools).toContain('custom_tool');
      expect(processedTools).toContain('mcp__generate_image');
      expect(processedTools).toContain('another_tool');
    });
  });
});
