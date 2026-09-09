# Bug 128 — the Salon's memory count is frozen at whatever it was when the tab opened, and a stale zero makes the Delete button a silent no-op

| | |
|---|---|
| **Status** | Open |
| **Found** | 2026-09-08 |
| **Severity** | **Medium** — nothing errors and nothing is lost, but the sidebar states a falsehood about the user's data (0 where 59 stand), and the destructive control it labels early-returns on that falsehood: clicking **Delete Memories (0)** does nothing at all, with no confirmation, no toast, and no log line |
| **Who it bites** | anyone who opens a chat before its memories exist — which is *every new chat*, since extraction is a background job that lands a minute or two after the first turn. The tabbed workspace makes it permanent: a Salon tab is hidden by CSS, never unmounted, so the mount effect that reads the count never runs again for the life of the tab |
| **Provenance** | Reported against the live Friday instance, chat `27961b14-ae98-46bf-ba1e-9f0ec13bb103` ("Damp Curtains and Cold Water"). Confirmed end to end: the DB holds 59 rows, `GET /api/v1/memories?chatId=…` answers `{"memoryCount":59}`, and a **fresh** load of the same chat in the same running build renders `Delete Memories (59)`. The user's screenshot of the long-lived tab reads `(0)` |
| **Defect site** | `app/salon/[id]/hooks/useChatData.ts:105` (`fetchChatMemoryCount`, called once), `app/salon/[id]/SalonView.tsx:801-807` (the mount-only effect), `app/salon/[id]/hooks/useMemoryActions.ts:18` (the `chatMemoryCount === 0` early return) |
| **v5 status** | **Not yet assessed.** The port carries its own Salon sidebar; if it reads a count once at mount and gates a destructive action on it, it inherits this whole |
| **Index** | [bugs.md](../bugs.md) |

---

## Symptom

The Salon sidebar's **Edit Content** card reads

> 🗑 Delete Memories (0)

for a chat that has 59 memories. Clicking it does nothing — no confirmation
dialog, no toast, no error. The count and the button both correct themselves
the moment the chat is loaded fresh in a new tab, which is what makes the
report look like a backend fault and is exactly what it is not.

Measured on Friday, 2026-09-09:

| | |
|---|---|
| `SELECT COUNT(*) FROM memories WHERE chatId = '27961b14-…'` | **59** (2 holders) |
| `GET /api/v1/memories?chatId=27961b14-…` on the running app | `{"chatId":"27961b14-…","memoryCount":59}` |
| A fresh page load of that chat, sidebar button text | `Delete Memories (59)` |
| The user's long-lived workspace tab | `Delete Memories (0)` |

The timestamps say why this chat in particular: the chat row was created at
`02:33:29Z` and the first memory landed at `02:35:02Z`, 93 seconds later. The
tab was opened at creation, when zero was the truth, and has been telling that
same truth ever since — through all 59.

## Root cause

Two independent defects, stacked. Either alone is survivable; together they
produce a lying label on a dead button.

### 1. The count is read once, at mount, and nothing ever reads it again

`fetchChatMemoryCount` (`useChatData.ts:105`) is a `useCallback` keyed on
`chatId`, and its only caller is the initialization effect in `SalonView.tsx`:

```ts
useEffect(() => {
  fetchChat()
  fetchChatSettings()
  fetchChatPhotoCount()
  fetchChatMemoryCount()
}, [fetchChat, fetchChatSettings, fetchChatPhotoCount, fetchChatMemoryCount])
```

Every dependency is stable for a given `chatId`, so the effect runs exactly
once per mount. Memories, meanwhile, are written by `MEMORY_EXTRACTION` and
friends — background jobs that complete in the forked child *after* that read,
turn after turn, for as long as the conversation lasts. The only other writer
of the state is `setChatMemoryCount(0)` after a successful delete.
`handleReextractMemories` queues jobs and never looks back.

There is no `memories` entry in `REALTIME_TOPICS`, no `memories` row in
`queryKeysForTopic`, and no memory job type in `topicsForCompletedJob`. The
server has no way to say *this changed*, so the client has no reason to ask
again — the exact shape CLAUDE.md's realtime rule exists to prevent, arrived at
from the other direction: not a stray poll, but no refresh path at all.

