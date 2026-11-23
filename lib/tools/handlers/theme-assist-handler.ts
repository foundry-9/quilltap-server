/**
 * Calliope's tool handlers (Calliope Live, Spec J §2.2).
 *
 *   - `theme_read_draft`     — the draft, rendered.
 *   - `theme_lookup_tokens`  — registry tokens with the draft's values.
 *   - `theme_lookup_hooks`   — catalogued hooks with what styles them.
 *   - `theme_check_contrast` — a pair's contrast against the draft.
 *   - `theme_propose`        — a change set judged against the draft.
 *
 * Every one of them answers only inside a Calliope conversation that names
 * its draft (`chatType: 'calliope'`, `themeDraftId`): the draft is read fresh
 * through `lib/themes/drafts/` on each call, and nothing here writes to it.
 * The text each returns is rendered by `lib/themes/assist/` — no model-facing
 * text is assembled here.
 *
 * Errors are returned as data (`{ success: false, error }`), never thrown, so
 * the model can read the message and adjust.
 *
 * @module tools/handlers/theme-assist-handler
 */

import { createServiceLogger } from '@/lib/logging/create-logger'
import { getRepositories } from '@/lib/repositories/factory'
import { readDraft, ThemeDraftNotFoundError, type DraftDetail } from '@/lib/themes/drafts'
import {
  assessProposal,
  assistDraftFrom,
  checkDraftContrast,
  lookupHooks,
  lookupTokens,
  renderContrastCheck,
  renderDraft,
  renderHookLookup,
  renderProposalAssessment,
  renderTokenLookup,
} from '@/lib/themes/assist'
import type { TokenType } from '@/lib/themes/engine/client'
import type { HookSurface } from '@/lib/themes/hooks/types'
import { themeReadDraftToolInputSchema } from '../theme-read-draft-tool'
import { themeLookupTokensToolInputSchema } from '../theme-lookup-tokens-tool'
import { themeLookupHooksToolInputSchema } from '../theme-lookup-hooks-tool'
import { themeCheckContrastToolInputSchema } from '../theme-check-contrast-tool'
import { themeProposeToolInputSchema } from '../theme-propose-tool'

const logger = createServiceLogger('ThemeAssistTools')

export interface ThemeAssistToolContext {
  chatId: string
  userId: string
}

/**
 * What an offered proposal records on its tool row, beside the text she hears
 * (and the change set, which the row keeps as the call's arguments). Kept
 * small: everything here reaches the model with the result, and what the
 * author is shown is re-judged against the draft whenever it is read.
 */
export interface ThemeProposalRecord {
  draftId: string
  /** The draft's tokens and stylesheet hashes it was judged against. */
  draftRevision: string
}

export type ThemeAssistResult =
  | { success: true; formattedText: string; proposal?: ThemeProposalRecord }
  | { success: false; error: string }

type DraftLoad = { ok: true; draftId: string; detail: DraftDetail } | { ok: false; error: string }

/** The conversation's draft, read fresh; refused outside a Calliope conversation. */
async function loadConversationDraft(context: ThemeAssistToolContext): Promise<DraftLoad> {
  const chat = await getRepositories().chats.findById(context.chatId)
  if (!chat || chat.chatType !== 'calliope' || !chat.themeDraftId) {
    logger.warn('Theme tool called outside a Calliope conversation', { chatId: context.chatId, chatType: chat?.chatType })
    return { ok: false, error: 'The theme tools answer only in a conversation about a theme draft.' }
  }
  try {
    const detail = await readDraft(chat.themeDraftId)
    return { ok: true, draftId: chat.themeDraftId, detail }
  } catch (error) {
    if (error instanceof ThemeDraftNotFoundError) {
      return { ok: false, error: `The draft "${chat.themeDraftId}" is no longer there.` }
    }
    logger.error('Failed to read the conversation\'s theme draft', {
      chatId: context.chatId,
      draftId: chat.themeDraftId,
      error: error instanceof Error ? error.message : String(error),
    })
    return { ok: false, error: 'The draft could not be read just now.' }
  }
}

function invalidInput(tool: string, issues: { message: string; path: PropertyKey[] }[]): ThemeAssistResult {
  const detail = issues.map((i) => (i.path.length > 0 ? `${i.path.join('.')}: ${i.message}` : i.message)).join('; ')
  logger.debug('Theme tool input refused', { tool, detail })
  return { success: false, error: `Invalid input for ${tool}: ${detail}` }
}

