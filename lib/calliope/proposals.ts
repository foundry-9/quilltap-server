/**
 * Calliope's proposals as stored on her conversation (Calliope Live, Spec J
 * §2.4).
 *
 * A proposal is the persisted `theme_propose` TOOL row of a successful call:
 * its `arguments` are the change set, its `result` carries the draft revision
 * it was judged against (`ThemeProposalRecord`). Its state lives beside them
 * in the row's content as `proposalState` — absent while it is offered,
 * `'kept'` or `'discarded'` once the author has decided — which the model never
 * reads (a tool row reaches the model as its `result` alone). Whether an
 * offered proposal is **stale** is not stored: it is re-judged against the
 * draft as it now is (`assessProposal`), every time it is read or kept.
 *
 * A refused call (a failed tool row) is not a proposal and is never listed.
 *
 * Server only.
 *
 * @module calliope/proposals
 */

import { createServiceLogger } from '@/lib/logging/create-logger'
import type { getRepositories } from '@/lib/repositories/factory'
import type { ChatEvent } from '@/lib/schemas/types'
import { ChangeSetSchema, type ChangeSet } from '@/lib/themes/assist/change-set'
import { assessProposal, draftRevisionOf, type ProposalDraftSource, type ProposalReview } from '@/lib/themes/assist'

const logger = createServiceLogger('CalliopeProposals')

type Repos = ReturnType<typeof getRepositories>

export const THEME_PROPOSE_TOOL_NAME = 'theme_propose'

/** What the author has decided; absent while it is offered. */
export type ProposalDecision = 'kept' | 'discarded'

export type ProposalState = 'offered' | 'kept' | 'discarded' | 'stale'

/** A stored proposal, read back. */
export interface StoredProposal {
  /** The TOOL message id. */
  id: string
  createdAt: string
  changeSet: ChangeSet
  /** The draft revision it was judged against when she made it. */
  draftRevision: string | null
  decision: ProposalDecision | null
}

/** A stored proposal as the author is shown it, judged against the draft as it now is. */
export interface ProposalView {
  id: string
  createdAt: string
  title: string
  reason: string
  state: ProposalState
  /** The draft has changed since she made it (it may still apply). */
  draftChanged: boolean
  /** What it does now; null when it is stale. */
  review: ProposalReview | null
  /** Why it no longer applies (stale only). */
  staleReason: string | null
  operations: ChangeSet['operations']
}

interface ToolRowContent {
  toolName?: string
  success?: boolean
  result?: unknown
  arguments?: unknown
  proposalState?: unknown
}

function parseContent(content: string): ToolRowContent | null {
  try {
    const parsed = JSON.parse(content) as unknown
    return parsed && typeof parsed === 'object' ? (parsed as ToolRowContent) : null
  } catch {
    return null
  }
}

/** The draft revision recorded in the row's result (a JSON string of `{ formattedText, proposal }`). */
function recordedRevision(result: unknown): string | null {
  let value = result
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value) as unknown
    } catch {
      return null
    }
  }
  const proposal = (value as { proposal?: { draftRevision?: unknown } } | null)?.proposal
  return typeof proposal?.draftRevision === 'string' ? proposal.draftRevision : null
}

/** The proposal stored in one event, or null when the event is not one. */
export function readStoredProposal(event: ChatEvent): StoredProposal | null {
  if (event.type !== 'message' || event.role !== 'TOOL') return null
  const content = parseContent(event.content)
  if (!content || content.toolName !== THEME_PROPOSE_TOOL_NAME || content.success !== true) return null
  const changeSet = ChangeSetSchema.safeParse(content.arguments)
  if (!changeSet.success) {
    logger.warn('A theme_propose row carries a change set that no longer parses; not listed', { messageId: event.id })
    return null
  }
  const decision = content.proposalState === 'kept' || content.proposalState === 'discarded' ? content.proposalState : null
  return {
    id: event.id,
    createdAt: event.createdAt,
    changeSet: changeSet.data,
    draftRevision: recordedRevision(content.result),
    decision,
  }
}

/** Every proposal on the conversation, oldest first. */
export function storedProposals(events: readonly ChatEvent[]): StoredProposal[] {
  return events.map(readStoredProposal).filter((p): p is StoredProposal => p !== null)
}

/** One stored proposal as the author is shown it now. */
export function viewProposal(stored: StoredProposal, draft: ProposalDraftSource): ProposalView {
  const base = {
    id: stored.id,
    createdAt: stored.createdAt,
    title: stored.changeSet.title,
    reason: stored.changeSet.reason,
    operations: stored.changeSet.operations,
    draftChanged: stored.draftRevision !== null && stored.draftRevision !== draftRevisionOf(draft),
  }
  if (stored.decision) {
    return { ...base, state: stored.decision, review: null, staleReason: null }
  }
  const assessment = assessProposal(draft, stored.changeSet)
  if (assessment.verdict === 'refused') {
    return { ...base, state: 'stale', review: null, staleReason: assessment.reason }
  }
  return { ...base, state: 'offered', review: assessment.review, staleReason: null }
}

/**
 * Record the author's decision on the proposal's row. Only an offered
 * proposal is decided; returns false when the row is not a proposal.
 */
export async function recordProposalDecision(
  repos: Repos,
  chatId: string,
  event: ChatEvent,
  decision: ProposalDecision,
): Promise<boolean> {
  if (event.type !== 'message' || !readStoredProposal(event)) return false
  const content = parseContent(event.content)
  if (!content) return false
  await repos.chats.updateMessage(chatId, event.id, {
    content: JSON.stringify({ ...content, proposalState: decision }),
  } as Partial<ChatEvent>)
  logger.debug('Recorded the author\'s decision on a proposal', { chatId, messageId: event.id, decision })
  return true
}
