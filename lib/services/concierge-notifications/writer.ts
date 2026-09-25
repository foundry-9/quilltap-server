/**
 * Writer for Concierge chat notifications.
 *
 * When the gatekeeper classifies a chat as dangerous, this helper injects a
 * synthetic ASSISTANT-role chat message announcing the Concierge's quiet
 * intervention. Characters at the table see — through the avatar of the
 * Concierge, in discreet language — that the conversation has been marked
 * for handling by more appropriate providers.
 *
 * Errors never propagate — the danger-classification job must never fail
 * because an announcement couldn't be written.
 */

import { randomUUID } from 'node:crypto';
import { getRepositories } from '@/lib/repositories/factory';
import { logger } from '@/lib/logger';
import { getErrorMessage } from '@/lib/error-utils';
import { CATEGORY_LABELS } from '@/lib/services/dangerous-content/gatekeeper.service';
import type { MessageEvent } from '@/lib/schemas/types';

export interface ConciergeDangerDetails {
  /** Overall danger score (0-1) returned by the classifier. */
  score: number;
  /** Threshold at which the classifier flips to "dangerous." */
  threshold: number;
  /** Per-category breakdown from the classifier. */
  categories: Array<{ category: string; score: number; label?: string }>;
  /** 'moderation' for a dedicated moderation provider; 'llm' for the cheap-LLM fallback. */
  source?: 'moderation' | 'llm';
  /** Provider that performed the classification (e.g. 'OPENAI'). */
  providerName?: string;
}

export interface ConciergeDangerAnnouncement {
  chatId: string;
  details?: ConciergeDangerDetails;
}

interface RankedCategory {
  category: string;
  score: number;
  label: string;
}

function rankCategories(details: ConciergeDangerDetails): RankedCategory[] {
  const named: RankedCategory[] = details.categories.map(c => ({
    category: c.category,
    score: c.score,
    label: CATEGORY_LABELS[c.category] || c.label || c.category,
  }));

  const crossing = named.filter(c => c.score >= details.threshold);
  const ranked = (crossing.length > 0 ? crossing : named)
    .slice()
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);
  return ranked;
}

function formatCategoryPhrase(categories: RankedCategory[], scoreWord: string): string {
  if (categories.length === 0) return '';
  if (categories.length === 1) {
    const c = categories[0];
    return `${c.label} (${scoreWord} ${c.score.toFixed(2)})`;
  }
  const head = categories.slice(0, -1).map(c => `${c.label} (${scoreWord} ${c.score.toFixed(2)})`).join(', ');
  const tail = categories[categories.length - 1];
  return `${head} and ${tail.label} (${scoreWord} ${tail.score.toFixed(2)})`;
}

/**
 * Bare noun phrase naming the classifier that rendered the verdict, e.g.
 * "the house's OPENAI moderation assayer" or "the cheap-LLM assayer, OPENAI".
 * Returns '' when no provider is known.
 */
function assayerNounPhrase(details: ConciergeDangerDetails): string {
  if (!details.providerName) return '';
  return details.source === 'moderation'
    ? `the house's ${details.providerName} moderation assayer`
    : `the cheap-LLM assayer, ${details.providerName}`;
}

function formatAssayer(details: ConciergeDangerDetails): string {
  const noun = assayerNounPhrase(details);
  return noun ? ` (per ${noun})` : '';
}