export async function executeThemeReadDraftTool(input: unknown, context: ThemeAssistToolContext): Promise<ThemeAssistResult> {
  const parsed = themeReadDraftToolInputSchema.safeParse(input ?? {})
  if (!parsed.success) return invalidInput('theme_read_draft', parsed.error.issues)
  const draft = await loadConversationDraft(context)
  if (!draft.ok) return { success: false, error: draft.error }
  logger.debug('theme_read_draft', { chatId: context.chatId, draftId: draft.draftId, part: parsed.data.part })
  return { success: true, formattedText: renderDraft(assistDraftFrom(draft.detail), { part: parsed.data.part }) }
}

export async function executeThemeLookupTokensTool(input: unknown, context: ThemeAssistToolContext): Promise<ThemeAssistResult> {
  const parsed = themeLookupTokensToolInputSchema.safeParse(input ?? {})
  if (!parsed.success) return invalidInput('theme_lookup_tokens', parsed.error.issues)
  const draft = await loadConversationDraft(context)
  if (!draft.ok) return { success: false, error: draft.error }
  const assist = assistDraftFrom(draft.detail)
  const found = lookupTokens({ ...parsed.data, type: parsed.data.type as TokenType | undefined }, assist.tokens)
  logger.debug('theme_lookup_tokens', { chatId: context.chatId, draftId: draft.draftId, found: found.length })
  return { success: true, formattedText: renderTokenLookup(assist, found) }
}

export async function executeThemeLookupHooksTool(input: unknown, context: ThemeAssistToolContext): Promise<ThemeAssistResult> {
  const parsed = themeLookupHooksToolInputSchema.safeParse(input ?? {})
  if (!parsed.success) return invalidInput('theme_lookup_hooks', parsed.error.issues)
  const draft = await loadConversationDraft(context)
  if (!draft.ok) return { success: false, error: draft.error }
  const found = lookupHooks({ ...parsed.data, surface: parsed.data.surface as HookSurface | undefined })
  logger.debug('theme_lookup_hooks', { chatId: context.chatId, draftId: draft.draftId, found: found.length })
  return { success: true, formattedText: renderHookLookup(assistDraftFrom(draft.detail), found) }
}

export async function executeThemeCheckContrastTool(input: unknown, context: ThemeAssistToolContext): Promise<ThemeAssistResult> {
  const parsed = themeCheckContrastToolInputSchema.safeParse(input ?? {})
  if (!parsed.success) return invalidInput('theme_check_contrast', parsed.error.issues)
  const draft = await loadConversationDraft(context)
  if (!draft.ok) return { success: false, error: draft.error }
  const check = checkDraftContrast(assistDraftFrom(draft.detail), parsed.data)
  logger.debug('theme_check_contrast', { chatId: context.chatId, draftId: draft.draftId, ok: check.ok })
  if (!check.ok) return { success: false, error: check.reason }
  return { success: true, formattedText: renderContrastCheck(parsed.data, check) }
}

export async function executeThemeProposeTool(input: unknown, context: ThemeAssistToolContext): Promise<ThemeAssistResult> {
  const parsed = themeProposeToolInputSchema.safeParse(input ?? {})
  if (!parsed.success) return invalidInput('theme_propose', parsed.error.issues)
  const draft = await loadConversationDraft(context)
  if (!draft.ok) return { success: false, error: draft.error }
  const set = parsed.data
  const assessment = assessProposal(draft.detail, set)
  logger.debug('theme_propose', {
    chatId: context.chatId,
    draftId: draft.draftId,
    operations: set.operations.length,
    verdict: assessment.verdict,
  })
  const text = renderProposalAssessment(set.title, assessment)
  // A refused proposal is a failed tool row: the author is never shown it.
  if (assessment.verdict === 'refused') return { success: false, error: text }
  return {
    success: true,
    formattedText: text,
    proposal: { draftId: draft.draftId, draftRevision: assessment.draftRevision },
  }
}

/** Calliope's tools by name: the executor's dispatch table. */
export const THEME_ASSIST_HANDLERS: Readonly<
  Record<string, (input: unknown, context: ThemeAssistToolContext) => Promise<ThemeAssistResult>>
> = Object.freeze({
  theme_read_draft: executeThemeReadDraftTool,
  theme_lookup_tokens: executeThemeLookupTokensTool,
  theme_lookup_hooks: executeThemeLookupHooksTool,
  theme_check_contrast: executeThemeCheckContrastTool,
  theme_propose: executeThemeProposeTool,
})
