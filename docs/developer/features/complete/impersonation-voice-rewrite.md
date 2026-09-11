# In Their Own Words — voice rewrite for impersonated seats in the Salon composer

**Status:** Implemented (4.10-dev, 2026-09-10)
**Scope:** quilltap-server only (no shell, plugin, or package changes)
**Verified against:** `main` at `cc65d6bfc` (2026-09-10)

> **Implementation notes — where the built feature differs from this plan.**
> The plan is otherwise the design of record.
>
> - **`app/api/v1/settings/chat/route.ts` does have per-field code.** The plan
>   said "partial PATCH; no per-field code"; in fact every field is a positional
>   parameter on `updateChatSettings` with its own `typeof` guard. The new field
>   was added the same way. The *repository* row mapping is the generic part.
> - **The preview action receives the already-loaded `chat`** from
>   `handlers/post.ts` (signature `(req, chatId, chat, ctx)`, as `send-mail`
>   does) rather than re-reading it. The dispatcher 404s a missing chat before
>   any action runs, so step 1 of the plan's handler is already done for it.
> - **The dialog's draft lives in the hook, not the dialog.** A local copy
>   synchronised by `useEffect` trips the repo's `react-hooks/set-state-in-effect`
>   rule, so `useImpersonationVoice` owns the text and exposes `setSeed`;
>   `regenerate` / `changeProfile` / `changeSystemPrompt` therefore take no seed
>   argument and read the live stash through a ref.
> - **`bypassOnceRef` is belt to braces, not load-bearing.** Both Send variants
>   call `sendMessage` directly rather than re-dispatching the composer's submit,
>   so the gate is never consulted on the way out. The flag is still set, is
>   consumed by the next `intercept`, and is cleared on every `close` so it can
>   never outlive the dialog and skip a later rehearsal. Gate rule 5 stands.
> - **No presence-window production callers existed.** `computePresenceWindowsForParticipant`
>   / `filterMessagesByPresenceWindows` were test-only; this is their first
>   production use. Windows are computed from the **full** event list (the Host
>   status announcements that define them are themselves whispers) and then
>   applied to the played subset, and are skipped entirely for a seat with
>   `hasHistoryAccess`.
> - **`normalizeWhisperRoles` is not used.** The transcript excludes every
>   `systemSender` message outright, which leaves the normaliser nothing to flip.
> - **The composer's quill badge uses the existing `thinking` icon** (the rocking
>   quill) and only existing `qt-*` utilities, so no `_utilities.css` change and
>   no theme-storybook mirror were needed.
> - **The API-action test lives in `__tests__/unit/app/api/v1/chats/[id]/actions/`**,
>   beside its siblings, rather than at the path the plan named.
> - **The Wire Records did NOT pick the task type up automatically.** The plan
>   said they would; `mapTaskTypeToLogType` (`lib/memory/cheap-llm-tasks/core-execution.ts`)
>   is a closed allowlist whose default is `SUMMARIZATION`, so the new task type
>   — and `announcement-rewrite` before it, since 4.4 — filed as chat summaries.
>   Added an `LLMLogType` of `VOICE_REWRITE`, mapped both rehearsals to it, and
>   covered the mapping with a test. No migration: `llm_logs.type` is plain
>   `TEXT` with no constraint.
> - **The dialog opens 640×720, not 640×600.** At the planned height the
>   proposal — the entire point of the dialog — sat below the fold on first
>   open. The body also scrolls the proposal into view as it arrives, for short
>   screens where even 720 is clamped.
> - **The gate reads the setting through `useChatSettingsQuery`, not `useChatData`.**
>   `useChatData.fetchChatSettings` is a one-shot fetch on mount, and a workspace
>   tab keeps the Salon mounted indefinitely, so a toggle flipped in the Settings
>   tab never reached an open chat. Verified in the browser: with the Salon's DOM
>   node stamped and the tab merely backgrounded (never remounted), the stale
>   reader missed the change in both directions and the query-based reader
>   follows it live. The same staleness affects eight other Salon settings reads
>   and is filed as **bug 134**.
> - **`app/api/v1/settings/chat/route.ts` exports `PUT`, not `PATCH`** — the plan
>   called it a "partial PATCH". The shape is still partial (absent fields are
>   left alone); only the verb differs.
> - **Open questions 1–3 were all resolved as their stated defaults.**

