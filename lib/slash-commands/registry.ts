/**
 * Composer slash commands — the registry (pure logic).
 *
 * Turns what the composer has to offer — the actions it wired, Prospero's tools
 * for the chat, Pascal's roster — into one list of commands. An unavailable or
 * non-user-invocable built-in is not a command at all: the Run Tool dialog
 * still lists it with its reason, and the menu has no disabled-row state.
 *
 * @module lib/slash-commands/registry
 */

import type {
  ComposerAction,
  SlashBuiltInToolSource,
  SlashCommand,
  SlashCommandSources,
  SlashCustomToolSource,
} from './types';

interface ActionSpec {
  label: string;
  description: string;
  keywords: string[];
  needsDialog: boolean;
}

/** The fixed action table, in no particular order (ranking orders it). */
export const COMPOSER_ACTION_SPECS: Readonly<Record<ComposerAction, ActionSpec>> = {
  attach: {
    label: 'Attach file',
    description: 'Attach a file from your computer',
    keywords: ['upload', 'paperclip'],
    needsDialog: false,
  },
  library: {
    label: 'Attach from library',
    description: 'Attach a file already in your library',
    keywords: ['file', 'document'],
    needsDialog: false,
  },
  image: {
    label: 'Generate image',
    description: 'Commission a picture for the chat',
    keywords: ['picture', 'camera', 'lantern'],
    needsDialog: false,
  },
  announce: {
    label: 'Insert announcement',
    description: 'Post an announcement into the chat',
    keywords: ['megaphone'],
    needsDialog: false,
  },
  mail: {
    label: 'Post a letter',
    description: 'Compose mail for a character',
    keywords: ['letter', 'post', 'office'],
    needsDialog: false,
  },
  inform: {
    label: 'Inform the cast',
    description: 'A word out of character, delivered before a seat next speaks',
    keywords: ['ooc', 'tell'],
    needsDialog: false,
  },
  deus: {
    label: 'Deus Ex Machina',
    description: 'Post this line as established fact',
    keywords: ['fact', 'true', 'canon', 'dem'],
    needsDialog: false,
  },
  tool: {
    label: 'Run Tool',
    description: "Open Prospero's Run Tool dialog",
    keywords: ['prospero'],
    needsDialog: true,
  },
  pascal: {
    label: "Pascal's Table",
    description: 'Open the custom-tool dialog',
    keywords: ['custom', 'tools', 'wand'],
    needsDialog: true,
  },
  roll: {
    label: 'Roll dice',
    description: 'Open the random-number tool to choose sides and count',
    keywords: ['dice', 'rng', 'random'],
    needsDialog: true,
  },
  d6: {
    label: 'Roll a d6',
    description: 'Roll one six-sided die',
    keywords: ['dice', 'die', 'roll'],
    needsDialog: false,
  },
  d20: {
    label: 'Roll a d20',
    description: 'Roll one twenty-sided die',
    keywords: ['dice', 'die', 'roll'],
    needsDialog: false,
  },
  coin: {
    label: 'Flip a coin',
    description: 'Heads or tails',
    keywords: ['flip', 'toss', 'heads', 'tails'],
    needsDialog: false,
  },
  bottle: {
    label: 'Spin the bottle',
    description: 'Let the bottle choose someone in the chat',
    keywords: ['spin'],
    needsDialog: false,
  },
};

function actionCommand(action: ComposerAction): SlashCommand {
  const spec = COMPOSER_ACTION_SPECS[action];
  return {
    key: `action:${action}`,
    kind: 'action',
    command: action,
    label: spec.label,
    description: spec.description,
    keywords: [...spec.keywords],
    source: 'Composer',
    needsDialog: spec.needsDialog,
    payload: { kind: 'action', action },
  };
}

/** Whether a JSON-schema-ish `parameters` object declares at least one property. */
function declaresProperties(parameters: SlashBuiltInToolSource['parameters']): boolean {
  if (!parameters || typeof parameters !== 'object') return false;
  const properties = (parameters as { properties?: unknown }).properties;
  return !!properties && typeof properties === 'object' && Object.keys(properties).length > 0;
}

function builtInCommand(tool: SlashBuiltInToolSource): SlashCommand {
  const qualifier = tool.pluginName || tool.category;
  return {
    key: `builtin:${tool.id}`,
    kind: 'builtin-tool',
    command: tool.id,
    label: tool.name,
    description: tool.description,
    keywords: [tool.category, tool.pluginName].filter((k): k is string => !!k),
    source: qualifier ? `Prospero · ${qualifier}` : 'Prospero',
    needsDialog: declaresProperties(tool.parameters),
    payload: { kind: 'builtin-tool', toolId: tool.id },
  };
}

function customCommand(tool: SlashCustomToolSource): SlashCommand {
  const asCharacterId = tool.asCharacterId ?? null;
  return {
    key: `custom:${tool.name}::${asCharacterId ?? ''}`,
    kind: 'custom-tool',
    command: tool.name,
    label: tool.title,
    description: tool.description,
    keywords: tool.characterLabel ? [tool.characterLabel] : [],
    source: tool.characterLabel ? `Pascal · as ${tool.characterLabel}` : 'Pascal',
    needsDialog: Object.keys(tool.parameters ?? {}).length > 0,
    payload: { kind: 'custom-tool', name: tool.name, asCharacterId },
  };
}

/**
 * Every command the composer can offer. A custom tool and a built-in with the
 * same command word are both listed — their sources differ visibly, and the
 * ranking puts the custom one first.
 */
export function buildSlashCommands(sources: SlashCommandSources): SlashCommand[] {
  const commands: SlashCommand[] = [];

  for (const action of Object.keys(COMPOSER_ACTION_SPECS) as ComposerAction[]) {
    if (sources.actions.has(action)) commands.push(actionCommand(action));
  }

  const seenBuiltIns = new Set<string>();
  for (const tool of sources.builtInTools) {
    if (tool.userInvocable === false || tool.available === false) continue;
    if (!tool.id || seenBuiltIns.has(tool.id)) continue;
    seenBuiltIns.add(tool.id);
    commands.push(builtInCommand(tool));
  }

  const seenCustom = new Set<string>();
  for (const tool of sources.customTools) {
    if (!tool.name) continue;
    const command = customCommand(tool);
    if (seenCustom.has(command.key)) continue;
    seenCustom.add(command.key);
    commands.push(command);
  }

  return commands;
}
