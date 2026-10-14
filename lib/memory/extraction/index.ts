/**
 * Extraction: one context, four passes, cursors (memory refactor §3.7).
 *
 *  - `buildExtractionContext` — once per unit of work.
 *  - `runPass` — the one way model output becomes memories.
 *  - `runTurnExtraction` / `runCarinaExtraction` — the turn grain.
 *  - `runFoldPass` / `runFoldCatchup` — the fold grain, on cursors.
 *  - `runExtractionDryRun` — the same pipeline, writing nothing.
 *
 * @module memory/extraction
 */

export {
  buildExtractionContext,
  clockAt,
  pickExtractionConnectionProfileId,
  ExtractionContextError,
  type BuildExtractionContextOptions,
  type CastMember,
  type ExtractionContext,
} from './context'
export { resolveExtractionRoute, type ExtractionRoute } from './route'
export { createRateLimiter, rateLimitDecision, applyImportanceFloor, type RateLimiter, type RateLimitDecision } from './rate-limit'
export { liveCursorStore, memoryCursorStore, type CursorStore, type ExtractionCursor } from './cursors'
export {
  runPass,
  emptyPassResult,
  mergePassResult,
  type AdmittedCandidate,
  type DraftBatch,
  type ExtractionPass,
  type ExtractionPassName,
  type PassCall,
  type PassResult,
} from './run'
export { selfTurnPass } from './passes/self-turn'
export { otherTurnPass } from './passes/other-turn'
export { otherFoldPass } from './passes/other-fold'
export { episodeFoldPass, MAX_FRAGMENT_LINKS } from './passes/episode-fold'
export {
  runTurnExtraction,
  runTurnPasses,
  runCarinaExtraction,
  carinaTranscript,
  turnTranscriptFor,
  type TurnExtractionResult,
  type TurnLocator,
} from './turn'
export { runFoldPass, FOLD_MAX_WINDOW_MESSAGES, FOLD_MAX_SLICES_PER_JOB, type FoldResult, type RunFoldInput } from './fold'
export {
  runFoldCatchup,
  findFoldCatchupCandidates,
  idleChatsForCatchup,
  isChatActiveForCatchup,
  foldEndIndex,
  isEpisodeBacklogBehind,
  isEpisodeBacklogBehindByAnchors,
  FOLD_CATCHUP_IDLE_MS,
  FOLD_CATCHUP_LOOKBACK_MS,
  FOLD_CATCHUP_MAX_CHATS,
  type FoldCatchupCandidate,
  type FoldCatchupSelection,
} from './catchup'
export { runExtractionDryRun, toExtractedCandidate, type DryRunHooks, type ExtractedCandidate } from './dry-run'
export {
  HARD_CANDIDATE_CAP,
  EVENT_EXTRA_SLOT,
  EPISODE_TARGETING,
  passCap,
  capWithEventSlot,
  coerceMemoryDraft,
  parseSelfDrafts,
  parseOtherDraftsBySubject,
  parseEpisodeDrafts,
} from './parse'
export {
  isFoldEligibleMessage,
  messagesPastCursor,
  foldPassRange,
  sliceFoldWindow,
  stretchWindow,
  turnWindow,
  renderStretch,
  renderTurnContext,
  ORDERED_TURN_TRANSCRIPT_HEADING,
  STRETCH_MESSAGE_CHAR_CAP,
  type StretchMessage,
  type TranscriptWindow,
} from './window'
export { buildSelfTurnMessages, type SelfTurnPromptInput } from './prompts/self'
export { buildOtherTurnMessages, buildOtherFoldMessages, type OtherPromptInput, type OtherSubjectInput } from './prompts/other'
export { buildEpisodeFoldMessages, FOLD_EPISODE_CAP } from './prompts/episode'
export type { ExtractionClock, OrientingContext } from './prompts/shared'
export {
  BUNDLE_CURSOR_FIELDS,
  withBundleCursorFields,
  takeBundleCursors,
  restoreBundleCursors,
  type BundleCursorFields,
} from './cursor-bundle'
