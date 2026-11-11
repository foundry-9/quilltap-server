/**
 * The wire contract for casting a chat — `POST /api/v1/chats` — and for the
 * casting-defaults read the New Chat dialog makes before it.
 *
 * Every key the operator did not change is simply absent: the server resolves
 * each default once (`resolveCastingDefaults`), so an absent key always means
 * "use the default".
 *
 * Design of record: docs/developer/features/refactor-green-room-and-opening.md
 *
 * @module chat/opening/schema
 */

import { z } from 'zod'
import { ConciergeModeSchema, ScenarioRefSchema } from '@/lib/schemas/chat.types'
import { TimestampConfigSchema } from '@/lib/schemas/types'
import { OutfitSelectionSchema } from '@/lib/schemas/wardrobe.types'

// Participant schema for chat creation
export const createParticipantSchema = z.object({
  type: z.literal('CHARACTER'),
  characterId: z.uuid(),
  connectionProfileId: z.uuid().optional(),
  controlledBy: z.enum(['llm', 'user']).optional(),
  selectedSystemPromptId: z.uuid().optional(),
  /** Ids of the character's `Subprompts/*.md` to put in play for this chat. */
  selectedSubpromptIds: z.array(z.string().min(1).max(120)).max(100).optional(),
}).strict(); // An unknown key (the retired per-seat `imageProfileId` among them) is a 400.

