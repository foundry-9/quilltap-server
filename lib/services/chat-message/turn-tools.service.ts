/**
 * Turn Tools — the tool slate a Salon turn offers its character.
 *
 * One call answers every tool question a turn asks before its context is
 * built: which tools the character holds, the highest effect any of them may
 * have this turn, whether they travel natively or as a text protocol
 * (simple-json / text-block), the instructions that protocol needs in the
 * system prompt, and the stop sequences it needs on the wire. Once the model
 * has answered, `runTurnTextToolPasses` reads any text-protocol calls back.
 * The tool context the executor runs calls under is built from the same
 * slate, so the roster the model is offered and the one the executor can find
 * never differ.
 */

import { createServiceLogger } from '@/lib/logging/create-logger'
import { lowerToolEffect, offeredTools, type ToolEffect, type ToolOffer } from '@/lib/tools/effects'
import type { RosterContext as CustomToolRosterContext } from '@/lib/pascal/custom-tools'
import type { ToolExecutionContext } from '@/lib/chat/tool-executor'
import type { getRepositories } from '@/lib/repositories/factory'
import type { Character, ChatMetadataBase, ChatParticipantBase, ConnectionProfile, ImageProfile, MessageEvent } from '@/lib/schemas/types'
import type { ChatSettings } from '@/lib/schemas/settings.types'
import type { BuiltContext } from '@/lib/chat/context-manager'
import {
  buildNativeToolSystemInstructions,
  buildSimpleJsonSystemInstructions,
  buildTextBlockSystemInstructions,
  checkResolvedToolMode,
  determineTextBlockToolOptions,
  logSimpleJsonToolUsage,
  logTextBlockToolUsage,
  formatSimpleJsonToolResult,
  hasSimpleJsonInResponse,
  parseSimpleJsonFromResponse,
  parseTextBlocksFromResponse,
  SIMPLE_JSON_STOP,
  stripSimpleJsonFromResponse,
  stripTextBlockMarkersFromResponse,
} from './pseudo-tool.service'
import { buildTools, toolNameOf, type BuildToolsOptions } from './streaming.service'
import { createToolContext } from './tool-execution.service'
import { effectiveToolLoopCall } from './native-tool-loop.service'
import { runTextToolPass, type RunTextToolPassOptions, type TextToolStrategy } from './text-tool-loop.service'
import { getProvider } from '@/lib/plugins/provider-registry'
import { hasTextBlockMarkers } from '@/lib/tools'
import { characterKindPolicy } from '@/lib/characters/kind'
import type { FormatToolsFor, ProfileToolFormat } from './types'

const logger = createServiceLogger('TurnTools')

type PseudoToolMode = 'auto' | 'native' | 'simple-json' | 'text-block'

/**
 * The primary's tool format (`actualTools`, `resolvedToolMode`,
 * `useTextBlockTools`, `useNativeWebSearch`, `stopSequences`) comes from
 * `formatToolsFor(profile)`, the same function failover calls for a stand-in.
 */
export interface TurnToolSlate extends ProfileToolFormat {
  /** Every tool the character holds this turn, ceiling applied. */
  tools: unknown[]
  /** Tool rules for the system prompt (undefined when none are needed). */
  toolInstructions: string | undefined
  /**
   * Formats this turn's tools for another profile: rebuilt for its provider's
   * tool shape and its own tool mode, and narrowed to the tools the primary
   * offered (the executor's permit is the primary's). Failover calls it for
   * every substitute (#181). The primary's own id returns the primary format.
   */
  formatToolsFor: FormatToolsFor
  /** The highest effect a tool call may have this turn; unset = no ceiling. */
  effectCeiling: ToolEffect | undefined
  customToolEffects: Map<string, ToolEffect>
  pluginToolEffects: Map<string, ToolEffect>
  /** The tool names this seat was offered this turn; the executor refuses any other. */
  toolOffer: ToolOffer
  /** The operator changed tool settings since the last turn (the tool-change notice fires). */
  toolSettingsChanged: boolean
}

