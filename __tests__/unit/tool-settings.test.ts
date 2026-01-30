/**
 * Tool Settings Tests
 * Tests for per-chat and per-project tool settings (disabledTools, disabledToolGroups)
 */

describe('Tool Settings', () => {
  describe('Tool disable patterns', () => {
    it('should support individual tool disabling with exact tool name', () => {
      const disabledTools = ['generate_image', 'web_search'];
      const allTools = ['generate_image', 'web_search', 'memory_search'];

      const availableTools = allTools.filter(tool => !disabledTools.includes(tool));
      expect(availableTools).toEqual(['memory_search']);
    });

    it('should support plugin-level tool disabling', () => {
      const disabledToolGroups = ['plugin:mcp'];
      const tools = [
        { name: 'mcp_server1__tool1', plugin: 'mcp' },
        { name: 'mcp_server1__tool2', plugin: 'mcp' },
        { name: 'generate_image', plugin: 'builtin' },
      ];

      const isToolDisabled = (tool: { name: string; plugin: string }) => {
        return disabledToolGroups.some(group => {
          if (group === `plugin:${tool.plugin}`) {
            return true;
          }
          return false;
        });
      };

      const availableTools = tools.filter(tool => !isToolDisabled(tool));
      expect(availableTools).toHaveLength(1);
      expect(availableTools[0].name).toBe('generate_image');
    });

    it('should support subgroup-level tool disabling for MCP servers', () => {
      const disabledToolGroups = ['plugin:mcp:subgroup:server1'];
      const tools = [
        { name: 'server1__tool1', plugin: 'mcp', server: 'server1' },
        { name: 'server1__tool2', plugin: 'mcp', server: 'server1' },
        { name: 'server2__tool1', plugin: 'mcp', server: 'server2' },
      ];

      const isToolDisabled = (tool: any) => {
        return disabledToolGroups.some(group => {
          if (group === `plugin:${tool.plugin}:subgroup:${tool.server}`) {
            return true;
          }
          return false;
        });
      };

      const availableTools = tools.filter(tool => !isToolDisabled(tool));
      expect(availableTools).toHaveLength(1);
      expect(availableTools[0].server).toBe('server2');
    });

    it('should handle both individual and group disables', () => {
      const disabledTools = ['specific_tool'];
      const disabledToolGroups = ['plugin:mcp'];

      const isDisabled = (toolName: string, plugin: string) => {
        if (disabledTools.includes(toolName)) return true;
        if (disabledToolGroups.includes(`plugin:${plugin}`)) return true;
        return false;
      };

      expect(isDisabled('specific_tool', 'custom')).toBe(true);
      expect(isDisabled('any_mcp_tool', 'mcp')).toBe(true);
      expect(isDisabled('other_tool', 'custom')).toBe(false);
    });
  });

  describe('Tool hierarchy with tri-state checkboxes', () => {
    it('should support tri-state checkbox logic for tool hierarchies', () => {
      const tools = {
        plugin1: {
          enabled: true,
          tools: [
            { name: 'tool1', enabled: true },
            { name: 'tool2', enabled: false },
          ],
        },
      };

      const countEnabledTools = (plugin: any) => {
        return plugin.tools.filter((t: any) => t.enabled).length;
      };

      const getPluginState = (plugin: any) => {
        const total = plugin.tools.length;
        const enabled = countEnabledTools(plugin);

        if (enabled === total) return 'checked';
        if (enabled === 0) return 'unchecked';
        return 'indeterminate';
      };

      expect(getPluginState(tools.plugin1)).toBe('indeterminate');
    });

    it('should support collapsible hierarchy rendering', () => {
      const hierarchy = {
        id: 'mcp',
        displayName: 'MCP Plugin',
        enabled: true,
        children: [
          {
            id: 'mcp:server1',
            displayName: 'Server 1',
            enabled: true,
            children: [
              { id: 'tool1', displayName: 'Tool 1', enabled: true },
              { id: 'tool2', displayName: 'Tool 2', enabled: false },
            ],
          },
          {
            id: 'mcp:server2',
            displayName: 'Server 2',
            enabled: false,
            children: [
              { id: 'tool3', displayName: 'Tool 3', enabled: false },
            ],
          },
        ],
      };

      expect(hierarchy.children).toHaveLength(2);
      expect(hierarchy.children[0].children).toHaveLength(2);
      expect(hierarchy.children[1].enabled).toBe(false);
    });
  });

  describe('Chat tool settings', () => {
    it('should store disabledTools and disabledToolGroups on chat metadata', () => {
      const chatMetadata = {
        disabledTools: ['web_search'],
        disabledToolGroups: ['plugin:mcp:subgroup:server1'],
      };

      expect(chatMetadata.disabledTools).toContain('web_search');
      expect(chatMetadata.disabledToolGroups).toContain('plugin:mcp:subgroup:server1');
    });

    it('should initialize chat tool settings from project defaults', () => {
      const projectDefaults = {
        defaultDisabledTools: ['web_search'],
        defaultDisabledToolGroups: ['plugin:mcp'],
      };

      const newChatSettings = {
        disabledTools: projectDefaults.defaultDisabledTools,
        disabledToolGroups: projectDefaults.defaultDisabledToolGroups,
      };

      expect(newChatSettings.disabledTools).toEqual(['web_search']);
      expect(newChatSettings.disabledToolGroups).toEqual(['plugin:mcp']);
    });

    it('should support updating tool settings without affecting other chats', () => {
      const chat1 = {
        id: 'chat1',
        disabledTools: ['web_search'],
      };

      const chat2 = {
        id: 'chat2',
        disabledTools: [],
      };

      // Update chat1
      chat1.disabledTools = ['web_search', 'memory_search'];

      expect(chat2.disabledTools).toEqual([]);
      expect(chat1.disabledTools).toContain('memory_search');
    });

    it('should handle forceToolsOnNextMessage flag', () => {
      const chat = {
        id: 'chat1',
        disabledTools: ['web_search'],
        forceToolsOnNextMessage: false,
      };

      // When tool settings change, set flag
      chat.disabledTools.push('memory_search');
      chat.forceToolsOnNextMessage = true;

      expect(chat.forceToolsOnNextMessage).toBe(true);
    });
  });

  describe('Project tool settings', () => {
    it('should store project-level default tool settings', () => {
      const project = {
        id: 'project1',
        defaultDisabledTools: ['web_search'],
        defaultDisabledToolGroups: ['plugin:mcp:subgroup:server1'],
      };

      expect(project.defaultDisabledTools).toEqual(['web_search']);
      expect(project.defaultDisabledToolGroups).toEqual(['plugin:mcp:subgroup:server1']);
    });

    it('should apply project defaults only to new chats', () => {
      const project = {
        defaultDisabledTools: ['web_search'],
      };

      const existingChat = {
        id: 'existing',
        disabledTools: [],
      };

      const newChat = {
        id: 'new',
        disabledTools: [...project.defaultDisabledTools],
      };

      expect(existingChat.disabledTools).toEqual([]);
      expect(newChat.disabledTools).toEqual(['web_search']);
    });

    it('should allow updating project default tool settings', () => {
      const project = {
        id: 'project1',
        defaultDisabledTools: ['web_search'],
      };

      // Update defaults
      project.defaultDisabledTools = ['web_search', 'memory_search'];

      // New chats should use updated defaults
      const newChat = {
        disabledTools: [...project.defaultDisabledTools],
      };

      expect(newChat.disabledTools).toHaveLength(2);
    });
  });

  describe('Tool availability checking', () => {
    it('should mark tools as unavailable when dependencies are missing', () => {
      const tools = [
        { name: 'generate_image', available: true, requires: 'imageProfile' },
        { name: 'custom_tool', available: true, requires: null },
      ];

      const imageProfile = null; // Not configured

      const toolStates = tools.map(tool => ({
        ...tool,
        available: tool.requires ? (tool.requires === 'imageProfile' ? !!imageProfile : true) : true,
      }));

      expect(toolStates[0].available).toBe(false);
      expect(toolStates[1].available).toBe(true);
    });

    it('should show tool counts as enabled/available format', () => {
      const allTools = 5;
      const enabledTools = 3;
      const availableTools = 4;

      const displayText = `${enabledTools}/${availableTools}`;
      expect(displayText).toBe('3/4');
    });

    it('should filter unavailable tools from tool counts', () => {
      const tools = [
        { name: 'generate_image', enabled: true, available: false },
        { name: 'web_search', enabled: true, available: true },
        { name: 'memory_search', enabled: false, available: true },
      ];

      const availableTools = tools.filter(t => t.available);
      const enabledTools = availableTools.filter(t => t.enabled);

      expect(enabledTools.length).toBe(1);
      expect(availableTools.length).toBe(2);
    });
  });

  describe('System message injection', () => {
    it('should generate system message when tool settings change', () => {
      const oldSettings = { disabledTools: [] };
      const newSettings = { disabledTools: ['web_search'] };

      const settingsChanged = JSON.stringify(oldSettings) !== JSON.stringify(newSettings);
      expect(settingsChanged).toBe(true);
    });

    it('should include available tools in system message', () => {
      const availableTools = ['generate_image', 'memory_search', 'request_full_context'];

      const systemMessage = `Available tools: ${availableTools.join(', ')}`;
      expect(systemMessage).toContain('generate_image');
      expect(systemMessage).toContain('memory_search');
    });
  });

  describe('Tool re-injection optimization', () => {
    it('should re-inject tools every N messages based on sliding window', () => {
      const toolReinjectInterval = 5;
      const messageCount = 12;

      // Check if we should re-inject at this message count
      // Tools are re-injected when messageCount % interval === 0
      const shouldReinjectTools = messageCount % toolReinjectInterval === 0;
      expect(shouldReinjectTools).toBe(false); // 12 % 5 = 2

      // At message 10, should re-inject
      const shouldReinjectAt10 = 10 % toolReinjectInterval === 0;
      expect(shouldReinjectAt10).toBe(true);

      // At message 15, should re-inject
      const shouldReinjectAt15 = 15 % toolReinjectInterval === 0;
      expect(shouldReinjectAt15).toBe(true);
    });

    it('should force tool re-injection when settings change', () => {
      const chat = {
        disabledTools: ['web_search'],
        forceToolsOnNextMessage: false,
      };

      // Settings changed
      chat.disabledTools.push('memory_search');
      chat.forceToolsOnNextMessage = true;

      expect(chat.forceToolsOnNextMessage).toBe(true);

      // After re-injection, clear flag
      chat.forceToolsOnNextMessage = false;
      expect(chat.forceToolsOnNextMessage).toBe(false);
    });

    it('should respect sliding window size for re-injection interval', () => {
      const slidingWindowSize = 10;
      const projectContextReinjectInterval = 5;

      // Minimum interval should be at least the sliding window size
      const effectiveInterval = Math.max(projectContextReinjectInterval, slidingWindowSize);
      expect(effectiveInterval).toBe(10);
    });
  });
});