### 2. The tabbed workspace makes "once per mount" mean "once per session"

Before the workspace, leaving a chat and coming back remounted `SalonView` and
re-read the count, so the staleness healed on its own within a few clicks.
`WorkspaceHost.tsx:120` hides an inactive pane with a CSS class
(`'qt-tab-pane' + (visible ? '' : ' hidden')`) and keeps it mounted — that
keep-alive is deliberate and load-bearing, since it is what lets a streaming
Salon survive a tab switch. It also removes the accidental cure. A chat opened
at 02:33 and left open reads `(0)` at 03:05 and would read `(0)` tomorrow.

### 3. The zero is not merely cosmetic — it disarms the button

`handleDeleteChatMemories` (`useMemoryActions.ts:18`) opens with

```ts
if (chatMemoryCount === 0) {
  return
}
```

which is defensible against a *true* zero and indistinguishable from a broken
click against a false one. There is no `disabled` attribute on the button, so
it invites the click, absorbs it, and reports nothing. A user trying to clear a
chat's memories cannot, and is given no reason.

## Why it survived

- **The backend is correct**, and every backend-shaped probe says so. The
  repository, the route, and the DB all agree on 59; only a long-lived browser
  tab disagrees, and only about a number in a collapsed card.
- **`EditContentSection` defaults `chatMemoryCount = 0`**, so a genuinely
  missing prop and a stale zero render identically — there is no "unknown"
  state to notice.
- **It self-heals on every reload**, which is what anyone investigating does
  first. The bug is invisible to the debugging reflex that finds it.
- **The card is collapsed by default.** The count is only read by someone who
  opened *Edit Content* on a tab they had left open — a narrow enough overlap
  that it took a screenshot to surface.
- **`safeQuery`'s zero fallback is a decoy.** `countByChatId` → `count()`
  swallows a query failure into `0` (documented at `base.repository.ts:436`),
  so the first suspicion falls on a soft-failing read. The logs carry no
  `Error counting memories for chat`, and the live endpoint answers 59; the
  server never returned a zero to begin with.

## The fix

A `memories` realtime topic, subscribed by the sidebar — and a button that
tells the truth about being unavailable rather than pretending otherwise.

### Step 1 — declare the topic

- `lib/schemas/realtime.types.ts` — add `'memories'` to `REALTIME_TOPICS`.
- `lib/query/keys.ts` — add `chatCount: (chatId: string) => ['memories', 'chat-count', chatId] as const`
  to the existing `memories` namespace.
- `lib/realtime/topic-map.ts` — a `case 'memories'` returning
  `id ? [queryKeys.memories.chatCount(id)] : [queryKeys.memories.all]`, and
  `queryKeys.memories.all` appended to `ALL_REALTIME_PREFIXES` so the
  reconnect catch-up sweep covers it.

### Step 2 — publish it from the parent

`lib/realtime/job-topics.ts`, in `topicsForCompletedJob` — every memory job
type already carries `chatId` on its payload (verified: `queue-service.ts`
`MemoryExtractionPayload`, `CarinaMemoryExtractionPayload:91`,
`MemoryRegenerateChatPayload`):

```ts
case 'MEMORY_EXTRACTION':
case 'INTER_CHARACTER_MEMORY':
case 'CARINA_MEMORY_EXTRACTION':
case 'MEMORY_REGENERATE_CHAT':
  return [{ topic: 'memories', id: str(payload, 'chatId') }];

case 'MEMORY_HOUSEKEEPING':
  // Character-scoped: prunes across every chat that character was in, so the
  // hint is collection-wide by necessity.
  return [{ topic: 'memories' }];
```

`TOPIC_ID_FIELDS` is keyed by every `RealtimeTopic`, so it needs a
`memories: []` row to typecheck.

The non-job write paths publish directly, in the parent:

- `app/api/v1/memories/route.ts` — `publishRealtime('memories', chatId)` after
  `handleDeleteByChatId` and after the delete-by-message-ids path.
