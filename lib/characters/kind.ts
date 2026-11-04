/**
 * Character kind — how a character is performed.
 *
 * `roleplay` (the default) is a person inside a story: they have stakes, they
 * react to what happens, and their tools are things they do in the scene.
 * `assistant` is a character whose job is to do work for the operator —
 * research, drafting, organizing — while keeping a personality.
 *
 * Kind describes the performance, not the fiction. An AI in the story (a
 * ship's mind, a household system) who lives in the scene is still
 * `roleplay`.
 *
 * Stored in the character vault's `properties.json` beside the other
 * per-character settings, so it travels with the vault, exports and shared
 * vaults. Absent, unrecognized or unreadable values read as `roleplay`.
 *
 * This module is the one place a kind is read or compared. Callers ask
 * `resolveCharacterKind` / `isAssistantCharacter` rather than testing the raw
 * field, so a third kind, or a change to the default, lands here alone. A
 * grep-test (`__tests__/unit/lib/characters/kind-chokepoint.test.ts`) holds
 * that line.
 *
 * Client-safe: no server imports.
 *
 * Design of record: docs/developer/features/character-kind-and-roleplay-defaults.md
 */

export const CHARACTER_KINDS = ['roleplay', 'assistant'] as const

export type CharacterKind = (typeof CHARACTER_KINDS)[number]

export const DEFAULT_CHARACTER_KIND: CharacterKind = 'roleplay'

/** Normalize any stored value to a kind; anything unrecognized is the default. */
export function characterKindOrDefault(value: unknown): CharacterKind {
  return value === 'roleplay' || value === 'assistant' ? value : DEFAULT_CHARACTER_KIND
}

/**
 * The kind of a character. A character read without its vault (a raw row) or
 * from a vault written before kinds existed resolves to the default.
 */
export function resolveCharacterKind(
  character: { kind?: unknown } | null | undefined,
): CharacterKind {
  return characterKindOrDefault(character?.kind)
}

/** Whether a character is performed as an assistant rather than a roleplay character. */
export function isAssistantCharacter(character: { kind?: unknown } | null | undefined): boolean {
  return resolveCharacterKind(character) === 'assistant'
}

/**
 * What Agent Mode means for a character. `research` is the assistant's loop:
 * iterate, verify, and finish with a structured `submit_final_response`.
 * `in-character` makes tools the character's hands in the scene: act, then
 * write the turn in prose, with no summary and no `submit_final_response`.
 */
export type AgentModeFlavor = 'research' | 'in-character'

/**
 * Which tool-rules preamble a character hears. Both keep every rule against
 * narrating a tool call instead of making it; `roleplay` drops the claim that
 * the rules override the character.
 */
export type ToolRulesVariant = 'assistant' | 'roleplay'

/** Everything a kind decides, derived in one place. */
export interface KindPolicy {
  kind: CharacterKind
  agentFlavor: AgentModeFlavor
  toolRules: ToolRulesVariant
}

const KIND_POLICIES: Readonly<Record<CharacterKind, KindPolicy>> = {
  roleplay: { kind: 'roleplay', agentFlavor: 'in-character', toolRules: 'roleplay' },
  assistant: { kind: 'assistant', agentFlavor: 'research', toolRules: 'assistant' },
}

/** The behaviour a kind decides. The only place a kind turns into behaviour. */
export function kindPolicy(kind: CharacterKind): KindPolicy {
  return KIND_POLICIES[characterKindOrDefault(kind)]
}

/** The behaviour a character's kind decides. */
export function characterKindPolicy(character: { kind?: unknown } | null | undefined): KindPolicy {
  return kindPolicy(resolveCharacterKind(character))
}
