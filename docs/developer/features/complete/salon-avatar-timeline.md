# Feature: Avatars fixed to their moment in the Salon

**Status:** Implemented (4.13-dev, 2026-11-06).

A Salon bubble shows the character as they looked when that message was written, not as they look now. When Clark Kent takes off his glasses, every bubble before the new portrait arrives still shows Clark, and every bubble after it shows Superman.

## Why

Today a chat stores one avatar per character, and the Salon reads it when it draws:

- `chats.characterAvatars[characterId]` and `characters.avatarOverrides[{ chatId }]` hold the image. Only `bindAvatarToChat` (`lib/background-jobs/handlers/character-avatar.ts`) writes the first; `set-avatar` / `remove-avatar` (`app/api/v1/chats/[id]/actions/avatars.ts`) write the second.
- `getMessageAvatar` (`app/salon/[id]/SalonView.tsx`) takes the participant's current `avatarUrl` for every message.

So a wardrobe change or an inventory change (both refresh the avatar, through `outfit-change-effects.ts` and `inventory/equip-effects.ts`) repaints the whole transcript. `characterAvatars[].afterMessageCount` records when an avatar arrived, but nothing reads it.

## Decisions (settled with the operator, 2026-11-06)

1. **An avatar takes effect when its image is bound, not when the outfit changed.** The image is drawn by a background job and lands a few messages late. That is how the Salon behaves now, and it stays that way: the moment is the bind.
2. **Fallback is short.** If the image in force for a message no longer exists, use the most recent avatar recorded in this chat whose image still exists. If none does, use the character's current avatar.
3. **No backfill.** Existing chats are not reconstructed. They keep looking as they do, and once resumed they follow the new rules from that point on.

## Design

### Storage: `chat_avatar_timeline`

An append-only table. It is not stored in the message stream. Messages are sent to models, regenerated as swipes, folded into summaries and indexed for search, so a marker message would need filtering in every one of those places.

```sql
CREATE TABLE "chat_avatar_timeline" (
  "id" TEXT PRIMARY KEY,
  "chatId" TEXT NOT NULL REFERENCES "chats"("id") ON DELETE CASCADE,
  "characterId" TEXT NOT NULL,      -- no FK: characters may be archived tombstones
  "imageId" TEXT,                   -- vault link id or legacy files.id; NULL = "the character's own avatar from here on"
  "effectiveAt" TEXT NOT NULL,      -- ISO time the avatar took effect (the bind)
  "source" TEXT NOT NULL,           -- baseline | generated | cache | operator | operator-removed
  "createdAt" TEXT NOT NULL
);
CREATE INDEX "idx_chat_avatar_timeline_chat"
  ON "chat_avatar_timeline" ("chatId", "characterId", "effectiveAt");
```

No `userId` (single-user instance). Unbounded, the way `chat_wardrobe_history` is. Nothing renumbers or prunes rows. Chat deletion cascades.

### The one writer: `chatAvatarTimeline.record`

`ChatAvatarTimelineRepository.record({ chatId, characterId, imageId, source })` is the only runtime writer. In one transaction it:

1. **Writes a baseline row the first time a pair is recorded.** If the (chat, character) pair has no rows yet, it first inserts a `baseline` row with `effectiveAt` = `1970-01-01T00:00:00.000Z` (`AVATAR_TIMELINE_BASELINE_AT`, before any message), holding the caller's `priorImageId`: the character's `avatarOverrides` entry for this chat (what the Salon was drawing), else `NULL` (the character's own avatar). This is what keeps decision 3 true. Without it, the earlier bubbles of a resumed chat would fall through to "current avatar" and repaint to the new look the moment the first new one arrived. The baseline only freezes what the chat already showed; it does not reconstruct history.
2. **Appends the new row** with `effectiveAt` = now. Recording the same `imageId` as the latest row is a no-op.

Callers:

| Path | Source |
|---|---|
| `bindAvatarToChat`, generation path | `generated` |
| `bindAvatarToChat`, configuration-cache hit | `cache` |
| `handleSetAvatar` | `operator` |
| `handleRemoveAvatar` | `operator-removed` (`imageId` NULL) |

`bindAvatarToChat` runs in the job child. `record` is buffered whole and replayed in the parent, the same way `wardrobeHistory.settle` is, so the baseline check reads the real rows. The `CHARACTER_AVATAR_GENERATION` completion already publishes the `chats` realtime topic (`lib/realtime/job-topics.ts`), so no new topic is needed.

Rows are never rewritten when an image is deleted: a roll deletion (`avatar-rolls-service.ts`), the stale-chat collapse sweep, or a gallery delete leaves the row pointing at nothing, and resolution falls back. History stays true to what was chosen.

### Resolution: `SalonAvatar`

`lib/chat/salon-avatar.ts` is the one resolver:

```ts
export interface SalonAvatarSegment {
  characterId: string;
  effectiveAt: string;          // ISO
  imageUrl: string | null;      // resolved; null when the row's image is gone or the row is NULL
  imageId: string | null;
  source: AvatarTimelineSource;
  ownAvatar: boolean;           // imageId is NULL: the character's own avatar
  missing: boolean;             // the row named an image that no longer exists
}

export interface SalonAvatar {
  url: string | null;
  from: 'timeline' | 'chat-latest' | 'character-current';
  effectiveAt: string | null;
}

/** Server: every segment for a chat, images resolved once through resolveCharacterAvatar. */
export function loadAvatarTimeline(chatId, repos): Promise<SalonAvatarSegment[]>;

/** Pure, client-safe: the avatar in force for one character at one moment. */
export function avatarAt(segments, characterId, at: string, currentUrl: string | null): SalonAvatar;
```

`avatarAt`:

1. Take the latest segment for the character with `effectiveAt <= at`.
2. If it resolved to an image, use it (`timeline`).
3. If its `imageId` is NULL by design (`baseline` or `operator-removed`), use the character's **default** image, which the loader resolves into `imageUrl` (the placeholder if they have none). Not `currentUrl`: in a chat the participant's current avatar already carries this chat's per-chat avatar, the very look the earlier bubbles must not take.
4. If its image is missing, use the latest segment for that character in the whole chat that still resolves (`chat-latest`), else `currentUrl`.
5. No segments for the character: `currentUrl`. This is every chat that predates the feature until it is resumed and a new avatar is bound.

### Delivery

- `GET /api/v1/chats/[id]?action=avatar-timeline` returns `SalonAvatarSegment[]`. It goes through `dispatchAction`; nothing reads `?action=` by hand.
- `queryKeys.chats.avatarTimeline(id)` in `lib/query/keys.ts`. Its refetch interval is gated by `useRealtimeTopic` on `chats`, so it refreshes when the avatar job completes.

### Where the Salon draws with it

`getMessageAvatar` keeps its precedence and changes only which URL a character branch returns: `avatarAt(segments, character.id, message.createdAt, character.avatarUrl)` replaces `character.avatarUrl` in

- the participant branch,
- the `customAnnouncer` character branch,
- the Carina answerer branch,
- the USER / ASSISTANT fallbacks.

Staff avatars and Brahma are unchanged. The search panel reads `getMessageAvatar` through `searchStateRef`, so it follows automatically. A message being streamed is the newest, so it gets the latest segment. The header, participant sidebar and character cards keep showing the current avatar, because they show the character now, not at a moment.

`lib/export/markdown-transcript.ts` mirrors `getMessageAvatar` for speaker *names* only and draws no images, so it is unchanged.

## Data and schema touchpoints

- **Migration** `add-chat-avatar-timeline-table-v1`: creates the table only, with no seeding (decision 3). Add a `PRETTY_LABELS` entry in `lib/startup/prettify.ts`. There is no loop, so no `reportProgress`.
- **DDL.md:** the new table and its rules.
- **Backups and restore:** include the table; the restore UUID remap (`lib/backup/restore/uuid-remap.ts`) rewrites `chatId`, `characterId` and `imageId`.
- **`.qtap` chat export / import:** carry the rows with the chat; add them to `public/schemas/qtap-export.schema.json`. A SillyTavern export ignores them.
- **`lib/chat/character-keyed-fields.ts`:** rekey `characterId` and `imageId` on the same remaps `characterAvatars` gets.
- **Chat gallery:** `passCurrentAvatars` (`lib/photos/chat-gallery.ts`) may also list timeline images, so a portrait the chat once wore stays findable in its gallery. This is optional and only for discoverability; not done.
- **Stale-chat collapse:** unchanged. It deletes superseded generated avatars in quiet chats. Those rows then fall back under decision 2.

## Help

`help/wardrobe.md` (Per-Conversation Avatars) says it: each bubble shows the character as they looked when they spoke, a new look takes effect when its portrait arrives, and older chats pick this up once they are resumed.

## Tests

- `avatarAt`: in-force selection at boundaries (equal timestamps), NULL rows, missing images falling to `chat-latest`, then to current, and no segments.
- `record`: baseline written once with the prior binding (characterAvatars, then override, then NULL); same-image no-op; buffered from the child and replayed in the parent.
- The `.qtap` import remap carries the rows (`remapAvatarTimelineRows`).
- `getMessageAvatar`: a two-segment chat draws the earlier bubble with the earlier image and the later bubble with the later one.

## Out of scope

- Reconstructing history for existing chats (decision 3).
- Placing a new look at the moment the outfit changed instead of when the portrait arrives (decision 1).
- Making the header or sidebar time-aware.