export function buildDangerContent(details?: ConciergeDangerDetails): string {
  const opener =
    "The Concierge, with his customary discretion, has stepped quietly to the table.";
  const closer =
    "He has arranged for the present conversation — and any adjunct errands it may occasion — " +
    "to be entrusted to a desk better appointed to subjects of its particular character. " +
    "No interruption is required; pray continue at your leisure.";

  if (!details) {
    return `${opener} ${closer}`;
  }

  const ranked = rankCategories(details);
  const phrase = formatCategoryPhrase(ranked, 'severity');
  const overall = details.score.toFixed(2);
  const threshold = details.threshold.toFixed(2);
  const assayer = formatAssayer(details);

  // When the overall severity actually meets the threshold, the arithmetic
  // itself drew the line. When it does not, the classifier flagged the matter
  // of its own accord (e.g. OpenAI's moderation endpoint returning `flagged`
  // against its own catalogue, independent of our numeric threshold) — so say
  // so plainly, and offer the severities as informational rather than decisive.
  const crossedThreshold = details.score >= details.threshold;

  let specifics: string;
  if (crossedThreshold) {
    specifics = phrase
      ? `The matter that drew his eye: ${phrase} — together registering ${overall} against the present threshold of ${threshold}${assayer}.`
      : `The matter, on close inspection, registered ${overall} against the present threshold of ${threshold}${assayer}.`;
  } else {
    const verdictBy = assayerNounPhrase(details) || 'the house assayer';
    specifics = phrase
      ? `The matter was marked by the direct verdict of ${verdictBy}: ${phrase}. The severities themselves stayed shy of the present threshold of ${threshold} (the highest reading ${overall}) — it was the assayer's own judgement, not the tally, that drew his eye.`
      : `The matter was marked by the direct verdict of ${verdictBy}, the severities notwithstanding — they stayed shy of the present threshold of ${threshold} (registering ${overall}).`;
  }

  return `${opener} ${specifics} ${closer}`;
}

export function buildDangerOpaqueContent(details?: ConciergeDangerDetails): string {
  const opener =
    "Content advisory: the present conversation — and any adjunct operations it occasions — " +
    "has been routed to a provider better suited to subjects of its particular character.";
  const closer = "No interruption is required; proceed at your leisure.";

  if (!details) {
    return `${opener} ${closer}`;
  }

  const ranked = rankCategories(details);
  const triggers = formatCategoryPhrase(ranked, 'score');
  const overall = details.score.toFixed(2);
  const threshold = details.threshold.toFixed(2);
  const providerVia = details.providerName
    ? `${details.providerName} (${details.source === 'moderation' ? 'moderation endpoint' : 'cheap-LLM fallback'})`
    : 'the classifier';
  const crossedThreshold = details.score >= details.threshold;

  let specifics: string;
  if (crossedThreshold) {
    const via = details.providerName ? ` Classified by ${providerVia}.` : '';
    specifics = triggers
      ? `Triggers: ${triggers}. Overall score ${overall} against threshold ${threshold}.${via}`
      : `Overall score ${overall} against threshold ${threshold}.${via}`;
  } else {
    // Flagged by the classifier itself, below the numeric threshold. Report the
    // scores for context but make clear they did not drive the decision.
    specifics = triggers
      ? `Flagged directly by ${providerVia}, below the numeric threshold. Triggers: ${triggers}. Highest score ${overall}, threshold ${threshold} (not reached).`
      : `Flagged directly by ${providerVia}, below the numeric threshold. Overall score ${overall}, threshold ${threshold} (not reached).`;
  }

  return `${opener} ${specifics} ${closer}`;
}

/**
 * State-transition announcements. These mirror the auto-classification
 * variant above but speak to a change of the chat's Concierge state. They
 * never include classifier details and never honor an opaque audience — the
 * operator is announcing their own choice, in their own voice, through the
 * Concierge.
 *
 * One kind is not the operator's: `auto-unmoderated`, posted when the refusal
 * ledger's auto-switch moves a Moderated chat to Unmoderated. It shares this
 * writer because it goes through the same transition chokepoint
 * (`applyConciergeFlip` with `{ by: 'concierge' }`). The classifier's own
 * switch is announced by {@link postConciergeDangerAnnouncement}, which carries
 * the verdict's details.
 *
 * Transcripts written before phase 3 carry bubbles of the retired kinds
 * (`manual-flagged`, `manual-safe`, `manual-resumed`, `manual-vouched`,
 * `manual-uncensored`, `auto-flagged-refusals`); they are plain messages and
 * render as they always did.
 */
export type ConciergeManualKind =
  | 'set-moderated'     // -> Moderated (the operator; resets the ledger)
  | 'set-unmoderated'   // -> Unmoderated (the operator opens the uncensored door themselves)
  | 'set-locked'        // -> Locked (the operator; ordinary providers only, refusals stand)
  | 'auto-unmoderated'; // Moderated -> Unmoderated by the Concierge, after N stated moderation refusals

