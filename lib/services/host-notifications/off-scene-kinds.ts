/**
 * The Host's off-scene message kinds, and which of them reach a model.
 *
 * Kept apart from `writer.ts` so the history filters (`buildMessageContext`,
 * `extractVisibleConversation`) can ask the question without importing the
 * writer and everything it pulls in.
 */

/** A "spoken of" introduction: posted the first time an absent character is named. */
export const HOST_KIND_OFF_SCENE_CHARACTERS = 'off-scene-characters'

/**
 * A left-behind notice (Continue Elsewhere). Its own kind because, unlike a
 * "spoken of" introduction, it stays in the model's history: it marks where the
 * old company split, at the tail of the carried-over transcript (bug 171).
 * Notices posted before this kind existed carry `off-scene-characters` and are
 * told apart by {@link LEFT_BEHIND_INTRO_PREFIX}.
 */
export const HOST_KIND_OFF_SCENE_LEFT_BEHIND = 'off-scene-left-behind'

/** How every left-behind notice opens; the legacy rows' only distinguishing mark. */
export const LEFT_BEHIND_INTRO_PREFIX = 'The Host observes that'

/**
 * True for a Host "spoken of" introduction. The Salon shows it, but it is a
 * record only: the model hears about absent people from the referent ledger's
 * trailing section on every turn they are named
 * (`lib/chat/context/referent-ledger.ts`), not from a card wedged into the
 * history where it can sever a line from the reply that leans on it.
 * Left-behind notices are not records; they stay in the history.
 */
export function isOffSceneMentionIntroduction(
  m: { systemSender?: string | null; systemKind?: string | null; content?: string | null },
): boolean {
  return (
    m.systemSender === 'host' &&
    m.systemKind === HOST_KIND_OFF_SCENE_CHARACTERS &&
    !(m.content ?? '').startsWith(LEFT_BEHIND_INTRO_PREFIX)
  )
}
