/**
 * Salon avatars fixed to their moment — the pure, client-safe half.
 *
 * A chat's avatar timeline (`chat_avatar_timeline`, written only by
 * `ChatAvatarTimelineRepository.record`) is delivered to the Salon as
 * {@link SalonAvatarSegment}s with their images already resolved
 * (`loadAvatarTimeline`, `salon-avatar-loader.ts`). {@link avatarAt} picks the
 * avatar in force for one character at one moment. Every surface that draws a
 * message with its author's face — the Salon's `getMessageAvatar` and the
 * markdown transcript export — asks it, rather than reading the character's
 * current avatar.
 *
 * Fallback, settled with the operator:
 *   1. the latest segment at or before the moment, when its image exists;
 *   2. a segment that names no image by design (a baseline with no per-chat
 *      avatar, or a removed hand-set one) means the character's own avatar —
 *      their default image, resolved by the loader into `imageUrl`, never the
 *      participant's current avatar (which already carries this chat's
 *      per-chat avatar, the very look the earlier bubbles must not take);
 *   3. a segment whose image has since been deleted falls to the latest
 *      segment in the chat whose image still exists, then to the character's
 *      current avatar;
 *   4. no segments for the character (a chat that predates the timeline and
 *      has not bound an avatar since): the current avatar, as before.
 *
 * Design of record: docs/developer/features/salon-avatar-timeline.md
 *
 * @module chat/salon-avatar
 */

import type { AvatarTimelineSource } from '@/lib/schemas/chat-avatar-timeline.types';

/** One timeline row, with its image resolved for display. */
export interface SalonAvatarSegment {
  characterId: string;
  /** ISO time the avatar took effect. */
  effectiveAt: string;
  /** The row's image id; null when the row means "the character's own avatar". */
  imageId: string | null;
  /**
   * Resolved URL. For an own-avatar row, the character's default image (null
   * when they have none: the placeholder). Null when the row's image is gone.
   */
  imageUrl: string | null;
  /** The row means "the character's own avatar" (`imageId` null). */
  ownAvatar: boolean;
  source: AvatarTimelineSource;
  /** The row named an image that no longer exists. */
  missing: boolean;
}

/** The avatar in force for one character at one moment. */
export interface SalonAvatar {
  url: string | null;
  /** Which rule answered: see the module doc. */
  from: 'timeline' | 'chat-latest' | 'character-current';
  /** `effectiveAt` of the segment that answered, when one did. */
  effectiveAt: string | null;
}

/** Segments grouped by character, each list ascending by `effectiveAt`. */
export type SalonAvatarIndex = Map<string, SalonAvatarSegment[]>;

/** Group segments by character, ascending by time. Build once per timeline. */
export function indexAvatarTimeline(segments: readonly SalonAvatarSegment[]): SalonAvatarIndex {
  const index: SalonAvatarIndex = new Map();
  for (const segment of segments) {
    const list = index.get(segment.characterId);
    if (list) list.push(segment);
    else index.set(segment.characterId, [segment]);
  }
  for (const list of index.values()) {
    list.sort((a, b) => toMs(a.effectiveAt) - toMs(b.effectiveAt));
  }
  return index;
}

function toMs(iso: string | null | undefined): number {
  if (!iso) return Number.POSITIVE_INFINITY;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? Number.POSITIVE_INFINITY : ms;
}

/**
 * The avatar in force for `characterId` at `at` (a message's `createdAt`).
 * A missing or unparsable `at` reads as "now": the latest segment.
 */
export function avatarAt(
  index: SalonAvatarIndex,
  characterId: string,
  at: string | null | undefined,
  currentUrl: string | null,
): SalonAvatar {
  const current: SalonAvatar = { url: currentUrl, from: 'character-current', effectiveAt: null };
  const list = index.get(characterId);
  if (!list || list.length === 0) return current;

  const atMs = toMs(at);
  // Latest segment with effectiveAt <= at (binary search: lists are sorted).
  let lo = 0;
  let hi = list.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (toMs(list[mid].effectiveAt) <= atMs) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  // Earlier than every segment cannot happen with a baseline row; treat it
  // as the earliest segment so a clock skew never shows a later look.
  const segment = list[found >= 0 ? found : 0];

  if (segment.ownAvatar || segment.imageUrl) {
    // An own-avatar row with no default image answers null: the placeholder.
    return { url: segment.imageUrl, from: 'timeline', effectiveAt: segment.effectiveAt };
  }
  for (let i = list.length - 1; i >= 0; i -= 1) {
    if (!list[i].ownAvatar && list[i].imageUrl) {
      return { url: list[i].imageUrl, from: 'chat-latest', effectiveAt: list[i].effectiveAt };
    }
  }
  return current;
}
