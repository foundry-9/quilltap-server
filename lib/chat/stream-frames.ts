/**
 * Salon stream frames — the one definition of what a Salon turn's SSE stream
 * carries.
 *
 * A Salon turn (send, continue, nudge, Storyteller run, swipe regeneration)
 * streams to the browser as Server-Sent Events. Each `data:` line is one
 * **frame**: a member of the tagged union below, discriminated on `kind`. The
 * server produces bytes only through `encodeFrame`; the client reads them only
 * through `parseFrame`, and dispatches with an exhaustive `switch (frame.kind)`,
 * so a new kind is a compile error until every consumer handles or ignores it,
 * and no ordering of tests decides what a frame means.
 *
 * Two consolidations over the old untagged bag:
 *
 * - `done.outcome` is one value — `finished`, `skipped` (a "nothing to add"
 *   pass), `yielded` (a bare yield to the raised hand), `stopped` (the operator
 *   hard-stopped the turn before any prose) or `empty` (the provider returned
 *   nothing) — instead of five boolean side flags.
 * - `posted` is the one frame for "here is a full message the server has
 *   already saved" (a Carina answer, a Host announcement, a Pascal outcome),
 *   which the client inserts identically; `what` says which.
 *
 * Storyteller "all at once" turns share one stream; each of their frames
 * carries a `seat` (`tagFrame`). The tag is put on the frame before it is
 * encoded — by an encoder made with `seatedFrameEncoder` — never by re-reading
 * bytes.
 *
 * The other SSE routes (help chat, the Brahma console, the Scenario Builder,
 * the one-shot tool loop) share some of the Salon's server helpers but keep
 * their older untagged-bag wire shape; they write through an encoder made with
 * `legacyFrameEncoder`, which `encodeFrame` renders with `toLegacyBag`.
 *
 * Client-safe: Zod and types only.
 *
 * Design of record: docs/developer/features/refactor-4-12-salon-stream-frames.md
 */

import { z } from 'zod'
import { logger } from '@/lib/logger'
import type { MessageEvent } from '@/lib/schemas/types'
import type { RouteAttempt } from '@/lib/schemas/chat.types'
import type { StorytellerBid, StorytellerRound } from '@/lib/schemas/storyteller.types'

// ---------------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------------

/** A non-null object; the nested payloads below are typed, not re-validated. */
const isObject = (v: unknown): boolean => typeof v === 'object' && v !== null && !Array.isArray(v)

/** A full chat message the server has already persisted. */
export type PostedMessage = MessageEvent
const PostedMessageSchema = z.custom<PostedMessage>(
  (v) => isObject(v) && typeof (v as { id?: unknown }).id === 'string',
  { message: 'Expected a persisted message with an id' },
)

/** A concurrent Storyteller seat: which participant's turn wrote this frame. */
export const SeatTagSchema = z.object({
  participantId: z.string(),
  concurrent: z.literal(true),
})
export type SeatTag = z.infer<typeof SeatTagSchema>

/** The status line shown above the composer while a reply is prepared. */
export const ResponseStatusSchema = z.object({
  stage: z.string(),
  message: z.string(),
  toolName: z.string().optional(),
  characterName: z.string().optional(),
  characterId: z.string().optional(),
})
export type ResponseStatus = z.infer<typeof ResponseStatusSchema>

const UsageSchema = z.object({
  promptTokens: z.number().optional(),
  completionTokens: z.number().optional(),
  totalTokens: z.number().optional(),
})

const CacheUsageSchema = z.object({
  cacheCreationInputTokens: z.number().optional(),
  cacheReadInputTokens: z.number().optional(),
})

/** What the provider plugin managed to put on the wire (bug 94). */
const AttachmentResultsSchema = z.object({
  sent: z.array(z.string()),
  failed: z.array(z.object({ id: z.string(), error: z.string() })),
})

/** A positioned reasoning block — DISPLAY ONLY. */
const ReasoningSegmentSchema = z.object({
  anchorOffset: z.number(),
  content: z.string(),
  seq: z.number(),
})