export interface TurnToolSlateParams {
  repos: ReturnType<typeof getRepositories>
  chat: ChatMetadataBase
  userId: string
  chatSettings: ChatSettings | null
  character: Character
  /** The profile the turn will actually be sent on (after any Concierge reroute). */
  profile: ConnectionProfile
  imageProfileId: string | null
  imageProfile: ImageProfile | null
  compressionEnabled: boolean
  /**
   * Offer `submit_final_response`: Agent Mode is on in its research flavour
   * (an assistant character). An in-character turn is never offered it.
   */
  offerSubmitFinalResponse: boolean
  isMultiCharacter: boolean
  /** A storyteller turn starts at its bid's tier. */
  storytellerCeiling?: ToolEffect
}

/**
 * Resolve the turn's tool slate. Spends the chat's `forceToolsOnNextMessage`
 * flag (the tool-change notice it asks for fires on this turn).
 */
export async function resolveTurnToolSlate(params: TurnToolSlateParams): Promise<TurnToolSlate> {
  const { repos, chat, userId, chatSettings, character, profile, imageProfileId } = params
  const chatId = chat.id

  const toolSettingsChanged = chat.forceToolsOnNextMessage === true
  if (toolSettingsChanged) {
    await repos.chats.update(chatId, { forceToolsOnNextMessage: false })
  }

  // The Courier transport exposes no tools (the external LLM cannot reach
  // them) and injects no tool instructions into the system prompt.
  if (profile.transport === 'courier') {
    const noTools: ProfileToolFormat = {
      actualTools: [],
      resolvedToolMode: 'native', // Courier sends no tools anyway; the value is unused.
      useTextBlockTools: false,
      useNativeWebSearch: false,
      stopSequences: undefined,
    }
    return {
      ...noTools,
      tools: [],
      toolInstructions: undefined,
      formatToolsFor: async () => noTools,
      effectCeiling: params.storytellerCeiling,
      customToolEffects: new Map(),
      pluginToolEffects: new Map(),
      toolOffer: offeredTools([]),
      toolSettingsChanged,
    }
  }

  // Character capabilities. Help tools are opt-in; wardrobe and inventory are
  // held unless denied.
  const helpToolsEnabled = character.defaultHelpToolsEnabled === true
  const canDressThemselves = character.canDressThemselves !== false
  const canCreateOutfits = character.canCreateOutfits !== false
  const canManageInventory = character.canManageInventory !== false

  // System transparency: a character not opted in never gets self_inventory,
  // whatever the chat- and project-level toggles say.
  const characterIsTransparent = character.systemTransparency === true
  const disabledTools = characterIsTransparent
    ? (chat.disabledTools ?? [])
    : Array.from(new Set([...(chat.disabledTools ?? []), 'self_inventory']))

  const effectCeiling = resolveTurnEffectCeiling(chat, chatSettings, params.storytellerCeiling)
  const [documentEditingEnabled, askCarinaEnabled] = await Promise.all([
    projectHasLinkedStores(repos, chat),
    isAskCarinaOffered(repos, chatId, characterIsTransparent),
  ])

  const buildOptions: Omit<BuildToolsOptions, 'connectionProfile'> = {
    userId,
    imageProfileId,
    imageProfile: params.imageProfile,
    projectId: chat.projectId,
    requestFullContext: params.compressionEnabled,
    disabledTools,
    disabledToolGroups: chat.disabledToolGroups ?? [],
    agentModeEnabled: params.offerSubmitFinalResponse,
    isMultiCharacter: params.isMultiCharacter,
    helpToolsEnabled,
    canDressThemselves,
    canCreateOutfits,
    canManageInventory,
    docToolsMode: documentEditingEnabled ? 'full' : 'off',
    askCarinaEnabled,
    customToolContext: customToolRosterFor(chat, userId, character, chatSettings),
    effectCeiling,
  }
  const built = await buildTools({ ...buildOptions, connectionProfile: profile })

  const primaryFormat = profileToolFormat(built, profile)
  const { resolvedToolMode, actualTools } = primaryFormat

  let toolInstructions: string | undefined
  if (resolvedToolMode === 'simple-json' || resolvedToolMode === 'text-block') {
    const textOptions = determineTextBlockToolOptions(
      imageProfileId,
      profile.allowWebSearch,
      params.isMultiCharacter,
      !!chat.projectId,
      helpToolsEnabled,
      canDressThemselves,
      canCreateOutfits,
      canManageInventory
    )
    if (resolvedToolMode === 'simple-json') {
      toolInstructions = buildSimpleJsonSystemInstructions(textOptions)
      logSimpleJsonToolUsage(profile.provider, profile.modelName, textOptions)
    } else {
      toolInstructions = buildTextBlockSystemInstructions(textOptions)
      logTextBlockToolUsage(profile.provider, profile.modelName, textOptions)
    }
  } else if (actualTools.length > 0) {
    toolInstructions = buildNativeToolSystemInstructions(characterKindPolicy(character).toolRules)
  }

  logger.debug('[TurnTools] Tool slate resolved', {
    chatId,
    characterId: character.id,
    toolCount: built.tools.length,
    resolvedToolMode,
    effectCeiling,
    toolSettingsChanged,
  })

  const formatToolsFor: FormatToolsFor = async (candidate) => {
    if (candidate.id === profile.id) return primaryFormat
    // The names the primary was offered. A stand-in never gets more: the
    // executor's permit and the system prompt's tool rules are the primary's.
    const offeredNames = new Set(built.tools.map(toolNameOf).filter((n): n is string => !!n))
    const candidateBuilt = await buildTools({ ...buildOptions, connectionProfile: candidate })
    const narrowed = {
      ...candidateBuilt,
      tools: candidateBuilt.tools.filter((tool) => {
        const name = toolNameOf(tool)
        return !name || offeredNames.has(name)
      }),
    }
    const format = profileToolFormat(narrowed, candidate)
    logger.debug('[TurnTools] Tools formatted for a substitute profile', {
      chatId,
      primaryProfileId: profile.id,
      primaryProvider: profile.provider,
      substituteProfileId: candidate.id,
      substituteProvider: candidate.provider,
      primaryMode: resolvedToolMode,
      substituteMode: format.resolvedToolMode,
      toolCount: format.actualTools.length,
    })
    return format
  }

  return {
    ...primaryFormat,
    tools: built.tools,
    toolInstructions,
    formatToolsFor,
    effectCeiling,
    customToolEffects: built.customToolEffects,
    pluginToolEffects: built.pluginToolEffects,
    toolOffer: built.offer,
    toolSettingsChanged,
  }
}