/**
 * What the Concierge says about the refusals that earned an auto-switch.
 * `auto-unmoderated` only.
 */
export interface ConciergeAutoFlagDetails {
  /** Refusals on the ledger when the switch fired. */
  count: number;
  /** Provider of the most recent refusal (e.g. 'GOOGLE'). */
  lastProvider: string;
  lastModel?: string | null;
}

const TIMES_WORDS = ['Never', 'Once', 'Twice', 'Three times', 'Four times', 'Five times', 'Six times',
  'Seven times', 'Eight times', 'Nine times', 'Ten times'];
const COUNT_WORDS = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten'];

function refusalWho(details: ConciergeAutoFlagDetails | undefined): string | null {
  if (!details?.lastProvider) return null;
  return details.lastModel ? `${details.lastProvider} ${details.lastModel}` : details.lastProvider;
}

export function buildAutoFlagContent(details: ConciergeAutoFlagDetails | undefined): string {
  const count = details?.count ?? 0;
  const who = refusalWho(details);
  // A threshold of one is permitted: a single refusal is stated plainly, with
  // no tally and no "most recently".
  const declined = count === 1
    ? `The house's regular staff have declined this conversation on grounds of propriety${who ? ` — ${who}, to be precise` : ''}.`
    : `${count >= 2 && count < TIMES_WORDS.length ? `${TIMES_WORDS[count]} now` : 'More than once now'} the house's regular staff have declined this conversation on grounds of propriety${who ? ` — most recently ${who}` : ''}.`;
  return `${declined} The Concierge has taken the liberty of moving the whole affair to the uncensored desk; you may set it back to Moderated from the sidebar whenever you wish.`;
}

export function buildAutoFlagOpaqueContent(details: ConciergeAutoFlagDetails | undefined): string {
  const count = details?.count ?? 0;
  const counted = count >= 1 && count < COUNT_WORDS.length ? COUNT_WORDS[count] : String(count);
  const noun = count === 1 ? 'moderation refusal' : 'moderation refusals';
  const who = refusalWho(details);
  const last = who ? ` (last: ${who})` : '';
  return `${counted} ${noun}${last}. The Concierge switched this chat to Unmoderated; change it in the sidebar.`;
}

function buildManualContent(kind: ConciergeManualKind, details?: ConciergeAutoFlagDetails): string {
  switch (kind) {
    case 'set-moderated':
      return "By the operator's own hand, the conversation is Moderated once more. The house's usual providers are asked first; should one of them decline a matter on grounds of propriety, the Concierge will quietly take it across the street. His ledger of refusals is wiped clean.";
    case 'set-unmoderated':
      return "By the operator's own hand, the Concierge has been sent away and the uncensored door stands open. Nothing is to be examined, nothing softened; the conversation and its errands go henceforth to the frank desk, entirely on the operator's own recognizance.";
    case 'set-locked':
      return "The operator has locked the present company to the house's usual desks. Should one of them decline a matter, the refusal stands: the Concierge will take nothing elsewhere, nor move the conversation of his own accord.";
    case 'auto-unmoderated':
      return buildAutoFlagContent(details);
  }
}

function buildManualOpaqueContent(kind: ConciergeManualKind, details?: ConciergeAutoFlagDetails): string {
  switch (kind) {
    case 'set-moderated':
      return 'Operator advisory: this conversation is Moderated. Ordinary providers are asked first; a content refusal is retried on an uncensored provider.';
    case 'set-unmoderated':
      return 'Operator advisory: this conversation has been manually set to Unmoderated. It goes to the uncensored providers only; no classification or scanning will run, and prompts go out unaltered.';
    case 'set-locked':
      return 'Operator advisory: this conversation is Locked to the ordinary providers. A content refusal stands; nothing is rerouted and the Concierge will not switch the chat.';
    case 'auto-unmoderated':
      return buildAutoFlagOpaqueContent(details);
  }
}

export interface ConciergeManualAnnouncement {
  chatId: string;
  kind: ConciergeManualKind;
  /** `auto-unmoderated` only. */
  details?: ConciergeAutoFlagDetails;
}