const TurnInfoSchema = z.object({
  nextSpeakerId: z.string().nullable(),
  reason: z.string(),
  cycleComplete: z.boolean(),
  isUsersTurn: z.boolean(),
})

/** How a `done` frame closed its turn. */
export const DoneOutcomeSchema = z.enum(['finished', 'skipped', 'yielded', 'stopped', 'empty'])
export type DoneOutcome = z.infer<typeof DoneOutcomeSchema>

/** Why a chain stopped. */
export const ChainCompleteReasonSchema = z.enum([
  'user_turn', 'paused', 'max_depth', 'max_time', 'error', 'no_next_speaker',
  'cycle_complete', 'yielded', 'stopped', 'round_open', 'turn_complete',
])
export type ChainCompleteReason = z.infer<typeof ChainCompleteReasonSchema>

/** One attachment the file-fallback pipeline processed before the turn. */
const FileProcessingInfoSchema = z.object({
  filename: z.string(),
  type: z.string(),
  usedImageDescriptionLLM: z.boolean(),
  error: z.string().optional(),
})

/** Every variant may carry a seat tag (concurrent Storyteller turns). */
const seat = { seat: SeatTagSchema.optional() }

// ---------------------------------------------------------------------------
// The union
// ---------------------------------------------------------------------------

export const StreamFrameSchema = z.discriminatedUnion('kind', [
  /** A delta of the reply's prose — appended. */
  z.object({ kind: z.literal('content'), text: z.string(), ...seat }),
  /** The reasoning ("thinking") so far — CUMULATIVE, replaces; DISPLAY ONLY. */
  z.object({ kind: z.literal('reasoning'), text: z.string(), ...seat }),
  /** A status line for the composer. */
  z.object({ kind: z.literal('status'), status: ResponseStatusSchema, ...seat }),
  /** Attachments the fallback pipeline described or converted. */
  z.object({ kind: z.literal('fileProcessing'), info: z.array(FileProcessingInfoSchema), ...seat }),
  /** A batch of tool calls the model just made. */
  z.object({
    kind: z.literal('toolsDetected'),
    names: z.array(z.string()),
    arguments: z.array(z.record(z.string(), z.unknown())),
    ...seat,
  }),
  /**
   * One tool call's result. On failure `error` carries the human-readable text
   * (the same string persisted as the tool row's content); `result` is usually
   * null then.
   */
  z.object({
    kind: z.literal('toolResult'),
    index: z.number().optional(),
    name: z.string(),
    success: z.boolean(),
    result: z.unknown().optional(),
    error: z.string().optional(),
    ...seat,
  }),
  /**
   * A character is about to respond. Depth 0 precedes every first turn (so the
   * bubble names the right responder); depth ≥ 1 is a chained turn.
   */
  z.object({
    kind: z.literal('turnStart'),
    participantId: z.string(),
    characterName: z.string(),
    chainDepth: z.number(),
    ...seat,
  }),
  /** A turn closed. Exactly one per turn that reached the settle step. */
  z.object({
    kind: z.literal('done'),
    outcome: DoneOutcomeSchema,
    messageId: z.string().nullable(),
    participantId: z.string().nullable().optional(),
    usage: UsageSchema.nullable(),
    cacheUsage: CacheUsageSchema.nullable(),
    attachmentResults: AttachmentResultsSchema.nullable(),
    toolsExecuted: z.boolean(),
    turn: TurnInfoSchema.optional(),
    /** `outcome: 'empty'` — why the provider returned nothing, in words. */
    emptyResponseReason: z.string().optional(),
    /** `outcome: 'skipped' | 'yielded'` — the seat that passed or yielded. */
    skippedParticipantId: z.string().nullable().optional(),
    provider: z.string().optional(),
    modelName: z.string().optional(),
    /** Every profile tried, in order. Null (the common case) when nothing failed. */
    routeTrail: z.array(z.custom<RouteAttempt>(isObject)).nullable().optional(),
    isSilentMessage: z.boolean().optional(),
    /**
     * The Courier: this closes a parked placeholder turn, not a streamed reply.
     * The client skips its optimistic push and refetches instead.
     */
    pendingExternalTurn: z.boolean().optional(),
    /** Full reasoning text — DISPLAY ONLY, for the optimistic push. */
    reasoningContent: z.string().nullable().optional(),
    reasoningSegments: z.array(ReasoningSegmentSchema).nullable().optional(),
    ...seat,
  }),
  /** A chained turn finished (sent by the chain, after its `done`). */
  z.object({
    kind: z.literal('turnComplete'),
    participantId: z.string(),
    messageId: z.string(),
    chainDepth: z.number(),
    skipped: z.boolean().optional(),
    ...seat,
  }),
  /** The chain stopped; the stream ends after this. */
  z.object({
    kind: z.literal('chainComplete'),
    reason: ChainCompleteReasonSchema,
    nextSpeakerId: z.string().nullable(),
    chainDepth: z.number(),
    /**
     * The chat is (or was just) marked paused as part of this stop. `reason`
     * alone cannot say so (bug 123).
     */
    paused: z.boolean().optional(),
    /** The stop IS the user's own message: a paused room recorded it (bug 137). */
    heldUserTurn: z.boolean().optional(),
    ...seat,
  }),
  /** The turn failed after the stream opened. */
  z.object({
    kind: z.literal('error'),
    message: z.string(),
    errorType: z.string(),
    details: z.string(),
    /** Whether the user's message row was saved before the failure (bug 241). */
    userMessagePersisted: z.boolean().optional(),
    /** Whether the staged tool results were saved as TOOL rows. */
    pendingToolResultsPersisted: z.boolean().optional(),
    ...seat,
  }),
  /** The Courier parked a placeholder for a manual / clipboard turn. */
  z.object({
    kind: z.literal('pendingExternalTurn'),
    messageId: z.string(),
    participantId: z.string(),
    characterName: z.string(),
    ...seat,
  }),
  /**
   * A message the server already saved mid-turn, surfaced at once rather than
   * at the post-turn refresh. The client inserts it deduped by `id`.
   */
  z.object({
    kind: z.literal('posted'),
    what: z.enum(['carinaAnswer', 'hostAnnouncement', 'pascalResult']),
    message: PostedMessageSchema,
    ...seat,
  }),
  /** Storyteller: the round's board as it opened. */
  z.object({ kind: z.literal('storytellerRound'), round: z.custom<StorytellerRound>(isObject), ...seat }),
  /** Storyteller: one seat's bid landed (or failed, or passed). */
  z.object({
    kind: z.literal('storytellerBid'),
    roundId: z.string(),
    bid: z.custom<StorytellerBid>(isObject),
    ...seat,
  }),
  /** Storyteller: every bid is in; the choice is the operator's. */
  z.object({ kind: z.literal('roundOpen'), roundId: z.string(), ...seat }),
  /** The operator's raised hand was taken: this character is being asked. */
  z.object({
    kind: z.literal('handAsked'),
    participantId: z.string(),
    characterName: z.string(),
    ...seat,
  }),
  /** The asked character answered the raised hand: yielded or carried on. */
  z.object({
    kind: z.literal('handAnswered'),
    participantId: z.string(),
    characterName: z.string(),
    yielded: z.boolean(),
    ...seat,
  }),
  /**
   * The answer-confirmation check resolved for a just-streamed message.
   * `content` is present only when the re-affirmation rewrote the reply.
   */
  z.object({
    kind: z.literal('confirmationResult'),
    messageId: z.string(),
    confirmed: z.boolean().nullable(),
    revised: z.boolean(),
    notes: z.string().nullable(),
    content: z.string().optional(),
    ...seat,
  }),
  /** A swipe regeneration finished; `message` is the persisted swipe. */
  z.object({ kind: z.literal('swipeDone'), message: PostedMessageSchema, ...seat }),
])