- `lib/memory/memory-gate.ts` — `publishRealtime('memories')` in
  `deleteMemoryWithUnlink` / `deleteMemoriesWithUnlinkBatch`, the deletion
  chokepoint. Collection-wide, because those take memory ids and not a chat id;
  publishing from the job child is a no-op by design, which is correct here.

> ⚠ **Do not add `memories` to `REPOSITORY_TOPICS`.** `extractTopicId` calls
> `firstIdArg(args, ...)`, which returns `args[0]` whenever it is a string —
> so `memories.delete(memoryId)` would publish `{topic:'memories', id:<memoryId>}`,
> and `useRealtimeTopic`'s id filter would then discard that hint at every
> chat-scoped subscriber. A hint that reaches nobody is worse than no hint,
> because it looks like coverage. Wiring the write-batch path needs
> `firstIdArg` taught to reject a positional id for topics whose id means
> something other than the row's own primary key.

### Step 3 — subscribe in the Salon

In `SalonView.tsx`, beside the initialization effect:

```ts
useRealtimeTopic('memories', fetchChatMemoryCount, id)
```

`useRealtimeTopic` also fires `onChange` on socket open, so a reconnect after a
sleep re-reads the count with no extra code. No polling is added: the offline
fallback for this counter is the next mount, which is where it already was.

Add `cache: 'no-store'` to `fetchChatMemoryCount`'s `fetch`, matching its three
siblings in `useChatData` — without it a cached 200 can hand back the stale
count on the very refetch meant to correct it.

### Step 4 — stop the zero from disarming the button

- `ChatSidebar.tsx` `EditContentSection` — `disabled={chatMemoryCount === 0}`
  on the Delete Memories button, with the matching `qt-*` disabled treatment.
  A control that will do nothing must not invite the click.
- `useMemoryActions.handleDeleteChatMemories` — re-read the count immediately
  before `showConfirmation` and confirm against the *fresh* number, so the
  dialog can never quote a stale one and a socket that was down does not cost
  the user the action.

### Step 5 — the adjacent surface, same change

> **Superseded (2026-09-08).** `fetchChatPhotoCount` reads `/api/v1/chats/{id}?action=files`, an action that does not exist, so re-reading it on the `chats` topic would still return zero. The count moves onto the chat-gallery query instead — see [salon-chat-gallery.md](../features/salon-chat-gallery.md) and the bug it files for the dead action. Steps 1–4 stand.

`chatPhotoCount` in the same hook has the identical shape: read once at mount,
refreshed only by three explicit call sites in `ChatModals.tsx`. A Lantern
image or a generated avatar landing from a background job leaves the Gallery
count stale in exactly the same way. This one needs no new plumbing at all —
`CHARACTER_AVATAR_GENERATION` and `STORY_BACKGROUND_GENERATION` already publish
`{topic:'chats', id: chatId}`, so:

```ts
useRealtimeTopic('chats', fetchChatPhotoCount, id)
```

Fix it here rather than filing it separately; it is the same hook, the same
mistake, and one line.

## Verification

- **Unit** — `__tests__/unit/realtime/job-topics.test.ts`: each of the five
  memory job types yields its hint, and the chat-scoped four carry the payload's
  `chatId`. `__tests__/unit/realtime/topic-map.test.ts`: `queryKeysForTopic('memories', id)`
  narrows to the chat-count key, and the bare topic sweeps the namespace.
- **Regression pin** — a `useChatData` test asserting the count refetches when a
  `memories` event for that chat arrives, and does **not** when the event names
  a different chat.
- **Live, in V4test** (never Friday): open a brand-new chat, expand *Edit
  Content*, confirm it reads `(0)` and the button is disabled. Send a turn.
  Within a couple of minutes the number climbs and the button arms itself — with
  no reload, and with the tab never having lost focus. Then switch to another
  workspace tab, send nothing, come back: the number is still right.
- **The old shape fails the pin.** Reverting step 3 alone must leave the
  refetch test red; that is what proves the subscription rather than the
  re-render is doing the work.