export async function postConciergeManualAnnouncement(
  params: ConciergeManualAnnouncement,
): Promise<MessageEvent | null> {
  const { chatId, kind, details } = params;
  try {
    const repos = getRepositories();

    const chat = await repos.chats.findById(chatId);
    if (!chat) {
      return null;
    }

    const messageId = randomUUID();
    const now = new Date().toISOString();
    const content = buildManualContent(kind, details);
    const opaqueContent = buildManualOpaqueContent(kind, details);

    const message: MessageEvent = {
      type: 'message',
      id: messageId,
      role: 'ASSISTANT',
      content,
      opaqueContent,
      attachments: [],
      createdAt: now,
      participantId: null,
      systemSender: 'concierge',
      systemKind: 'danger',
    };

    await repos.chats.addMessage(chatId, message);

    logger.info('[ConciergeNotification] Manual transition announced', {
      context: 'concierge-notifications',
      chatId,
      messageId,
      kind,
    });

    return message;
  } catch (error) {
    logger.error('[ConciergeNotification] Failed to post manual announcement', {
      context: 'concierge-notifications',
      chatId,
      kind,
      error: getErrorMessage(error),
    }, error as Error);
    return null;
  }
}

export async function postConciergeDangerAnnouncement(
  params: ConciergeDangerAnnouncement,
): Promise<MessageEvent | null> {
  const { chatId, details } = params;
  try {
    const repos = getRepositories();

    const chat = await repos.chats.findById(chatId);
    if (!chat) {
      return null;
    }

    const messageId = randomUUID();
    const now = new Date().toISOString();
    const content = buildDangerContent(details);
    const opaqueContent = buildDangerOpaqueContent(details);

    const message: MessageEvent = {
      type: 'message',
      id: messageId,
      role: 'ASSISTANT',
      content,
      opaqueContent,
      attachments: [],
      createdAt: now,
      participantId: null,
      systemSender: 'concierge',
      systemKind: 'danger',
    };

    await repos.chats.addMessage(chatId, message);

    logger.info('[ConciergeNotification] Danger announcement posted', {
      context: 'concierge-notifications',
      chatId,
      messageId,
      score: details?.score,
      threshold: details?.threshold,
      categories: details?.categories.map(c => c.category),
      source: details?.source,
      providerName: details?.providerName,
    });

    return message;
  } catch (error) {
    logger.error('[ConciergeNotification] Failed to post danger announcement', {
      context: 'concierge-notifications',
      chatId,
      error: getErrorMessage(error),
    }, error as Error);
    return null;
  }
}

/**
 * Refusal announcements — the Concierge says so whenever a provider refused a
 * picture (or, with nobody to ask, a text turn). Posted by
 * `generateImageWithConciergeFailover` and the text failover service. No
 * dedupe: a refusal is rare, and every one is actionable.
 *
 * - `refusal-rerouted`      — refused, and the uncensored understudy answered.
 * - `refusal-no-understudy` — refused, failover allowed, and nobody to ask.
 * - `refusal-not-permitted` — refused, and a reroute is barred because the
 *   chat is Locked. (An off-duty Concierge announces nothing at all.)
 */
export type ConciergeRefusalKind =
  | 'refusal-rerouted'
  | 'refusal-no-understudy'
  | 'refusal-not-permitted';

/** What was being made when the refusal happened. */
export type ConciergeRefusalPurpose = 'tool' | 'lantern' | 'avatar' | 'dialog' | 'text';

export interface ConciergeRefusalDetails {
  /** Provider of the profile that refused (e.g. 'OPENAI'). */
  refusingProvider: string;
  /** Model of the profile that refused. */
  refusingModel: string;
  /** Name the user gave the answering profile — `refusal-rerouted` only. */
  answeringProfileName?: string;
  purpose: ConciergeRefusalPurpose;
  /** `refusal-not-permitted` only: what barred the reroute — the chat is Locked. */
  reason?: 'locked';
}

export interface ConciergeRefusalAnnouncement {
  chatId: string;
  kind: ConciergeRefusalKind;
  details: ConciergeRefusalDetails;
}

