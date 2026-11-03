/**
 * Pure-logic tests for the composer's `/` slash commands: trigger, ranking,
 * registry.
 *
 * @module lib/slash-commands/__tests__/slash-commands.test
 */

import {
  buildSlashCommands,
  findSlashTrigger,
  rankSlashCommands,
  type ComposerAction,
  type SlashCommand,
  type SlashCommandSources,
} from '..';

const ALL_ACTIONS = new Set<ComposerAction>([
  'attach', 'library', 'image', 'announce', 'mail', 'inform', 'deus',
  'tool', 'pascal', 'roll', 'd6', 'd20', 'coin', 'bottle',
]);

function sources(overrides: Partial<SlashCommandSources> = {}): SlashCommandSources {
  return { actions: new Set(), builtInTools: [], customTools: [], ...overrides };
}

describe('findSlashTrigger', () => {
  it.each([
    ['/', 0, ''],
    ['/un', 0, 'un'],
    [' /un', 1, 'un'],
    ['(/un', 1, 'un'],
    ['hello /Wear', 6, 'wear'],
    ['line\n/d20', 5, 'd20'],
    ['/wardrobe_wear', 0, 'wardrobe_wear'],
  ])('opens on %j', (text, start, query) => {
    expect(findSlashTrigger(text)).toEqual({ start, end: text.length, query, closed: false });
  });

  it.each([
    'and/or',
    '10/15',
    'http://',
    'http://x',
    'see /usr/bin',
    'a/b/c',
    '/1',
    '/-',
    '/un ',
    'word/',
    `/${'a'.repeat(65)}`,
  ])('stays shut on %j', (text) => {
    expect(findSlashTrigger(text)).toBeNull();
  });
});

function command(partial: Partial<SlashCommand> & Pick<SlashCommand, 'command' | 'label' | 'kind'>): SlashCommand {
  return {
    key: `${partial.kind}:${partial.command}`,
    description: '',
    keywords: [],
    source: '',
    needsDialog: false,
    payload: { kind: 'action', action: 'attach' },
    ...partial,
  };
}

describe('rankSlashCommands', () => {
  const wear = command({ kind: 'builtin-tool', command: 'wardrobe_wear', label: 'Wear Wardrobe Items' });
  const unlock = command({ kind: 'custom-tool', command: 'unlock', label: 'Force the Lock' });
  const unlockBuiltIn = command({ kind: 'builtin-tool', command: 'unlock', label: 'Unlock' });
  const attach = command({ kind: 'action', command: 'attach', label: 'Attach file' });
  const announce = command({ kind: 'action', command: 'announce', label: 'Insert announcement' });
  const undo = command({ kind: 'builtin-tool', command: 'redo_thing', label: 'Redo' });
  const all = [wear, unlock, unlockBuiltIn, attach, announce, undo];

  it('returns every command for a bare slash, actions then custom then built-in, each by label', () => {
    expect(rankSlashCommands(all, '').map((c) => c.key)).toEqual([
      attach.key, announce.key, unlock.key, undo.key, unlockBuiltIn.key, wear.key,
    ]);
  });

  it('puts an exact command word first, then command prefixes', () => {
    const ranked = rankSlashCommands(all, 'un');
    expect(ranked.map((c) => c.key)).toEqual([unlock.key, unlockBuiltIn.key]);
    const exact = rankSlashCommands([undo, unlockBuiltIn], 'unlock');
    expect(exact[0]).toBe(unlockBuiltIn);
  });

  it('matches a word of the command split on underscores', () => {
    expect(rankSlashCommands(all, 'wear')).toEqual([wear]);
  });

  it('matches a word of the label and a keyword', () => {
    expect(rankSlashCommands(all, 'lock')).toEqual([unlock]);
    const tagged = command({ kind: 'action', command: 'mail', label: 'Post a letter', keywords: ['office'] });
    expect(rankSlashCommands([tagged], 'off')).toEqual([tagged]);
  });

  it('never matches mid-word', () => {
    expect(rankSlashCommands(all, 'nlo')).toEqual([]);
  });

  it('ranks the tighter tier above kind order', () => {
    const library = command({ kind: 'action', command: 'library', label: 'Attach from library' });
    const ranked = rankSlashCommands([library, attach], 'att');
    expect(ranked).toEqual([attach, library]);
  });

  it('honours the limit for a non-empty query', () => {
    const many = Array.from({ length: 20 }, (_, i) =>
      command({ kind: 'builtin-tool', command: `tool_${i}`, label: `Tool ${String(i).padStart(2, '0')}` }),
    );
    expect(rankSlashCommands(many, 'tool', 5)).toHaveLength(5);
    expect(rankSlashCommands(many, '', 5)).toHaveLength(20);
  });
});

