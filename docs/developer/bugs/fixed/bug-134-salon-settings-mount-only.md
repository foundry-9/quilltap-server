# Bug 134 — a chat setting changed while a Salon tab is open never reaches it

| | |
|---|---|
| **Status** | Fixed |
| **Found** | 2026-09-10 |
| **Fixed** | 2026-09-10 |
| **Severity** | Medium (nothing lost or corrupted, but a documented control silently does nothing until the chat is reopened, and the workspace makes "reopen the chat" a thing users rarely do) |
| **Who it bites** | Anyone who changes a Settings → Chat dial while a Salon tab is open — which, since the tabbed workspace became the default landing surface in 4.6, is the ordinary way to change one |
| **Provenance** | Pre-dates the tabbed workspace; `useChatData` has fetched settings once on mount since the hook was extracted. The workspace turned a short-lived page into an indefinitely-mounted tab, which is what made a mount-only read start to matter |
| **Fix site** | `app/salon/[id]/SalonView.tsx` (one `useChatSettingsQuery()` feeding every read), `app/salon/[id]/hooks/useChatData.ts` (the mount-only fetch deleted), `app/salon/[id]/types.ts` (the duplicate `ChatSettings` declaration retired), `app/salon/[id]/hooks/useMessageActions.ts` (the remembered-choice write now invalidates the key) |
| **v5 status** | Not yet assessed |
| **Index** | [bugs.md](../../bugs.md) |

**FIXED in v4 (2026-09-10).** `SalonView` now takes its settings from a single
`useChatSettingsQuery()` at the top of the component, and `useChatData` no
longer fetches `/api/v1/settings/chat` at all — the state, the fetcher and the
error-path defaults are gone. Saving a dial writes the shared key through
`setQueryData` and invalidates it, and TanStack delivers that to every mounted
observer, a `display: none` tab included, so an open chat follows the change
with no remount. The Salon's own `ChatSettings` declaration — the second
description of one row, which is what let the two readers disagree in silence —
is now a re-export of the settings module's, alongside the four sub-shapes it
referenced. One write was fixed in the same pass: the memory-cascade dialog's
"remember my choice" `PUT` published nothing, so the preference it saved was
invisible to the reader in the same component until something else refetched;
it now invalidates the key like every other save.

## Symptom

Open a chat. Switch to the Settings tab in the same workspace, change a Chat
dial — auto-scroll, thinking display, token display, the LLM inspector button,
story backgrounds. Switch back to the chat. The chat is still running on the
old value, and goes on doing so for as long as the tab stays open. Only a
reload, or closing and reopening the chat tab, picks the change up.

The setting itself saved correctly: the database row is right, the Settings tab
shows the new value, and a *newly* opened chat honours it. It is purely that the
open chat never hears about it.

## Root cause

`SalonView` reads chat settings from `useChatData`, whose `fetchChatSettings`
(`app/salon/[id]/hooks/useChatData.ts:22`) is a bare `fetch('/api/v1/settings/chat')`
into `useState`, called exactly once from the initialization effect
(`app/salon/[id]/SalonView.tsx:852-857`). The hook subscribes to one realtime
topic, `'memories'`; there is no topic for settings, and the settings route
(`app/api/v1/settings/chat/route.ts`) publishes none.

So the value is a snapshot of the moment the component mounted. Under the
tabbed workspace that moment can be hours ago: `WorkspaceHost` renders every
tab simultaneously and hides the inactive ones with `display: none`
(`components/workspace/WorkspaceHost.tsx:106-122`), so a backgrounded Salon is
never unmounted and never re-runs its initialization effect.

**The infrastructure to do this correctly already exists and is already used
elsewhere.** `useChatSettingsQuery` (`hooks/useChatSettingsQuery.ts`) reads the
same endpoint through `queryKeys.settings.chat`; the settings mutation
`setQueryData`s and invalidates that key
(`components/settings/chat-settings/hooks/useChatSettings.ts:118-120`), and the
workspace refetches it on activation of the `settings` and `salon-list` tabs
(`lib/workspace/tab-refetch.ts:61,88`). Every consumer of the query — the
composer's spellcheck, emoji and Unicode plugins via
`LexicalComposerWrapper` — updates live. `SalonView` is the one reader that
opted out, and it is the one that goes stale.