export type StreamFrame = z.infer<typeof StreamFrameSchema>
export type StreamFrameKind = StreamFrame['kind']
/** The frame of one kind. */
export type FrameOf<K extends StreamFrameKind> = Extract<StreamFrame, { kind: K }>
export type DoneFrame = FrameOf<'done'>
export type ChainCompleteFrame = FrameOf<'chainComplete'>
export type ErrorFrame = FrameOf<'error'>
export type ConfirmationResultFrame = FrameOf<'confirmationResult'>
export type PostedFrame = FrameOf<'posted'>
export type ToolsDetectedFrame = FrameOf<'toolsDetected'>
export type ToolResultFrame = FrameOf<'toolResult'>

/** Exhaustiveness guard for `switch (frame.kind)` / `switch (outcome)`. */
export function assertNever(value: never): never {
  throw new Error(`Unhandled stream frame variant: ${JSON.stringify(value)}`)
}

/**
 * A `done` that leaves no bubble behind: a pass, a bare yield or a hard stop.
 * The client resets its buffer without appending a reply or toasting (the Host
 * note, where there is one, is the visible record).
 */
export function doneLeavesNoReply(outcome: DoneOutcome): boolean {
  switch (outcome) {
    case 'skipped':
    case 'yielded':
    case 'stopped':
      return true
    case 'finished':
    case 'empty':
      return false
    default:
      return assertNever(outcome)
  }
}

