/**
 * @fileoverview Calliope's tool slate (Calliope Live, Spec J §2.2): the five
 * `theme_*` definitions, in one list, so her persona offers them
 * (`buildTools({ onlyTools })`) and the executor dispatches them from one
 * source. Offered on no other surface; their handlers also refuse outside a
 * Calliope conversation (`handlers/theme-assist-handler.ts`).
 */

import type { UniversalTool } from '@/lib/plugins/interfaces';
import { themeReadDraftToolDefinition } from './theme-read-draft-tool';
import { themeLookupTokensToolDefinition } from './theme-lookup-tokens-tool';
import { themeLookupHooksToolDefinition } from './theme-lookup-hooks-tool';
import { themeCheckContrastToolDefinition } from './theme-check-contrast-tool';
import { themeProposeToolDefinition } from './theme-propose-tool';

export const THEME_ASSIST_TOOL_DEFINITIONS: readonly UniversalTool[] = Object.freeze([
  themeReadDraftToolDefinition,
  themeLookupTokensToolDefinition,
  themeLookupHooksToolDefinition,
  themeCheckContrastToolDefinition,
  themeProposeToolDefinition,
] as UniversalTool[]);

export const THEME_ASSIST_TOOL_NAMES: readonly string[] = Object.freeze(
  THEME_ASSIST_TOOL_DEFINITIONS.map((t) => t.function.name),
);