All paths relative to the repository root.

## Summary

When the human is **impersonating** a character in the Salon (the Impersonate
button — the Bug 44 overlay, `chat.impersonatingParticipantIds`), a new
instance-level setting routes what they type through the same
"say it in the character's own voice" rehearsal that the Insert Announcement
dialog already offers for off-scene characters. Instead of posting the draft
directly, the composer opens a review dialog: the seat's own model restates the
draft in the character's voice, and the operator can send the restatement
(edited or not), regenerate it, go back and rewrite the original, or send the
original as written. Nothing reaches the chat until they choose.

The existing rehearsal is *off-scene*: the character is told they stand outside
the conversation and speak to the people inside it. This feature adds an
*in-scene* framing: the character is in the room, has been following the
conversation, and it is now their turn to say what the operator has drafted.

## Goals

- One toggle in Settings → Chat → Composer, **default off**.
- Fires whenever the seat the composer will attribute the message to is a seat
  the human is currently impersonating. Never fires for the owner persona seat
  (`controlledBy: 'user'`), and never for an attachment-only or tool-result-only
  send.
- The review dialog offers: **Send** (the proposal, editable), **Regenerate**,
  **Edit original** (back to the composer with the draft intact), and
  **Send as written** (bypass this once).
- The rewrite uses the seat's own connection profile and system prompt, the
  scene's roleplay template (so narration conventions match), the recent
  transcript as that character would see it, and a Commonplace Book recall
  against the draft.
- Nothing is persisted by the preview. The posted message is an ordinary
  user-authored message attributed to the impersonated seat, exactly as today.

## Non-goals (deferred, listed so they are decisions rather than omissions)

- Applying the rewrite to `controlledBy: 'user'` seats (the owner persona, or a
  seat flipped to user control from the participant card dropdown). The
  overlay is the one signal that says "this character has a voice of their own
  that a model normally supplies"; user-owned seats do not. A second toggle can
  extend it later without touching the pipeline.
- A per-chat override. The instance toggle plus the per-send "Send as written"
  escape hatch covers the cases raised; a chat-column override would clone the
  `turnSkippingEnabled` plumbing and can be added if wanted.
- Persisting the operator's original draft alongside the posted message (a
  `chat_messages` column, export schema, DDL). The LLM log row (task type
  below) is the audit trail for now.
- Token streaming of the proposal. Like the announcement preview and Carina,
  the rewrite is a one-shot request-scoped call.
- Rewriting Carina addresses (`@Name:` / `@Name?`) or Document-Mode commands.
  Those sends bypass the gate (see "Gate rules").

## Known state (verified)

### The existing rehearsal (what we are generalising)

- **Dialog:** `components/chat/InsertAnnouncementDialog.tsx` (734 lines). Three
  stages — `compose` → `generating` → `review`. In `review`, the seed editor is
  locked, the proposal renders in a second `MarkdownLexicalEditor` (editable),
  and the footer offers Cancel / Regenerate / Post. "Edit seed" drops back to
  `compose`. Profile picker defaults: user-controlled character → as-is; LLM
  character → `defaultConnectionProfileId` → instance default → as-is. System
  prompt picker defaults `defaultSystemPromptId` → `isDefault` → first.
- **Preview action:** `app/api/v1/chats/[id]/actions/announcement-preview.ts`,
  schema `insertAnnouncementPreviewSchema` in `app/api/v1/chats/[id]/schemas.ts`
  (`seedMarkdown`, `characterId`, `connectionProfileId`, `systemPromptId?`,
  `targetParticipantIds?`). Registered in `actions/index.ts`; dispatched from
  `handlers/post.ts`.
- **Service:** `lib/services/announcer/character-voiced.ts` —
  `generateCharacterVoicedAnnouncement`. System prompt is
  `buildSystemPrompt({ character, selectedSystemPromptId })` only (no template,
  no tools). Memory recall via `searchMemoriesSemantic` (limit 20,
  minImportance 0.3) → `buildMemorySubjectContext` → `formatDynamicMemoryHead`
  (maxEntries 12) → `buildCommonplaceLLMContext`. Recall failure is logged and
  tolerated. Roster = present CHARACTER participants minus the speaker
  (`buildRoster`). The user-role message is: recall block, presence line,
  the "Below is your own rough draft…" instruction, the seed. Executed with
  `executeCheapLLMTask(selectionFromProfile(profile), messages, userId, trim,
  'announcement-rewrite', chatId, undefined, undefined, 2048, character.id)`.
  Returns `{ success, proposedMarkdown, error? }`; never throws.