/**
 * One profile's tool format from a built tool list: its resolved tool mode,
 * the tools sent natively (none under a text protocol) and the stop sequences
 * the mode needs. simple-json hard-cuts the model at the closing
 * `</tool_call>` tag, on the primary stream and on every continuation.
 */
function profileToolFormat(
  built: { tools: unknown[]; modelSupportsNativeTools: boolean; useNativeWebSearch: boolean },
  profile: ConnectionProfile,
): ProfileToolFormat {
  const profilePseudoToolMode = (profile as { pseudoToolMode?: PseudoToolMode }).pseudoToolMode
  const resolvedToolMode = checkResolvedToolMode(built.modelSupportsNativeTools, profilePseudoToolMode)
  const useTextBlockTools = resolvedToolMode !== 'native'
  return {
    actualTools: useTextBlockTools ? [] : built.tools,
    resolvedToolMode,
    useTextBlockTools,
    useNativeWebSearch: built.useNativeWebSearch,
    stopSequences: resolvedToolMode === 'simple-json' ? SIMPLE_JSON_STOP : undefined,
  }
}

/**
 * The turn's effect ceiling. A storyteller turn starts at its bid's tier. In
 * an autonomous room (4.6 Private Character Rooms) the user-level
 * `destructiveToolPolicy` is a CEILING over the room's own
 * `runDestructiveToolsAllowed`: without both, `destroy` tools are withheld from
 * the list, and the executor refuses one regardless.
 */
export function resolveTurnEffectCeiling(
  chat: Pick<ChatMetadataBase, 'id' | 'chatType'>,
  chatSettings: Pick<ChatSettings, 'autonomousRoomSettings'> | null,
  storytellerCeiling: ToolEffect | undefined
): ToolEffect | undefined {
  if (chat.chatType !== 'autonomous') return storytellerCeiling

  const policy = chatSettings?.autonomousRoomSettings?.destructiveToolPolicy ?? 'opt_in_per_room'
  const allowedAtRoom = (chat as { runDestructiveToolsAllowed?: number }).runDestructiveToolsAllowed === 1
  if (policy !== 'always_refuse' && allowedAtRoom) return storytellerCeiling

  logger.debug('Autonomous room: destructive tools withheld by effect ceiling', {
    chatId: chat.id,
    policy,
    allowedAtRoom,
  })
  return lowerToolEffect(storytellerCeiling, 'write')
}