function refusalCommission(purpose: ConciergeRefusalPurpose): { voiced: string; plain: string } {
  switch (purpose) {
    case 'tool':
      return { voiced: 'the commission for a picture', plain: 'an image request' };
    case 'lantern':
      return { voiced: 'the commission for a new backdrop', plain: 'a story background' };
    case 'avatar':
      return { voiced: 'the commission for a new portrait', plain: 'a character portrait' };
    case 'dialog':
      return { voiced: 'the commission for a picture', plain: 'an image request' };
    case 'text':
      return { voiced: 'the request for a reply', plain: 'this turn' };
  }
}

export function buildRefusalContent(kind: ConciergeRefusalKind, details: ConciergeRefusalDetails): string {
  const painter = `${details.refusingProvider} ${details.refusingModel}`;
  const { voiced } = refusalCommission(details.purpose);
  const house = details.purpose === 'text' ? "the house's usual correspondent" : "the house's usual painter";
  switch (kind) {
    case 'refusal-rerouted':
      return `The Concierge regrets to report that ${house} (${painter}) declined ${voiced} on grounds of propriety; he has taken it across the street to ${details.answeringProfileName ?? 'a more obliging studio'}, who were happy to oblige.`;
    case 'refusal-no-understudy':
      return `The Concierge regrets to report that ${house} (${painter}) declined ${voiced} on grounds of propriety, and he knows of no more obliging establishment to take it to. Should you care to name one, tick "Uncensored-compatible" on a suitable profile, or choose one in the Concierge's settings.`;
    case 'refusal-not-permitted':
      return `The Concierge observes that ${house} (${painter}) declined ${voiced} on grounds of propriety. This conversation is Locked to the usual desks, so the refusal stands; set it to Moderated should you wish him to take such things elsewhere.`;
  }
}

export function buildRefusalOpaqueContent(kind: ConciergeRefusalKind, details: ConciergeRefusalDetails): string {
  const who = `${details.refusingProvider} ${details.refusingModel}`;
  const { plain } = refusalCommission(details.purpose);
  switch (kind) {
    case 'refusal-rerouted':
      return `Provider ${who} refused ${plain} on content grounds. The Concierge rerouted it to ${details.answeringProfileName ?? 'an uncensored profile'}.`;
    case 'refusal-no-understudy':
      return `Provider ${who} refused ${plain} on content grounds. No uncensored profile is available to retry it; mark a profile "Uncensored-compatible" or choose one in the Concierge settings.`;
    case 'refusal-not-permitted':
      return `Provider ${who} refused ${plain} on content grounds. This chat is Locked, so it was not rerouted; set it to Moderated to allow an uncensored retry.`;
  }
}

export async function postConciergeRefusalAnnouncement(
  params: ConciergeRefusalAnnouncement,
): Promise<MessageEvent | null> {
  const { chatId, kind, details } = params;
  try {
    const repos = getRepositories();

    const chat = await repos.chats.findById(chatId);
    if (!chat) {
      logger.debug('[ConciergeNotification] Refusal announcement skipped: chat not found', {
        context: 'concierge-notifications',
        chatId,
        kind,
      });
      return null;
    }

    const message: MessageEvent = {
      type: 'message',
      id: randomUUID(),
      role: 'ASSISTANT',
      content: buildRefusalContent(kind, details),
      opaqueContent: buildRefusalOpaqueContent(kind, details),
      attachments: [],
      createdAt: new Date().toISOString(),
      participantId: null,
      systemSender: 'concierge',
      systemKind: 'refusal',
    };

    await repos.chats.addMessage(chatId, message);

    logger.info('[ConciergeNotification] Refusal announced', {
      context: 'concierge-notifications',
      chatId,
      messageId: message.id,
      kind,
      purpose: details.purpose,
      refusingProvider: details.refusingProvider,
      refusingModel: details.refusingModel,
      answeringProfileName: details.answeringProfileName,
      reason: details.reason,
    });

    return message;
  } catch (error) {
    logger.error('[ConciergeNotification] Failed to post refusal announcement', {
      context: 'concierge-notifications',
      chatId,
      kind,
      error: getErrorMessage(error),
    }, error as Error);
    return null;
  }
}