- **Post action:** `actions/announcement.ts` → `postAdhocAnnouncement`
  (`lib/services/announcer/writer.ts`). Not reused here — the impersonated
  line is posted through the ordinary send path, not as an announcement.
- **Help:** `help/insert-announcement.md` ("Letting a character speak in their
  own voice", lines 41–47).

### Impersonation and the composer's send path

- **Overlay, not a column:** `isUserDrivenSeat` / `findActiveUserParticipant`
  (`lib/chat/turn-manager/utils.ts:84`, `:131`). An impersonated seat keeps
  `controlledBy: 'llm'` **and keeps its `connectionProfileId`,
  `selectedSystemPromptId`, `selectedSubpromptIds`** — which is exactly what the
  rewrite needs.
- **Client overlay state:** `app/salon/[id]/hooks/useImpersonation.ts`
  (`impersonatingParticipantIds`, `activeTypingParticipantId`), synced from
  `chat.impersonatingParticipantIds` (`app/salon/[id]/types.ts:234`). The
  impersonate / stop-impersonate actions live in
  `app/api/v1/chats/[id]/actions/participants.ts` (writes at lines ~75, ~132,
  ~163).
- **The seat the composer speaks as:** `speakingSeat` / `speakingAsSeat` memos
  in `app/salon/[id]/SalonView.tsx` (~540–575), resolved with
  `findActiveUserParticipant` so it matches what the server will attribute.
  Rendered by `SpeakingAsAvatar` inside `ChatComposer`.
- **Submit:** `ChatComposer` (`app/salon/[id]/components/ChatComposer.tsx`)
  dispatches a form `submit`; `SalonView.tsx:1566` wires
  `onSubmit={(e) => sseStreaming.sendMessage(e, input, setInput, attachedFiles,
  pendingToolResults, setPendingToolResults, clearDraft, userStoppedStreamRef)}`.
  `sendMessage` (`app/salon/[id]/hooks/useSSEStreaming.ts` ~717) calls
  `e.preventDefault()`, trims `input`, clears the editor and draft, builds the
  optimistic bubble via `findActiveUserParticipant`, and POSTs
  `/api/v1/messages?chatId=…` with `{ content, fileIds,
  speakingAsParticipantId, pendingToolResults }` (payload at ~808). The FormEvent
  is used for nothing but `preventDefault`.
- **Editor handle:** `ComposerEditorHandle` (`components/chat/lexical/types.ts`)
  exposes `getMarkdown()`, `setMarkdown(text)`, `focus()`. The editor owns the
  live text; `input` is the debounced mirror (see the composer-decoupling note in
  memory — never reintroduce per-keystroke `setInput`).
- **Server attribution:** `handleSendMessage`
  (`lib/services/chat-message/orchestrator.service.ts` ~189; schema ~150–169)
  takes `speakingAsParticipantId` and resolves the author with the same helper.
  No change is needed there.

### Settings plumbing to clone (`composerSpellcheck` is the model)

- Zod: `ChatSettingsSchema` in `lib/schemas/settings.types.ts:640`
  (`composerSpellcheck: z.boolean().default(true)`).
- Column: `migrations/scripts/add-composer-spellcheck-field.ts`, registered in
  `migrations/scripts/index.ts`; DDL row at `docs/developer/DDL.md:776`.
- Repository defaults: `lib/database/repositories/chat-settings.repository.ts:220`
  (the row mapping is generic — only the defaults block names the field).
- API: `app/api/v1/settings/chat/route.ts` (partial PATCH; no per-field code).
- Client types/hook: `components/settings/chat-settings/types.ts:90`,
  `hooks/useChatSettings.ts:395` (`handleComposerSpellcheckChange` →
  `patchChatSettings`), context exposure in `ChatSettingsProvider.tsx`.
- UI: `components/settings/chat-settings/ComposerSpellcheckSettings.tsx` on
  `SettingsToggleRow`; mounted in `components/settings/tabs/ChatTabContent.tsx:89`
  inside the "Composer" `CollapsibleCard` (`sectionId="composer-spellcheck"`).
- Salon read side: `useChatSettingsQuery()` (`hooks/useChatSettingsQuery.ts`),
  as used by `components/chat/lexical/LexicalComposerWrapper.tsx:105`.
- Almanack ledger: `lib/tools/almanack/types.ts:277`,
  `phase3-ledgers.ts:645` (defaults) and `:740` (read), `render.ts:722`.
- Chat settings are **not** part of `.qtap` export (no hits in `lib/export/` or
  `public/schemas/qtap-export.schema.json`), so no export work.

### Context helpers available for the in-scene framing

- `buildSystemPrompt` (`lib/chat/context/system-prompt-builder.ts:364`) accepts
  `character`, `userCharacter`, `roleplayTemplate`, `selectedSystemPromptId`,
  `scenarioText`, `precompiledIdentityStack`, `tabooPhrases`,
  `standingInstructions`, `subprompts` — and `toolInstructions`, which we
  leave unset.
- `getRoleplayTemplate(repos, chat, chatSettings)`
  (`lib/services/chat-message/participant-resolver.service.ts:291`) resolves the
  chat's template with project/global fallback.
- Transcript shaping for one character: `filterWhisperMessages`,
  `filterMessagesByHistoryAccess`, `filterMessagesByPresenceWindows`,
  `attributeMessagesForCharacter` (`lib/chat/context/message-attribution.ts`).
  `buildConversationMessages` (`lib/services/chat-message/context-builder.service.ts:549`)
  is the full-turn assembler; it is heavier than we need but is the reference
  for `[Name]:` attribution and whisper-role normalisation.
- Carina's service (`lib/services/carina/carina.service.ts`) is the precedent
  for a "fresh minimal call" that deliberately omits tools and whispers.
- Concierge posture: `shouldUseUncensoredRoute(chat)`
  (`lib/services/dangerous-content/chat-override.ts`); the uncensored profile
  swap for a turn happens in
  `lib/services/chat-message/danger-orchestrator.service.ts` (~65).

## Design

### Gate rules (client, pure function)

`shouldRehearseImpersonatedLine({ enabled, seat, impersonatingParticipantIds,
text, hasAttachmentsOnly })` returns true only when **all** hold:

1. `chatSettings.impersonationVoiceRewrite === true`.
2. `seat` (the `speakingSeat` memo) is non-null, `type === 'CHARACTER'`, and
   `impersonatingParticipantIds.includes(seat.id)`. A `controlledBy: 'user'`
   seat never qualifies, even if it also appears in the overlay list.
3. `text.trim().length > 0`. Attachment-only and tool-result-only sends go
   straight through.
4. The text is not a Carina address (`@Name:` / `@Name?` markup at the start —
   reuse the same detector the send path uses; verify its export in
   `lib/services/carina/` or `lib/chat/` at implementation time rather than
   writing a second regex).
5. The send is not a "Send as written" resubmit (the hook sets a one-shot
   bypass flag before re-dispatching).

Document Mode edits do not pass through `sendMessage`, so they are unaffected.

### Flow

```
composer submit
  └─ SalonView onSubmit
       ├─ gate false → sseStreaming.sendMessage(...)  (unchanged)
       └─ gate true  → e.preventDefault(); stash {text, attachedFiles, pendingToolResults}
                        open ImpersonationVoiceDialog(seed = text, seat)
                          ├─ auto-runs POST ?action=impersonation-voice-preview
                          ├─ Send            → sendMessage(null, proposal, ...)
                          ├─ Send as written → sendMessage(null, seed, ...)
                          ├─ Regenerate      → preview again (same seed)
                          ├─ Edit original   → close; editor keeps draft; focus()
                          └─ Cancel          → close; nothing changes
```

`sendMessage` keeps clearing the editor and draft itself, so both Send
variants leave the composer empty exactly as a normal send does. Attachments
and pending tool results are forwarded untouched from the stash.

### Server: `POST /api/v1/chats/[id]?action=impersonation-voice-preview`

Request (`impersonationVoicePreviewSchema`, `app/api/v1/chats/[id]/schemas.ts`):

```ts
{
  participantId: uuid,            // the impersonated seat
  seedMarkdown: string.min(1),
  connectionProfileId?: uuid,     // operator override from the dialog's picker
  systemPromptId?: uuid,          // operator override
}
```

Handler (`app/api/v1/chats/[id]/actions/impersonation-voice-preview.ts`):

1. Load the chat; 404 if missing.
2. Find the participant; 404 if absent, 400 if not present
   (`isParticipantPresent`), 400 if not in `chat.impersonatingParticipantIds`.
   The server re-derives the impersonation from the chat row — it never trusts
   the client's claim.
3. Load the character (`repos.characters.findById`; a broken vault throws
   `CharacterVaultUnavailableError` — let the middleware map it).
4. Resolve the profile: override → `participant.connectionProfileId` →
   `character.defaultConnectionProfileId` → instance default → 400
   "No connection profile to rewrite with". If `shouldUseUncensoredRoute(chat)`
   and a dangerous-content uncensored profile is configured, prefer it the way
   the turn path does — verify the exact resolution helper in
   `danger-orchestrator.service.ts` and reuse it rather than re-deriving.
5. Resolve the system prompt: override → `participant.selectedSystemPromptId`
   → character default. Subprompts: `participant.selectedSubpromptIds` through
   the loader in `lib/subprompts/`.
6. Call the service; 400 with the service's error on failure; otherwise
   `{ success: true, proposedMarkdown, profileName, modelName }`.
7. `logger.info('[Chats v1] Impersonation voice preview generated', { chatId,
   participantId, characterId, profileId, seedLength, proposedLength })`, with
   `debug` for each resolution step.

Register in `actions/index.ts`, dispatch in `handlers/post.ts`, document in
`docs/developer/API.md` beside `announcement-preview`.

### Service: generalise `character-voiced.ts`

Refactor `lib/services/announcer/character-voiced.ts` so the announcement
rewrite and the in-scene rewrite share one core and differ only in framing.
Keep the module in `lib/services/announcer/` (it is still "a character voices
an operator-supplied line"); add a sibling `in-scene-voiced.ts`.

Shared core (`voice-rewrite-core.ts`, internal to the folder):

- `recallForSeed(character, seedMarkdown, profile, userId, chatId)` — the
  existing recall block, lifted verbatim (limit 20 / minImportance 0.3 /
  maxEntries 12, failure tolerated).
- `executeVoiceRewrite({ selection, messages, userId, taskType, chatId,
  characterId, maxTokens })` — the `executeCheapLLMTask` call and the
  `{ success, proposedMarkdown, error }` result shape.
- `formatNameList` (already duplicated between this file and
  `autonomous-room-announce.ts`; leave that duplication alone — it is not this
  feature's job).

`generateCharacterVoicedAnnouncement` keeps its signature and output byte for
byte (there is no golden, but the help text describes its behaviour and the
Insert Announcement dialog depends on it).

New `generateInSceneVoicedLine(params)`:

```ts
{
  chat: ChatMetadata,
  participant: ChatParticipantBase,   // the impersonated seat
  character: Character,
  profile: ConnectionProfile,
  seedMarkdown: string,
  systemPromptId: string | null,
  subprompts: ...,                     // resolved by the handler
  userId: string,
}
```

- **System prompt:** `buildSystemPrompt({ character, userCharacter,
  roleplayTemplate, selectedSystemPromptId, scenarioText,
  precompiledIdentityStack, tabooPhrases, standingInstructions, subprompts })`.
  `precompiledIdentityStack` comes from `chat.compiledIdentityStacks` keyed the
  way the turn path reads it (verify the key shape — it is a `JsonSchema`
  column, `lib/schemas/chat.types.ts:966`). `userCharacter` is the owner
  persona seat's character (`findUserParticipant`), which is what the seat's
  compiled stack already assumes. Roleplay template via `getRoleplayTemplate`.
  Taboo phrases through whatever the turn path uses (grep `tabooPhrases` in
  `lib/services/chat-message/` at implementation time; the memory note says
  announcer/Carina skip Taboo, but this line is *played*, so it must not).
  **No `toolInstructions`.**
- **Transcript:** the last `IN_SCENE_REWRITE_WINDOW = 12` played messages
  (`role` USER/ASSISTANT, `type: 'message'`, no `systemSender`), shaped for
  this seat with `filterWhisperMessages` → `filterMessagesByHistoryAccess` →
  `filterMessagesByPresenceWindows` → `attributeMessagesForCharacter`, so the
  character sees exactly what they would see on a real turn — including
  `[Name]:` prefixes in multi-character rooms and nothing whispered past them.
  Rendered as alternating `user` / `assistant` messages (the seat's own prior
  lines are `assistant`). Whisper-role normalisation as in
  `normalizeWhisperRoles`. Constant lives in the module, not a setting.
- **User-role message (the framing):**

  > *(recall block, if any)*
  >
  > It is your turn to speak in the conversation above. Below is your own rough
  > draft of what you want to say next — the meaning and substance of it.
  > Rewrite it in your own voice, the way you would actually say it given your
  > personality, manner of speech, and everything that has just happened. Keep
  > the meaning, the addressees, every specific fact, and any dice notation or
  > `@Name` address exactly as written. Match the scene's conventions for
  > narration and dialogue. Say only this — do not continue past it, do not
  > answer it, and do not speak for anyone else.
  >
  > Draft:
  >
  > *(seed)*

- **Task type:** `'impersonation-voice-rewrite'` (LLM log row; the Almanack's
  Wire Records will pick it up by task type automatically).
- **maxTokens:** `clamp(seedChars / 2, 1024, 4096)` — the announcement's flat
  2048 is fine for a proclamation but a long dramatic paragraph needs headroom.

Pure, side-effect-free, never throws. Logs `debug` with message counts and
lengths, `warn` on recall failure, `error` on unexpected failure (same shape as
the announcement service).

### Client: hook + dialog

**`app/salon/[id]/hooks/useImpersonationVoice.ts`** (export from `hooks/index.ts`):

- State: `pending: { seed, attachedFiles, pendingToolResults } | null`, `stage:
  'idle' | 'generating' | 'review'`, `proposal: string`, `profileOverride`,
  `systemPromptOverride`, `bypassOnceRef`.
- `intercept(e, text, ...sendArgs): boolean` — runs the gate; on true,
  `e.preventDefault()`, stashes, opens, and kicks off `runPreview()`.
- `runPreview()` — POSTs the action; on failure, toast and stay in `review`
  with an empty proposal so "Send as written" and "Edit original" remain
  available (a dead provider must never trap the operator's draft).
- `send(final: string)` — sets `bypassOnceRef`, calls
  `sseStreaming.sendMessage(null, final, setInput, attachedFiles,
  pendingToolResults, setPendingToolResults, clearDraft, userStoppedStreamRef)`,
  clears the stash, closes.
- `sendAsWritten()` — `send(pending.seed)`.
- `editOriginal()` / `cancel()` — clear the stash, close, `editorRef.focus()`.
  The draft is still in the editor because nothing cleared it.

`sendMessage`'s first parameter becomes `e: React.FormEvent | null` (it only
calls `preventDefault`). That is the one signature change in the streaming
hook; the SSE transport itself is untouched (per the TanStack-migration rule,
the stream is out of scope for everyone).

**`components/chat/ImpersonationVoiceDialog.tsx`** — `FloatingDialog`
(`storageKey="quilltap:impersonation-voice-geometry"`, 640×600, min 420×460),
title *"In {Name}'s own words"*. Body, top to bottom:

1. Seat header: avatar (`getAvatarSrc`) + name + title, and the profile line
   "Spoken through {profileName} — {modelName}".
2. "Your draft" — `MarkdownLexicalEditor`, editable (an edit here + Regenerate
   re-runs on the new seed; the pending stash updates). Same
   `namespace`/`ariaLabel` pattern as the announcement dialog.
3. Profile picker (defaults to the resolved seat profile; lists all profiles)
   and, when the character has more than one system prompt, the prompt picker.
   Changing either drops any proposal and re-runs.
4. "What {Name} will say" — `QuillAnimation` while generating; then a second
   `MarkdownLexicalEditor`, editable. This is the "update the final draft"
   surface.
5. Footer: **Cancel** · **Edit original** · **Send as written** ·
   **Regenerate** · **Send** (primary, disabled while generating or when the
   proposal is empty). Cmd/Ctrl+Enter in the proposal editor triggers Send.

Extract the shared review panel (label + generating state + proposal editor)
into `components/chat/VoiceRewriteReviewPanel.tsx` and use it from both
dialogs, so the two rehearsals cannot drift in look or behaviour. Keep the
extraction mechanical — no behaviour change to the announcement dialog.

Mount from `app/salon/[id]/components/ChatModals.tsx` next to
`InsertAnnouncementDialog`, conditionally (`{voice.isOpen && …}`) so each open
is a fresh mount, as the announcement dialog relies on.

**Composer cue:** when the gate is armed for the current seat, the Send
button's `title` reads "Sends your draft to {Name} to say in their own words
first" and the `SpeakingAsAvatar` gets a small quill badge (existing `Icon`
name; no new icon). Purely informational; no new `qt-*` classes. If a new
utility is unavoidable, it goes in `_utilities.css` and is mirrored to
`packages/theme-storybook` in the same change (with the package publish gate).

### Settings

- `ChatSettingsSchema`: `impersonationVoiceRewrite: z.boolean().default(false)`
  with a doc comment naming the overlay as the trigger.
- Migration `migrations/scripts/add-impersonation-voice-rewrite-field.ts`:
  `ALTER TABLE "chat_settings" ADD COLUMN "impersonationVoiceRewrite" INTEGER
  DEFAULT 0`; register in `index.ts`; `PRETTY_LABELS` entry in
  `lib/startup/prettify.ts` (steampunk voice, e.g. "Fitting the prompter's box
  beneath the stage"). No collection loop → no `reportProgress`.
- `docs/developer/DDL.md`: row beside `composerSpellcheck` (line ~776).
- Repository defaults block (`chat-settings.repository.ts:220`): `false`.
- Client: `types.ts` field + doc comment; `useChatSettings.ts`
  `handleImpersonationVoiceRewriteChange`; expose through
  `ChatSettingsProvider`; new
  `components/settings/chat-settings/ImpersonationVoiceSettings.tsx` on
  `SettingsToggleRow`, heading "Impersonated lines in the character's own
  words"; mounted in the existing Composer card in `ChatTabContent.tsx`.
- Almanack: `types.ts` field, `phase3-ledgers.ts` default + read, `render.ts`
  line "**Impersonated Lines in Character Voice**: Yes/No".

## Implementation phases

Each phase is independently committable and leaves the app working. Phases 1
and 4 are well-specified enough to delegate to a cheaper agent; phases 2 and 3
want the planning model or a careful reviewer.

### Phase 1 — Setting plumbing (no behaviour change yet)

Files: `lib/schemas/settings.types.ts`, new migration + `index.ts` +
`prettify.ts`, `DDL.md`, `chat-settings.repository.ts`,
`components/settings/chat-settings/{types.ts,hooks/useChatSettings.ts,ChatSettingsProvider.tsx,ImpersonationVoiceSettings.tsx}`,
`components/settings/tabs/ChatTabContent.tsx`, `lib/tools/almanack/{types,phase3-ledgers,render}.ts`.

Done when: the toggle appears in the Composer card, round-trips through PATCH,
the Almanack reports it, `npx tsc` and `npm run lint` pass, and a fresh
instance boots through the migration with a pretty label.

### Phase 2 — Server rewrite service and action

Files: `lib/services/announcer/{voice-rewrite-core.ts,character-voiced.ts,in-scene-voiced.ts}`,
`app/api/v1/chats/[id]/{schemas.ts,actions/impersonation-voice-preview.ts,actions/index.ts,handlers/post.ts}`,
`docs/developer/API.md`.

Done when: `curl`-able with an impersonated seat and returns a proposal; 400s
for a non-impersonated seat and for a missing profile; the announcement preview
still returns identical output for the same inputs (a snapshot test of the
composed messages guards the refactor).

### Phase 3 — Client interception and dialog

Files: `app/salon/[id]/hooks/{useImpersonationVoice.ts,index.ts,useSSEStreaming.ts}`,
`app/salon/[id]/SalonView.tsx`, `app/salon/[id]/components/{ChatModals.tsx,ChatComposer.tsx}`,
`components/chat/{ImpersonationVoiceDialog.tsx,VoiceRewriteReviewPanel.tsx,InsertAnnouncementDialog.tsx}`.

Done when: with the toggle on and a seat impersonated, Enter opens the dialog
with the draft intact; every footer path behaves as specified; with the toggle
off, or when speaking as the owner persona, sends are byte-identical to today;
an attachment-only send never opens the dialog; a provider failure leaves
"Send as written" and "Edit original" usable.

### Phase 4 — Documentation, tests, changelog

- **Help (all user-visible changes must be documented):**
  - New `help/impersonation-voice.md` — frontmatter
    `url: /settings?tab=chat&section=composer-spellcheck`, an "In-Chat
    Navigation" section with the matching `help_navigate(url: "...")` call,
    steampunk voice. Covers: what fires it (the Impersonate button, not the
    "User (you type)" dropdown), the dialog's five buttons, what the character
    is and isn't told, the Carina/attachment bypasses, and the honest caveat
    that the line is model-written and worth reading before sending.
  - `help/chat-settings.md` Composer card: a short entry pointing at the new
    page.
  - `help/chat-participants.md` Impersonation section: one paragraph
    cross-reference.
  - `help/insert-announcement.md`: one sentence noting the in-scene cousin.
  - Add the new help file's row to `.claude/commands/update-documentation.md`.
- **Tests (Jest; global `jest`, bare mock factories per repo convention):**
  - `lib/services/announcer/__tests__/in-scene-voiced.test.ts` — framing
    includes the transcript window, excludes whispers not aimed at the seat,
    omits tools, includes Taboo, tolerates recall failure, clamps maxTokens.
  - `lib/services/announcer/__tests__/character-voiced.test.ts` — snapshot of
    the composed messages before and after the refactor.
  - `__tests__/unit/app/api/v1/chats/impersonation-voice-preview.test.ts` —
    404 unknown participant, 400 not impersonated, 400 no profile, profile
    fallback order, happy path.
  - `app/salon/[id]/hooks/__tests__/useImpersonationVoice.test.ts` — the gate
    function's five rules; bypass-once semantics.
  - `__tests__/unit/components/settings/ImpersonationVoiceSettings.test.tsx`
    — toggle round-trip (mirror the spellcheck toggle test if one exists,
    otherwise the `ComposerGutterTools` test is the nearest pattern).
- **`docs/CHANGELOG.md`** under `4.10-dev`, plain American English:
  "Added: impersonated lines can be restated in the character's own voice
  before posting (Settings → Chat → Composer, default off)."
- `docs/developer/features/ROADMAP.md`: tick the bullet added with this plan.

## Risks and mitigations

- **The rewrite mangles machinery in the draft** (dice notation for Pascal's
  auto-detect, `@Name` addresses, Markdown links). Mitigation: the framing
  instructs verbatim preservation; Carina addresses bypass the gate outright;
  the operator always sees the proposal before it posts. If a pattern proves
  fragile in practice, add it to the bypass list rather than the prompt.
- **A slow or dead provider traps the draft.** Mitigation: the dialog never
  disables "Send as written" or "Edit original" once the preview has failed;
  the request honours the profile's `requestTimeoutMs` like any other call.
- **Moderated chats.** A refusal from a moderated profile surfaces as a normal
  preview failure — it never escalates on its own (same principle as bug 133).
  Reusing the turn path's uncensored-profile resolution keeps a flagged chat's
  rewrite on the same provider its turns already use.
- **Compiled identity stack mismatch.** Under the overlay the seat's stack was
  compiled as an LLM character with the owner persona as `{{user}}`; that is
  the correct voice, and the fallback (`buildIdentityStack` fresh) covers a
  chat whose stack was never compiled.
- **Concurrency with turn skipping / fair rotation.** None: the posted message
  goes through the unchanged send path, so `speakingAsParticipantId`, the
  multi-seat pause, and the Skip banner all behave as today.

## Open questions (answer before Phase 3; defaults are the recommendation)

1. Should the proposal be shown as a diff against the draft? **Default: no.**
   Two editors side by side match the announcement dialog and are enough.
2. Should the dialog remember a profile override per seat for the session?
   **Default: no** — the seat's own profile is the right default nearly always.
3. Should the owner persona seat be included behind a second toggle later?
   **Default: revisit after use.** Kept out of scope on purpose (see Non-goals).