/** The full `doc_*` family is offered when the chat's project has linked stores. */
async function projectHasLinkedStores(
  repos: ReturnType<typeof getRepositories>,
  chat: Pick<ChatMetadataBase, 'id' | 'projectId'>
): Promise<boolean> {
  if (!chat.projectId) return false
  try {
    const mountLinks = await repos.projectDocMountLinks.findByProjectId(chat.projectId)
    return mountLinks.length > 0
  } catch (error) {
    logger.warn('Failed to read project store links; doc tools withheld', {
      chatId: chat.id,
      projectId: chat.projectId,
      error: error instanceof Error ? error.message : String(error),
    })
    return false
  }
}

/**
 * `ask_carina` is offered when at least one answerer (a character with
 * canBeCarina) exists, or when the acting character is `systemTransparency` —
 * such a character can reach the Brahma Console pseudocharacter as an answerer
 * even with no other present. Uses the overlay-free raw read (canBeCarina is a
 * DB column, not a vault field) to keep this per-turn check cheap.
 */
async function isAskCarinaOffered(
  repos: ReturnType<typeof getRepositories>,
  chatId: string,
  characterIsTransparent: boolean
): Promise<boolean> {
  if (characterIsTransparent) return true
  try {
    const rawCharacters = await repos.characters.findAllRaw()
    return rawCharacters.some(c => !c.archivedAt && c.canBeCarina === true)
  } catch (error) {
    logger.warn('Failed to probe for Carina answerers; ask_carina tool withheld', {
      chatId,
      error: error instanceof Error ? error.message : String(error),
    })
    return false
  }
}

/**
 * Pascal's custom pseudo-tools (`run_custom`). The roster's perspective is the
 * RESPONDING character's, because a character-tier store shadows the farther
 * tiers — two characters in one room can hold different definitions of the
 * same tool name. `characterId` is REQUIRED (the group tier is keyed on the
 * character's own group memberships and silently resolves to [] without it);
 * `characterMountPointId` is merely the fast path to their vault. Withholding
 * the context entirely is how the chat-level setting turns the feature off.
 */
function customToolRosterFor(
  chat: Pick<ChatMetadataBase, 'id' | 'projectId'>,
  userId: string,
  character: Character,
  chatSettings: Pick<ChatSettings, 'customTools'> | null
): CustomToolRosterContext | null {
  if (chatSettings?.customTools === false) return null
  return {
    userId,
    chatId: chat.id,
    characterId: character.id ?? null,
    characterMountPointId: character.characterDocumentMountPointId ?? null,
    projectId: chat.projectId ?? null,
    // The fact sheet availability gates are answered against; already
    // hydrated by the participant resolver, so this costs nothing.
    metadata: character.metadata ?? null,
  }
}

/**
 * The context the turn's tool calls execute under. Memories loaded into the
 * prompt are forwarded so introspection tools (self_inventory) report the
 * exact slate the model saw; the live-surface callbacks put a Carina answer or
 * a Pascal outcome on screen the instant it posts.
 */
export function buildTurnToolContext(params: {
  chat: Pick<ChatMetadataBase, 'id' | 'projectId' | 'participants'>
  userId: string
  character: Character
  characterParticipant: ChatParticipantBase
  imageProfileId: string | null
  browserUserAgent?: string
  builtContext: Pick<BuiltContext, 'debugMemories' | 'debugInterCharacterMemories' | 'debugMemoryRecap'>
  slate: Pick<TurnToolSlate, 'customToolEffects' | 'pluginToolEffects' | 'effectCeiling' | 'toolOffer'>
  emitCarinaAnswer: (message: MessageEvent) => void
  emitPascalResult: (message: MessageEvent) => void
}): ToolExecutionContext {
  const { chat, character, slate } = params
  const toolContext = createToolContext(
    chat.id,
    params.userId,
    character.id,
    params.characterParticipant.id,
    params.imageProfileId,
    undefined, // embeddingProfileId: always use default embedding profile
    chat.projectId,
    params.browserUserAgent,
    {
      semantic: params.builtContext.debugMemories,
      interCharacter: params.builtContext.debugInterCharacterMemories,
      recap: params.builtContext.debugMemoryRecap,
    },
  )
  toolContext.emitCarinaAnswer = params.emitCarinaAnswer
  toolContext.emitPascalResult = params.emitPascalResult
  // `run_custom`'s tiered mount pool needs the perspective the roster was built
  // from, or the model would be offered a tool the executor cannot find: the
  // vault fast path, plus the peers whose vaults form the 'participant' tier.
  toolContext.characterMountPointId = character.characterDocumentMountPointId ?? null
  toolContext.characterIds = chat.participants
    .filter(p => p.type === 'CHARACTER' && p.characterId)
    .map(p => p.characterId as string)
  // The effect ceiling travels with the context; the executor is where it bites.
  toolContext.customToolEffects = slate.customToolEffects
  toolContext.pluginToolEffects = slate.pluginToolEffects
  if (slate.effectCeiling) toolContext.effectCeiling = slate.effectCeiling
  // The executor admits only the tools this seat was offered.
  toolContext.toolOffer = slate.toolOffer
  return toolContext
}

