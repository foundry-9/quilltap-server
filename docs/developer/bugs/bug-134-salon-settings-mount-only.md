# Bug 134 — a chat setting changed while a Salon tab is open never reaches it

| | |
|---|---|
| **Status** | Open |
| **Found** | 2026-09-10 |
| **Fixed** | — |
| **Severity** | Medium (nothing lost or corrupted, but a documented control silently does nothing until the chat is reopened, and the workspace makes "reopen the chat" a thing users rarely do) |
| **Who it bites** | Anyone who changes a Settings → Chat dial while a Salon tab is open — which, since the tabbed workspace became the default landing surface in 4.6, is the ordinary way to change one |
| **Provenance** | Pre-dates the tabbed workspace; `useChatData` has fetched settings once on mount since the hook was extracted. The workspace turned a short-lived page into an indefinitely-mounted tab, which is what made a mount-only read start to matter |
| **Fix site** | `app/salon/[id]/SalonView.tsx` — move the remaining `chatSettings?.…` reads onto `useChatSettingsQuery()` |
| **v5 status** | Not yet assessed |
| **Index** | [bugs.md](../bugs.md) |

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

Eight reads in `SalonView` are still on the stale path:

- `storyBackgroundsSettings.enabled` (`:138`, `:784`)
- `autoScrollOnResponseComplete` (`:716`)
- `llmLoggingSettings.enabled` (`:961`, `:1165`, `:1879`)
- `tokenDisplaySettings.showChatTotals` (`:1164`)
- `thinkingDisplay.defaultVisible` / `.defaultCollapsed` (`:1498`, `:1499`)

`impersonationVoiceRewrite` was deliberately put on `useChatSettingsQuery` when
it was added, so the In Their Own Words gate already follows its setting live —
that is the shape the rest should take.

## The fix

Replace the remaining `chatSettings?.…` reads with `useChatSettingsQuery()`,
then delete `fetchChatSettings` and the `chatSettings` state from `useChatData`
once nothing reads them. No new realtime topic is needed: the query key is
already invalidated on save and refetched on tab activation.

Worth checking in the same pass whether any other indefinitely-mounted
workspace surface reads a settings row through a mount-only `fetch`.

## How to verify

With a chat open in one workspace tab and Settings in another:

1. Stamp the live composer node from the console so a remount is detectable:
   `document.querySelector('.qt-speaking-as-avatar').__stamp = 'A'`
2. Switch to the Settings tab, flip Chat → Auto-Scroll, switch back.
3. The stamp is still `'A'` — no remount, which is correct and intended.
4. Before the fix the chat still behaves as it did before the flip; after the
   fix it follows the new value with the stamp intact.
