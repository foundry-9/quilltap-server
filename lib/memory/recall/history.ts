/**
 * Commonplace Book recall anti-repetition ring buffer.
 *
 * Persisted per-chat in `chats.commonplaceRecallHistory` as a JSON object
 * `{ byCharacter: { [characterId]: string[][] } }` — for each character, one
 * inner array of whispered memory IDs per recent turn of theirs, most recent
 * last, capped to {@link RECALL_HISTORY_TURNS}. (Wrapped in an object rather
 * than a bare array so it stays a plain JSON record column like
 * `commonplaceSceneCache`, not an auto-detected SQLite "array column".)
 *
 * One ring per character, not one per chat (A14): with a single three-slot
 * list shared by the room, four or more characters pushed each other's heads
 * out before anyone spoke again, so `recentlyWhispered` never fired. A chat
 * written before 4.13 carries one shared `turns` list; it is read for a
 * character with no ring of its own yet and dropped at the next write. Memory
 * ids belong to one holder, so the shared list never penalised the wrong
 * character's memories — it only aged out too fast.
 *
 * The recall path unions a character's IDs into a "recently whispered" set and
 * applies a bounded penalty (see lib/memory/recall/tags.ts `recentlyWhispered`)
 * so the same memory doesn't get whispered turn after turn and read as a stuck
 * record.
 *
 * Ephemeral UX state — NOT part of .qtap export. Written only by
 * `deliverRecall`.
 */

/** How many of one character's recent whisper-turns to remember for anti-repetition. */
export const RECALL_HISTORY_TURNS = 3

/** Most characters whose rings one chat keeps; the least recently written is dropped. */
export const RECALL_HISTORY_MAX_CHARACTERS = 32

/**
 * How many recent retrospective mini-recap signatures to remember (spam
 * guard): a mini-recap with the same timeRange/entity signature within this
 * many emissions is skipped.
 */
export const RETRO_SIGNATURE_TURNS = 3

/** Persisted shape of the recall-history column. */
export interface RecallHistory {
  /** Per character: one inner array of whispered memory IDs per recent turn, most recent last. */
  byCharacter?: Record<string, string[][]>
  /** Pre-4.13 shared ring. Read only as a fallback; never written. */
  turns?: string[][]
  /**
   * Signatures (hashes of timeRange+entities) of recently-emitted
   * retrospective mini-recaps, most recent last, capped to
   * {@link RETRO_SIGNATURE_TURNS}. Spam guard for the fourth cadence.
   */
  retroSignatures?: string[]
}

function cleanTurns(turns: unknown): string[][] {
  if (!Array.isArray(turns)) return []
  return (turns as unknown[])
    .filter((turn): turn is unknown[] => Array.isArray(turn))
    .map(turn => turn.filter((id): id is string => typeof id === 'string' && id.length > 0))
}

function parseByCharacter(raw: unknown): Record<string, string[][]> {
  const by =
    raw && typeof raw === 'object' && 'byCharacter' in raw
      ? (raw as { byCharacter: unknown }).byCharacter
      : undefined
  if (!by || typeof by !== 'object' || Array.isArray(by)) return {}
  const out: Record<string, string[][]> = {}
  for (const [characterId, turns] of Object.entries(by as Record<string, unknown>)) {
    if (!characterId) continue
    out[characterId] = cleanTurns(turns)
  }
  return out
}

/**
 * One character's ring as a clean `string[][]`, dropping anything malformed:
 * their own when the chat has one, else the pre-4.13 shared list.
 */
export function parseRecallHistory(raw: unknown, characterId: string): string[][] {
  const own = parseByCharacter(raw)
  if (Object.hasOwn(own, characterId)) return own[characterId]
  const legacy =
    raw && typeof raw === 'object' && 'turns' in raw ? (raw as { turns: unknown }).turns : undefined
  return cleanTurns(legacy)
}

/** Union of one character's memory IDs across their retained recent turns. */
export function recentlyWhisperedIdSet(raw: unknown, characterId: string): ReadonlySet<string> {
  const set = new Set<string>()
  for (const turn of parseRecallHistory(raw, characterId)) {
    for (const id of turn) set.add(id)
  }
  return set
}

/** Coerce the persisted retro-signature list, dropping anything malformed. */
export function parseRetroSignatures(raw: unknown): string[] {
  const sigs =
    raw && typeof raw === 'object' && 'retroSignatures' in raw
      ? (raw as { retroSignatures: unknown }).retroSignatures
      : undefined
  if (!Array.isArray(sigs)) return []
  return (sigs as unknown[]).filter(
    (s): s is string => typeof s === 'string' && s.length > 0,
  )
}

/**
 * Append one character's whispered IDs for this turn and trim their ring to
 * the last {@link RECALL_HISTORY_TURNS}. Other characters' rings are kept.
 * Empty turns are not recorded — the buffer tracks recent *whispers*, not
 * silence, so a gap turn doesn't prematurely age a still-recent memory out of
 * the penalty. The retro-signature list is carried forward unchanged (see
 * {@link appendRetroSignature}); the pre-4.13 shared list is dropped once a
 * ring is written.
 */
export function appendRecallTurn(raw: unknown, characterId: string, newIds: readonly string[]): RecallHistory {
  const byCharacter = parseByCharacter(raw)
  const retroSignatures = parseRetroSignatures(raw)
  const legacy = raw && typeof raw === 'object' && 'turns' in raw ? cleanTurns((raw as { turns: unknown }).turns) : []
  const base = (rings: Record<string, string[][]>, keepLegacy: boolean): RecallHistory => ({
    ...(Object.keys(rings).length > 0 ? { byCharacter: rings } : {}),
    ...(keepLegacy && legacy.length > 0 ? { turns: legacy } : {}),
    ...(retroSignatures.length > 0 ? { retroSignatures } : {}),
  })
  if (newIds.length === 0) return base(byCharacter, true)
  const prior = parseRecallHistory(raw, characterId)
  // Re-insert so the most recently written ring is last; the oldest go first.
  const next: Record<string, string[][]> = {}
  for (const [id, turns] of Object.entries(byCharacter)) if (id !== characterId) next[id] = turns
  next[characterId] = [...prior, [...new Set(newIds)]].slice(-RECALL_HISTORY_TURNS)
  const ids = Object.keys(next)
  for (const id of ids.slice(0, Math.max(0, ids.length - RECALL_HISTORY_MAX_CHARACTERS))) delete next[id]
  return base(next, false)
}

/**
 * Record a just-emitted retrospective mini-recap signature on an
 * already-parsed history, trimming to {@link RETRO_SIGNATURE_TURNS}.
 */
export function appendRetroSignature(history: RecallHistory, signature: string): RecallHistory {
  if (!signature) return history
  const sigs = [...(history.retroSignatures ?? []), signature].slice(-RETRO_SIGNATURE_TURNS)
  return { ...history, retroSignatures: sigs }
}