export const createChatSchema = z.object({
  participants: z.array(createParticipantSchema).min(1, 'At least one participant is required'),
  title: z.string().optional(),
  /**
   * Free-text scenario notes; appended beneath any resolved preset body, or
   * the whole scenario when no preset is named. The scenario keys below
   * (`scenario`, `scenarioRef`, `scenarioId`, `projectScenarioPath`,
   * `groupScenarioPath`, `generalScenarioPath`) are one override: send any of
   * them and exactly what was sent is used (an empty `scenario` alone means
   * "no scenario"); send none and the cast's default applies (character >
   * project > general — `resolveCastingDefaults`).
   */
  scenario: z.string().optional(),
  scenarioId: z.string().uuid().optional(), // ID of a named scenario from the character's scenarios array
  /**
   * A scenario from anywhere in the instance — `{ mountPointId, path }` — as picked in
   * the scenario browser. Resolved first; a ref naming a mount that holds no scenarios
   * (anything but a character vault, a project's or group's official store, or General)
   * is a 400.
   */
  scenarioRef: ScenarioRefSchema.optional(),
  /**
   * Relative path of a project scenario file (`Scenarios/<filename>.md`) inside the
   * project's official document store. Server resolves the body from frontmatter +
   * markdown and bakes it into `chat.scenarioText`. Lower precedence than `scenario`
   * and `scenarioId`. Requires `projectId` to also be set.
   */
  projectScenarioPath: z.string().max(500).optional(),
  /**
   * Relative path of a general scenario file (`Scenarios/<filename>.md`) inside the
   * instance-wide "Quilltap General" mount. Lower precedence than `projectScenarioPath`
   * — only consulted when no higher-precedence scenario field is set. Does NOT require
   * `projectId`: general scenarios apply to project-less chats too.
   */
  generalScenarioPath: z.string().max(500).optional(),
  /**
   * Relative path of a group scenario file (`Scenarios/<filename>.md`) inside a
   * group's official document store, paired with `groupScenarioGroupId` (which
   * group's store to resolve it from). Offered in the New Chat dialog whenever
   * ANY selected participant is a member of the group (the one sanctioned
   * exception to per-responding-character group isolation — a chat-creation menu,
   * not a per-turn access grant). Lower precedence than `projectScenarioPath`,
   * higher than `generalScenarioPath`.
   */
  groupScenarioPath: z.string().max(500).optional(),
  groupScenarioGroupId: z.uuid().optional(),
  timestampConfig: TimestampConfigSchema.optional(),
  projectId: z.uuid().optional(),
  /**
   * Chat-level image profile (shared by all participants). As with
   * `roleplayTemplateId`, a present key wins outright — an explicit `null`
   * means the operator chose "No image generation" — and an omitted key falls
   * back to project > primary character > the instance's default profile.
   */
  imageProfileId: z.uuid().nullable().optional(),
  /**
   * Roleplay template for the new chat, chosen in the New Chat dialog. When the
   * key is present it wins outright — including an explicit `null`, which means
   * "no template" — over the project default and the user's global default.
   * Omit the key entirely to fall back to that default chain.
   */
  roleplayTemplateId: z.uuid().nullable().optional(),
  /**
   * Per-chat Concierge state to set at creation, using the same enum as the
   * sidebar's PUT `conciergeState` ('moderated' | 'unmoderated' | 'locked').
   * Omitted → the operator's `conciergeSettings.newChatsStartAs` default
   * (when the Concierge is on duty). 'moderated' → the chat is created
   * Moderated (no write, no announcement). The retired four-state values are
   * rejected with 400. Any other value is applied through `applyConciergeFlip`
   * while the chat is cast — before the opening's staff posts and greeting —
   * so the greeting is composed under the chosen state.
   */
  conciergeState: ConciergeModeSchema.optional(),
  /**
   * Per-character outfit choices. A character not named here arrives in the
   * one default mode (`defaultOutfitMode`, `lib/chat/opening/arrival.ts`).
   */
  outfitSelections: z.array(OutfitSelectionSchema).optional(),
  avatarGenerationEnabled: z.boolean().optional(), // Enable auto-generated character avatars on outfit changes
  /**
   * When set, the new chat is a "change of venue" continuation of an existing
   * chat: the source chat's most recent Librarian summary plus every later
   * message are replayed into the new chat (with participant IDs remapped),
   * turn state is replicated, and Host bubbles linking the two chats are
   * posted in both — all while the chat is cast, so the Salon opens on its
   * history. The opening's greeting is skipped.
   * The source chat must belong to the same user.
   */
  continuationFromChatId: z.uuid().optional(),

  // 4.6 Private Character Rooms — autonomous-room creation fields.
  // All only consulted when chatType === 'autonomous'.
  chatType: z.enum(['salon', 'autonomous']).optional(),
  scheduleCron: z.string().max(120).optional(),
  scheduleFreshnessWindowMs: z.number().int().positive().optional(),
  budgetMaxTurns: z.number().int().positive().optional(),
  budgetMaxTokens: z.number().int().positive().optional(),
  budgetMaxWallClockMs: z.number().int().positive().optional(),
  budgetEstimatedSpendCapUSD: z.number().positive().optional(),
  runVisibility: z.enum(['owner_only', 'household', 'open']).optional(),
  runDestructiveToolsAllowed: z.boolean().optional(),
  /**
   * Per-run token-budget counting mode. true (default) = exclude prompt-cache
   * hits from the budget (count only the billable cache-miss + output tokens);
   * false = count every token, including cache reads.
   */
  budgetExcludeCacheHits: z.boolean().optional(),
});

export type CreateChatInput = z.infer<typeof createChatSchema>
export type CreateParticipantInput = z.infer<typeof createParticipantSchema>

/** The scenario keys of a create request; any one present is an override. */
export const SCENARIO_KEYS = [
  'scenario',
  'scenarioRef',
  'scenarioId',
  'projectScenarioPath',
  'groupScenarioPath',
  'groupScenarioGroupId',
  'generalScenarioPath',
] as const satisfies ReadonlyArray<keyof CreateChatInput>

/** `GET /api/v1/chats?action=casting-defaults` — the prospective cast. */
export const castingDefaultsQuerySchema = z.object({
  /** Comma-separated character ids. */
  characterIds: z.string().min(1).transform((v) => v.split(',').map((s) => s.trim()).filter(Boolean)).pipe(z.array(z.uuid()).min(1)),
  /** Comma-separated ids of the characters the operator plays (a subset of `characterIds`). */
  userCharacterIds: z.string().optional().transform((v) => (v ? v.split(',').map((s) => s.trim()).filter(Boolean) : [])).pipe(z.array(z.uuid())),
  projectId: z.uuid().optional(),
  continuationFromChatId: z.uuid().optional(),
  chatType: z.enum(['salon', 'autonomous']).optional(),
})
export type CastingDefaultsQuery = z.infer<typeof castingDefaultsQuerySchema>