// ---------------------------------------------------------------------------
// Seats
// ---------------------------------------------------------------------------

/** Tag a frame as written by one concurrent Storyteller seat. */
export function tagFrame<F extends StreamFrame>(frame: F, participantId: string): F {
  return { ...frame, seat: { participantId, concurrent: true } }
}

// ---------------------------------------------------------------------------
// Encoding
// ---------------------------------------------------------------------------

/** How an encoder renders frames, and which seat (if any) it tags them with. */
interface EncoderProfile {
  dialect?: WireDialect
  seat?: string
}

type WireDialect = 'frames' | 'legacy'

/** What a plain `TextEncoder` renders. */
const DEFAULT_DIALECT: WireDialect = 'frames'

const ENCODER_PROFILES = new WeakMap<TextEncoder, EncoderProfile>()

/**
 * An encoder whose frames are tagged with a concurrent Storyteller seat. Every
 * frame one "all at once" turn writes goes through it, so the client can keep
 * one streaming bubble per participant.
 */
export function seatedFrameEncoder(participantId: string): TextEncoder {
  const encoder = new TextEncoder()
  ENCODER_PROFILES.set(encoder, { seat: participantId })
  return encoder
}

/**
 * An encoder that renders frames in the older untagged-bag shape, for the SSE
 * routes outside the Salon (help chat, the Brahma console, the Scenario
 * Builder) whose clients still read that shape. See `toLegacyBag`.
 */
export function legacyFrameEncoder(): TextEncoder {
  const encoder = new TextEncoder()
  ENCODER_PROFILES.set(encoder, { dialect: 'legacy' })
  return encoder
}

const validateFrames = process.env.NODE_ENV !== 'production'

/**
 * The only producer of `data: …\n\n` bytes on the Salon turn path. Validates
 * against the schema in development and test (a malformed frame is a server
 * bug, logged and still sent); production skips the check.
 */
