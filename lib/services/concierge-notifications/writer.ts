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

function formatAssayer(details: ConciergeDangerDetails): string {
  if (!details.providerName) return '';
  return details.source === 'moderation'
    ? ` (per the house's ${details.providerName} moderation assayer)`
    : ` (per the cheap-LLM assayer, ${details.providerName})`;
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

  const specifics = phrase
    ? `The matter that drew his eye: ${phrase} — together registering ${overall} against the present threshold of ${threshold}${assayer}.`
    : `The matter, on close inspection, registered ${overall} against the present threshold of ${threshold}${assayer}.`;

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
  const via = details.providerName
    ? ` Classified by ${details.providerName} (${details.source === 'moderation' ? 'moderation endpoint' : 'cheap-LLM fallback'}).`
    : '';

  const specifics = triggers
    ? `Triggers: ${triggers}. Overall score ${overall} against threshold ${threshold}.${via}`
    : `Overall score ${overall} against threshold ${threshold}.${via}`;

  return `${opener} ${specifics} ${closer}`;
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