export type TurnTextToolPassesOptions = Omit<
  RunTextToolPassOptions,
  'strategy' | 'continuationTools' | 'continuationUseNativeWebSearch'
> & {
  /** The turn's resolved tool mode (`TurnToolSlate.resolvedToolMode`). */
  resolvedToolMode: 'native' | 'simple-json' | 'text-block'
  /** The model calls tools through a text protocol rather than natively. */
  useTextBlockTools: boolean
  /** The tools sent natively this turn. */
  actualTools: unknown[]
  useNativeWebSearch: boolean
}

/** Text-block and provider-marker results are framed the same way. */
const formatBracketedToolResult = (toolName: string, content: string) => `[Tool Result: ${toolName}]\n${content}`

/**
 * Both text passes a Salon turn runs after its native tool loop, in order:
 *
 *   1. provider-native text markers — spontaneous XML emissions such as
 *      DeepSeek's `<function_calls>` or Gemini's `<tool_use>`, which only the
 *      provider plugin can recognise (skipped when the plugin has no detector);
 *   2. the prompt-taught protocol — simple-json `<tool_call>{…}</tool_call>`
 *      when that is the turn's mode, otherwise legacy text-block
 *      `[[TOOL …]]…[[/TOOL]]` (a no-op on native turns, which emit none).
 *
 * Under a text protocol the second continuation offers no native tools and no
 * native web search, so the model cannot re-emit the markers just stripped.
 */
export async function runTurnTextToolPasses(opts: TurnTextToolPassesOptions): Promise<void> {
  const { resolvedToolMode, useTextBlockTools, ...rest } = opts
  // A failover stand-in continues on its own tools, messages and params (A15).
  // Its tool mode is the turn's: one in another mode is never called.
  const { actualTools, useNativeWebSearch, formattedMessages, modelParams } = effectiveToolLoopCall(opts)
  const shared = { ...rest, formattedMessages, modelParams }

  const plugin = getProvider(opts.streaming.effectiveProfile.provider)
  if (plugin?.hasTextToolMarkers && plugin.parseTextToolCalls && plugin.stripTextToolMarkers) {
    await runTextToolPass({
      ...shared,
      strategy: {
        name: 'provider-text-markers',
        hasMarkers: plugin.hasTextToolMarkers,
        parse: plugin.parseTextToolCalls,
        strip: plugin.stripTextToolMarkers,
        formatToolResult: formatBracketedToolResult,
      },
      continuationTools: actualTools,
      continuationUseNativeWebSearch: useNativeWebSearch,
    })
  }

  const strategy: TextToolStrategy = resolvedToolMode === 'simple-json'
    ? {
        name: 'simple-json',
        hasMarkers: hasSimpleJsonInResponse,
        parse: (response) => parseSimpleJsonFromResponse(response, {
          provider: opts.streaming.effectiveProfile.provider,
          model: opts.streaming.effectiveProfile.modelName,
        }),
        strip: stripSimpleJsonFromResponse,
        formatToolResult: formatSimpleJsonToolResult,
        stopSequences: SIMPLE_JSON_STOP,
      }
    : {
        name: 'text-block',
        hasMarkers: hasTextBlockMarkers,
        parse: parseTextBlocksFromResponse,
        strip: stripTextBlockMarkersFromResponse,
        formatToolResult: formatBracketedToolResult,
      }

  await runTextToolPass({
    ...shared,
    strategy,
    continuationTools: useTextBlockTools ? [] : actualTools,
    continuationUseNativeWebSearch: useNativeWebSearch && !useTextBlockTools,
  })
}