## Why it survived

The two readers disagree invisibly. A composer plugin and `SalonView` read the
same field off the same endpoint and behave differently, with nothing in either
call site to suggest one of them is a snapshot. Nothing errors, nothing is
missing, and the stale value is a *plausible* value — it is simply the old one.

Before the workspace, a Salon was a page: navigating to Settings unmounted it
and coming back remounted it, so the mount-only fetch was refreshed by the
navigation itself and the bug could not be observed. The keep-alive contract
that makes a streaming reply survive a tab switch is exactly what exposes it.

## Scope

Eight reads in `SalonView` were on the stale path:

- `storyBackgroundsSettings.enabled` (`:138`, `:784`)
- `autoScrollOnResponseComplete` (`:716`)
- `llmLoggingSettings.enabled` (`:961`, `:1165`, `:1879`)
- `tokenDisplaySettings.showChatTotals` (`:1164`)
- `thinkingDisplay.defaultVisible` / `.defaultCollapsed` (`:1498`, `:1499`)

`impersonationVoiceRewrite` was deliberately put on `useChatSettingsQuery` when
it was added, so the In Their Own Words gate already follows its setting live —
that is the shape the rest should take.

## The fix

One `const { data: chatSettings } = useChatSettingsQuery()` near the top of
`SalonView`, feeding all nine reads (the eight above plus
`impersonationVoiceRewrite`, whose separate `liveChatSettings` call is now
redundant and gone). `fetchChatSettings`, the `chatSettings` state and the
`setChatSettings` setter are deleted from `useChatData`, and the initialization
effect no longer calls the fetcher. No new realtime topic: the query key is
already invalidated on save, and the invalidation reaches a hidden tab because
the observer is mounted.

The salon-local `ChatSettings` interface is replaced by a re-export of
`@/components/settings/chat-settings/types` — a second declaration of the same
row is what let the composer's live reader and the Salon's snapshot describe
one endpoint in different words with nothing to flag the difference.
`MemoryCascadeAction`, `MemoryCascadePreferences`, `TokenDisplaySettings`,
`StoryBackgroundsSettings` and `DangerousContentSettings` go the same way; the
one field the salon copy had that the canonical shape does not (`tagStyles`)
had no reader. `VirtualizedMessageList`'s `chatSettings` prop widens to
`| undefined`, which is what a query in flight hands it.

**Write side.** `useMessageActions`' memory-cascade "remember my choice" `PUT`
wrote the row and told nobody, so the saved preference was stale to the reader
in the same component. It now invalidates `queryKeys.settings.chat`.

**The audit the fix asked for.** Every other client read of
`/api/v1/settings/chat` is either a write, or lives in a modal that mounts per
open (`EditEnclaveModal`, `useNewChat`) where a mount-only read is correct.
`AvatarDisplayProvider` is app-root-level and mount-only, but the settings save
calls `syncAvatarDisplayStyle` into it explicitly, so it is not a second
instance of this bug — a hand-rolled sync rather than the query, left alone.

## How to verify

With a chat open in one workspace tab and Settings in another:

1. Stamp the live composer node from the console so a remount is detectable:
   `document.querySelector('.qt-speaking-as-avatar').__stamp = 'A'`
2. Switch to the Settings tab, flip Chat → Auto-Scroll, switch back.
3. The stamp is still `'A'` — no remount, which is correct and intended.
4. Before the fix the chat still behaves as it did before the flip; after the
   fix it follows the new value with the stamp intact.

Verified that way on 2026-09-10 against the V4test instance, using Settings →
Data & System → **LLM Logging → Enable Logging** as the observable (it gates
the Salon toolbar's LLM-inspector button, which is present or absent with no
ambiguity). Flipping it off and returning to the chat tab removed the button;
flipping it back on and returning restored it; the stamped message node
survived every switch, so no remount did the work. Read the toolbar only while
the Salon tab is *focused* — the workspace header follows the focused pane, so
the button is absent from the DOM while Settings is up whatever the setting
says.

The guard is `app/salon/[id]/hooks/__tests__/useImpersonationVoice.test.ts`,
which now asserts both halves against the source: `SalonView` reads through
`useChatSettingsQuery`, and neither it nor `useChatData` mentions
`fetchChatSettings` or the settings endpoint.