export function encodeFrame(encoder: TextEncoder, frame: StreamFrame): Uint8Array {
  const profile = ENCODER_PROFILES.get(encoder)
  const tagged = profile?.seat ? tagFrame(frame, profile.seat) : frame
  if (validateFrames) {
    const checked = StreamFrameSchema.safeParse(tagged)
    if (!checked.success) {
      logger.error('[StreamFrames] Malformed frame emitted', {
        kind: (tagged as { kind?: unknown }).kind,
        issues: checked.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
      })
    }
  }
  const payload = (profile?.dialect ?? DEFAULT_DIALECT) === 'legacy' ? toLegacyBag(tagged) : tagged
  return encoder.encode(`data: ${JSON.stringify(payload)}\n\n`)
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

const reportedKinds = new Set<string>()

/**
 * The client's only parser for a Salon stream's `data:` payload. Returns null
 * for blank keep-alive payloads, chunking artefacts and anything that is not a
 * known frame — an unknown or malformed kind is logged once and ignored rather
 * than crashing a stream mid-turn.
 */
export function parseFrame(raw: string): StreamFrame | null {
  const trimmed = raw.trim()
  if (!trimmed || trimmed === '[DONE]' || trimmed === '{}') return null
  let json: unknown
  try {
    json = JSON.parse(trimmed)
  } catch {
    return null
  }
  const parsed = StreamFrameSchema.safeParse(json)
  if (parsed.success) return parsed.data
  const kind = isObject(json) ? String((json as { kind?: unknown }).kind) : typeof json
  if (!reportedKinds.has(kind)) {
    reportedKinds.add(kind)
    logger.warn('[StreamFrames] Ignoring an unrecognised stream frame', {
      kind,
      issues: parsed.error.issues.slice(0, 3).map((i) => `${i.path.join('.')}: ${i.message}`),
    })
  }
  return null
}

// ---------------------------------------------------------------------------
// The older wire shape
// ---------------------------------------------------------------------------

/**
 * Render a frame in the untagged-bag shape the Salon used before 4.12 — one
 * object whose flags (`done: true`, `turnStart: true`, …) said what it was.
 * The non-Salon SSE routes still speak it (`legacyFrameEncoder`).
 */
export function toLegacyBag(frame: StreamFrame): Record<string, unknown> {
  const bag = legacyBagOf(frame)
  if (frame.seat) {
    return { ...bag, participantId: bag.participantId ?? frame.seat.participantId, concurrent: true }
  }
  return bag
}

function legacyBagOf(frame: StreamFrame): Record<string, unknown> {
  switch (frame.kind) {
    case 'content': return { content: frame.text }
    case 'reasoning': return { reasoning: frame.text }
    case 'status': return { status: frame.status }
    case 'fileProcessing': return { fileProcessing: frame.info }
    case 'toolsDetected':
      return { toolsDetected: frame.names.length, toolNames: frame.names, toolArguments: frame.arguments }
    case 'toolResult': {
      const { kind: _kind, seat: _seat, ...toolResult } = frame
      return { toolResult }
    }
    case 'turnStart': {
      const { kind: _kind, seat: _seat, ...rest } = frame
      return { turnStart: true, ...rest }
    }
    case 'done': {
      const { kind: _kind, seat: _seat, outcome, ...rest } = frame
      return { done: true, ...rest, ...legacyOutcomeFlags(outcome) }
    }
    case 'turnComplete': {
      const { kind: _kind, seat: _seat, ...rest } = frame
      return { turnComplete: true, ...rest }
    }
    case 'chainComplete': {
      const { kind: _kind, seat: _seat, ...rest } = frame
      return { chainComplete: true, ...rest }
    }
    case 'error': {
      const { kind: _kind, seat: _seat, message, ...rest } = frame
      return { error: message, ...rest }
    }
    case 'pendingExternalTurn': {
      const { kind: _kind, seat: _seat, ...rest } = frame
      return { pendingExternalTurn: true, ...rest }
    }
    case 'posted': return { [frame.what]: frame.message }
    case 'storytellerRound': return { storytellerRound: frame.round }
    case 'storytellerBid': return { storytellerBid: { roundId: frame.roundId, bid: frame.bid } }
    case 'roundOpen': return { roundOpen: true, roundId: frame.roundId }
    case 'handAsked': {
      const { kind: _kind, seat: _seat, ...rest } = frame
      return { handAsked: true, ...rest }
    }
    case 'handAnswered': {
      const { kind: _kind, seat: _seat, ...rest } = frame
      return { handAnswered: true, ...rest }
    }
    case 'confirmationResult': {
      const { kind: _kind, seat: _seat, ...confirmationResult } = frame
      return { confirmationResult }
    }
    case 'swipeDone': return { done: true, message: frame.message }
    default: return assertNever(frame)
  }
}

function legacyOutcomeFlags(outcome: DoneOutcome): Record<string, true> {
  switch (outcome) {
    case 'finished': return {}
    case 'skipped': return { skipped: true }
    case 'yielded': return { skipped: true, yielded: true }
    case 'stopped': return { stopped: true }
    case 'empty': return { emptyResponse: true }
    default: return assertNever(outcome)
  }
}
