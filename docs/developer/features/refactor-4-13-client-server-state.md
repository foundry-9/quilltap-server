# Refactor 4.13 — Client server-state: the remaining hand-rolled reads and writes

**Status:** Proposed (2026-11-10), written against `HEAD` = 167d06503. Part of the [4.13 refactor set](refactor-4-13.md). Fixes #170 and #176 and closes the class behind several unfiled findings in §4.2.

Counts and line numbers are the audit's and will drift. Re-measure before starting.

## 1. The problem

The TanStack Query migration is recorded as complete, and SWR is gone. What it left is fetch logic that never used SWR in the first place: `useEffect` + `useState` + `fetch`. The audit counted 137 GET-shaped raw fetches in 89 files beside 165 `useQuery` sites; 67 of the raw ones, in 50 files, are pure effect-and-state loaders.

Server state held in component state has three failure modes, and each has a filed or traced bug:

| Failure | Example |
|---|---|
| **A refetch overwrites what the user is typing.** | `useProjectDetail.fetchProject` reseeds `editForm` from the server on every call; a tab switch back or a roster change discards typed instructions and Save then writes the old text (#170). |
| **A write goes around the shared helper and gets the body shape wrong.** | `ChatSidebar.tsx` has five hand-rolled chat PUTs beside one that uses `lib/chat/patch-chat.ts`; one of the five sends its field at the wrong level and never saves (#176). |
| **Another view's list is stale, and realtime cannot fix it**, because the list is not in the query cache for a topic to invalidate. | The Settings "by kind" profile tabs never invalidate the shared lists, so a created profile is missing from every dropdown on the page and a deleted one can still be picked (§4.2). |

Two concentrated cases:

- `components/settings/chat-settings/hooks/useChatSettings.ts:207-786` is 32 `useCallback` blocks of about 16 lines, each calling `patchChatSettings` (`:170-205`) with one key. Five other writers PUT the same endpoint by hand (`AutoLockSettingsCard.tsx:73`, `core-whisper/CoreWhisperSection.tsx:50`, `useRoleplayTemplates.ts:236`, `providers/avatar-display-provider.tsx:119`, `setup-wizard/wizard-api.ts:242`). `patchChatSettings` swallows failures (console only); three of the others write the response into the cache and one does not.
- The same endpoints are fetched with inline `queryFn`s and raw fetches side by side: the characters list 11 inline + 4 raw with no shared hook; connection profiles 5 + 8 beside a shared hook whose `select` is too narrow; image profiles 6 + 4; API keys 4 + 3; projects 6 + 1; roleplay templates 4.

## 2. Goal

- Every list or detail read of an entity goes through one hook per entity, keyed by `lib/query/keys.ts`.
- Every write of chat settings and of a chat goes through one mutation helper each, which updates or invalidates the cache and reports failure to the user.
- A form's draft state is never reseeded by a refetch while it is dirty.

## 3. Non-goals

- The Salon's SSE stream.
- Character autosave (`useCharacterAutosave`, `autosave-bindings`): audited and sound; drafts survive refetch and optimistic saves roll back. It is the model for §5.3.
- One-shot action POSTs that return nothing cacheable (generate, test connection). They stay as plain calls.
- `ChatSidebar.tsx`'s 1,915 lines as a file-split exercise. Its ten components can move to their own files in passing, but only the five PUTs are in scope.

## 4. Known state

### 4.1 Verified by reading (2026-11-10)

- `useProjectDetail.ts:46-55`: `fetchProject` always calls `setEditForm`; `ProjectDetailView.tsx:123-129` skips the refetch only while the header's `isEditing` is true.
- `ChatSidebar.tsx:1142-1148` sends `{ alertCharactersOfLanternImages }` at the top level; `chatUpdateRequestSchema` (`app/api/v1/chats/[id]/schemas.ts:132-155`) has it only under `chat` and is not strict.

### 4.2 Traced by the audit, not independently re-verified

Confirm each with a test; file what reproduces (confirm with the human before filing).

- **Profile lists never invalidated**: `components/settings/connection-profiles/hooks/useConnectionProfiles.ts:100-123, 164-180` (232 lines, six fetches, cache-busts with `?t=`), `embedding-profiles/index.tsx:37` and `hooks/useEmbeddingProfiles.ts` (161), `image-profiles-tab.tsx:99-123`; consumer `chat-settings/hooks/useChatSettings.ts:106-117`.
- **Not refreshable by realtime**: `app/scriptorium/hooks/useDocumentStores.ts` (270 lines), `app/prospero/hooks/useProjects.ts` (103), `components/settings/plugins-tab.tsx` (18 `useState`s).
- **Cache not re-seeded after save**: `PluginConfigModal.tsx:93-118`, `tools/memory-recall-card.tsx:86-103`. Reopening within the stale time shows, and can re-save, pre-save values.
- **`ChatToolSettingsModal.tsx:68-72`**: an effect keyed on array identity resets unsaved toggles on every chat refetch. The effect is verified; the user-visible loss is the audit's reading.
- **CreateNPCDialog**: a new NPC is not in the picker (`:226-229`, no `characters.list()` invalidation).
- **Embedding profile edit cannot clear** Dimensions, Base URL or API key (`embedding-profiles/ProfileModal.tsx:93-96`, `|| undefined` dropped by JSON). Same shape as fixed bugs 73 and 76.
- **Salon list**: importing a chat does not show it (`app/salon/SalonListView.tsx:169-173` omits the `mutateChats()` its siblings call).
- **Wardrobe dialog keeps the old project tier** after a chat is moved: `queryKeys.chats.project(chatId)` has `staleTime: Infinity` (`lib/hooks/use-character-wardrobe-items.ts:74-86`) and nothing invalidates it.
- **No stale-response guard** on search-as-you-type: `components/memory/memory-list.tsx:87-133`, `character/character-conversations-tab.tsx:66-100`, `search-dialog.tsx:61-74, 149-210`. `useQuery` with the term in the key gives this for free.
- **`useChatSettings.ts:190-193`**: every failed settings PUT is console-only.
- **LLM log retention** saves on every keystroke (`LLMLoggingSettings.tsx:80-81`): typing "60" over "30" PUTs 6 first, and emptying the field sends 0, which means unlimited.

## 5. Design

### 5.1 Entity hooks

In `lib/hooks/` (or beside the existing shared hooks), one per entity that lacks one or has a too-narrow one: `useCharactersList(filters)`, `useConnectionProfiles()`, `useImageProfiles()`, `useEmbeddingProfiles()`, `useApiKeys()`, `useProjects()`, `useDocumentStores()`, `useRoleplayTemplates()`, `usePlugins()`. Each is `useQuery({ queryKey: queryKeys.x.list(...), queryFn: ({ signal }) => apiFetch(url, { signal }) })`; callers narrow with their own `select`. The inline `queryFn`s and raw fetches for those endpoints are replaced by the hook.

For each new key namespace, consider the row in `REALTIME_TOPICS` and `lib/realtime/topic-map.ts`, as CLAUDE.md requires, so the `projects` and `mountPoints` topics actually refresh these lists.

### 5.2 Two mutation helpers

- `useChatSettingsMutation()` wraps `patchChatSettings`: optimistic `setQueryData`, rollback and an error toast on failure, the response written to the cache. `useChatSettings` becomes a table: `const set = <K extends keyof ChatSettings>(key: K) => (value: ChatSettings[K]) => mutate({ [key]: value })`, with the handful of setters that do more than set one key kept as named functions. The five hand-rolled writers call the mutation.
- `usePatchChat(chatId)` wraps `lib/chat/patch-chat.ts` the same way. The five PUTs in `ChatSidebar.tsx` (`:1097`, `:1120`, `:1142`, `:1189`, `:1217`) call it. Then make `chatUpdateRequestSchema` strict (`z.strictObject`) so a misplaced key is a 400 instead of a silent strip; that is the server-side guard against the next #176.

### 5.3 Draft state

One small hook, `useDraft(serverValue)`, returning `[draft, setDraft, { dirty, reset }]`: it adopts a new `serverValue` only while not dirty. `useProjectDetail`, `ChatToolSettingsModal` and any form the audit lists under "wiped on refetch" use it. The project page's three editors (header, instructions, settings card) each save only their own fields.

Number inputs that save on change (`LLMLoggingSettings`) save on blur or after a debounce, and an empty field is "no change", not 0.

## 6. Phases

1. **#170 and #176 in place**, each with a failing test first. Make the chat update schema strict.
2. **`useChatSettingsMutation`** and the table; the five outside writers.
3. **`usePatchChat`**; the sidebar PUTs.
4. **Entity hooks**, one entity per change, in this order: connection / embedding / image profiles (fixes the stale dropdowns), document stores and projects (realtime), characters list, the rest.
5. **`useDraft`** adoption and the remaining §4.2 items that reproduced.

## 7. Tests and gates

- Wrap with `renderWithQuery` / `createQueryWrapper`; `fetch` stays mocked through `jest-fetch-mock`.
- For each entity hook: creating or deleting through one view updates a second view mounted on the same client.
- `@tanstack/query/exhaustive-deps` is on; do not add disables. Nineteen existing `eslint-disable` comments still cite "SWR" as their reason (see the [dead-code list](refactor-4-13-dead-code-and-leftovers.md)); correct or remove the ones in files you touch.
- Expected size: 650–900 lines removed (350–450 from `useChatSettings`, 300–450 from the legacy hooks); medium risk, spread thin.
- CHANGELOG cites `#170`, `#176` and any issue filed from §4.2. Help docs only if a setting's save behaviour visibly changes (the retention field).

## 8. Decisions for the human

1. Strict chat update schema: reject unknown top-level keys with 400 (proposed)? Any external client relying on the lenient form?
2. A failed settings save: toast and roll the control back (proposed), or toast and leave the control as the user set it?