describe('buildSlashCommands', () => {
  it('lists only the wired actions', () => {
    const commands = buildSlashCommands(sources({ actions: new Set<ComposerAction>(['attach', 'd20']) }));
    expect(commands.map((c) => c.command)).toEqual(['attach', 'd20']);
    expect(commands[0]).toMatchObject({ kind: 'action', source: 'Composer', payload: { kind: 'action', action: 'attach' } });
  });

  it('offers every action when all are wired', () => {
    expect(buildSlashCommands(sources({ actions: ALL_ACTIONS }))).toHaveLength(ALL_ACTIONS.size);
  });

  it('turns every available user-invocable built-in into a row and drops the rest', () => {
    const commands = buildSlashCommands(sources({
      builtInTools: [
        { id: 'self_inventory', name: 'Self Inventory', description: 'd', category: 'utility', parameters: { type: 'object', properties: {} } },
        { id: 'wardrobe_wear', name: 'Wear Wardrobe Items', description: 'd', category: 'wardrobe', parameters: { type: 'object', properties: { operations: {} } } },
        { id: 'internal', name: 'Internal', description: 'd', userInvocable: false },
        { id: 'generate_image', name: 'Generate Image', description: 'd', available: false, unavailableReason: 'no profile' },
        { id: 'mcp_x', name: 'MCP X', description: 'd', category: 'plugin', pluginName: 'mcp' },
      ],
    }));
    expect(commands.map((c) => c.command)).toEqual(['self_inventory', 'wardrobe_wear', 'mcp_x']);
    expect(commands[0]).toMatchObject({ needsDialog: false, source: 'Prospero · utility', key: 'builtin:self_inventory' });
    expect(commands[1]).toMatchObject({ needsDialog: true, source: 'Prospero · wardrobe', payload: { kind: 'builtin-tool', toolId: 'wardrobe_wear' } });
    expect(commands[2].source).toBe('Prospero · mcp');
  });

  it('builds custom tools with their character labels and parameter-driven dialogs', () => {
    const commands = buildSlashCommands(sources({
      customTools: [
        { name: 'unlock', title: 'Force the Lock', description: 'd', parameters: { bonus: { type: 'number' } } },
        { name: 'wear_regalia', title: 'Wear Regalia', description: 'd', parameters: {} },
        { name: 'wear_regalia', title: 'Wear Regalia', description: 'd', parameters: {}, characterLabel: 'Vivienne', asCharacterId: 'char-v' },
      ],
    }));
    expect(commands.map((c) => c.key)).toEqual([
      'custom:unlock::',
      'custom:wear_regalia::',
      'custom:wear_regalia::char-v',
    ]);
    expect(commands[0]).toMatchObject({ needsDialog: true, source: 'Pascal', payload: { asCharacterId: null } });
    expect(commands[1].needsDialog).toBe(false);
    expect(commands[2]).toMatchObject({ source: 'Pascal · as Vivienne', payload: { kind: 'custom-tool', name: 'wear_regalia', asCharacterId: 'char-v' } });
  });

  it('keeps both a custom tool and a built-in that share a command word, custom first when ranked', () => {
    const commands = buildSlashCommands(sources({
      builtInTools: [{ id: 'rng', name: 'Random Number Generator', description: 'd' }],
      customTools: [{ name: 'rng', title: 'House Dice', description: 'd', parameters: {} }],
    }));
    expect(commands).toHaveLength(2);
    expect(rankSlashCommands(commands, 'rng').map((c) => c.kind)).toEqual(['custom-tool', 'builtin-tool']);
  });
});
