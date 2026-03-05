/**
 * Shell Tools Tests
 *
 * Tests for shell tool definitions and utilities.
 */

import {
  getAllShellToolDefinitions,
  SHELL_TOOL_NAMES,
  isShellTool,
  shellChdirToolDefinition,
  shellExecSyncToolDefinition,
  shellExecAsyncToolDefinition,
  shellAsyncResultToolDefinition,
  shellSudoSyncToolDefinition,
  shellCpHostToolDefinition,
} from '@/lib/tools/shell/shell-tools';

describe('Shell Tool Definitions', () => {
  describe('getAllShellToolDefinitions', () => {
    it('should return all 6 tool definitions', () => {
      const tools = getAllShellToolDefinitions();
      expect(tools).toHaveLength(6);
    });

    it('should return tools in OpenAI format', () => {
      const tools = getAllShellToolDefinitions();
      for (const tool of tools) {
        expect(tool).toHaveProperty('type', 'function');
        expect(tool).toHaveProperty('function');
        expect(tool.function).toHaveProperty('name');
        expect(tool.function).toHaveProperty('description');
        expect(tool.function).toHaveProperty('parameters');
      }
    });
  });

  describe('SHELL_TOOL_NAMES', () => {
    it('should contain all expected tool names', () => {
      expect(SHELL_TOOL_NAMES).toContain('chdir');
      expect(SHELL_TOOL_NAMES).toContain('exec_sync');
      expect(SHELL_TOOL_NAMES).toContain('exec_async');
      expect(SHELL_TOOL_NAMES).toContain('async_result');
      expect(SHELL_TOOL_NAMES).toContain('sudo_sync');
      expect(SHELL_TOOL_NAMES).toContain('cp_host');
    });

    it('should have exactly 6 entries', () => {
      expect(SHELL_TOOL_NAMES).toHaveLength(6);
    });
  });

  describe('isShellTool', () => {
    it('should return true for shell tool names', () => {
      expect(isShellTool('chdir')).toBe(true);
      expect(isShellTool('exec_sync')).toBe(true);
      expect(isShellTool('exec_async')).toBe(true);
      expect(isShellTool('async_result')).toBe(true);
      expect(isShellTool('sudo_sync')).toBe(true);
      expect(isShellTool('cp_host')).toBe(true);
    });

    it('should return false for non-shell tool names', () => {
      expect(isShellTool('generate_image')).toBe(false);
      expect(isShellTool('search_memories')).toBe(false);
      expect(isShellTool('rng')).toBe(false);
      expect(isShellTool('unknown_tool')).toBe(false);
      expect(isShellTool('')).toBe(false);
    });
  });

  describe('individual tool definitions', () => {
    it('chdir should have optional path parameter', () => {
      const params = shellChdirToolDefinition.function.parameters;
      expect(params.properties).toHaveProperty('path');
      expect(params.required).toEqual([]);
    });

    it('exec_sync should require command parameter', () => {
      const params = shellExecSyncToolDefinition.function.parameters;
      expect(params.properties).toHaveProperty('command');
      expect(params.properties).toHaveProperty('parameters');
      expect(params.properties).toHaveProperty('timeout_ms');
      expect(params.required).toContain('command');
    });

    it('exec_async should require command parameter', () => {
      const params = shellExecAsyncToolDefinition.function.parameters;
      expect(params.required).toContain('command');
    });

    it('async_result should require pid parameter', () => {
      const params = shellAsyncResultToolDefinition.function.parameters;
      expect(params.properties).toHaveProperty('pid');
      expect(params.required).toContain('pid');
    });

    it('sudo_sync should require command parameter', () => {
      const params = shellSudoSyncToolDefinition.function.parameters;
      expect(params.required).toContain('command');
    });

    it('cp_host should require source and destination', () => {
      const params = shellCpHostToolDefinition.function.parameters;
      expect(params.properties).toHaveProperty('source');
      expect(params.properties).toHaveProperty('destination');
      expect(params.required).toContain('source');
      expect(params.required).toContain('destination');
    });
  });
});
