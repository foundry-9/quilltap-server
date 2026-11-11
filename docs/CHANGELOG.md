# Quilltap Changelog

## Recent Changes

### 4.13-dev

#### Refactor: item-family kernel (phase 5: item pictures)

- `createItemImages` (`lib/mount-index/item-family-images.ts`) owns the Atlas's and the Inventory's pictures: list (with a parent's pictures showing through, marked `inherited`), add, set-current, delete, cleanup, transfer carry, home resolution, and synchronous generation through the Concierge's image failover. `lib/atlas/item-images.ts` and `lib/inventory/item-images.ts` are bindings with their subject prompt, wording and log type; the two `item-image-generation.ts` files re-export the generation names. All exported names are unchanged.
- The images routes were already adapters of the 4.12 `createItemImagesRoute`; they still call the families' named exports. The Wardrobe's route stays as it is: its extra lines are its own `link-image` action and error mapping, already on the shared factory.

#### Refactor: item-family kernel (phase 4: the folder store)

- `createItemFolderStore` (`lib/mount-index/item-store.ts`) is the one writer of an item family's folder: create, batched update (with `remove` keys and `requireAll`), delete (with follow-on patches), the five folder operations, and an in-lock write `guard`, each serialised per folder and parsing the folder once. The Atlas and the Inventory `vault-writes.ts` are bindings of it with their serialiser and scan (the Inventory also passes its title-lint mark as `wrapWrite`); their exported names are unchanged. `locationWriter` and `cleanPatch` are the location write wrapper both locations used to copy.
- `defineItemFolderErrors` and `defineItemFolderFamily` (`lib/mount-index/item-folders.ts`, client-safe) replace the three copies of the four folder-error subclasses and the folder-helper delegates; the Wardrobe, Inventory and Atlas `folders.ts` are bindings. The tier reader moved to `item-tiers.ts` (re-exported by the kernel) so a pool does not load the writer.
- New kernel test (`__tests__/unit/lib/mount-index/item-store.test.ts`) binds the store with a toy serialiser. The Atlas chokepoint test holds that only the two `vault-writes.ts` bind the store and no family projects its folder directly.

#### Refactor: item-family kernel (phase 3: one name fold)

- `foldItemName` (`lib/mount-index/item-names.ts`, client-safe; re-exported by the kernel) is NFC + trim + locale-free lower case, and is the one fold for comparing item names and titles: the Atlas pool's shadowing key, its matcher terms, the vault scan's duplicate-name warning, the uniqueness rule and transfers; the Inventory's references, kin rule and title lint; the Wardrobe's title match and copy titles. The Atlas used `toLocaleLowerCase` in some sites and `toLowerCase` in others, so under a Turkish locale its uniqueness rule and its matcher could disagree; some sites also skipped the trim.
- The Atlas's free-name check ran before the write's lock, so two concurrent creates of one name both passed. It is now a write guard run inside the folder's write chain against the current records (`location.create` / `update` take `{ guard }`).

#### Refactor: item-family kernel (phase 2: one tier reader)

- New `lib/mount-index/item-store.ts`, the item-store kernel shared by the Wardrobe, the Inventory and the Atlas. `readTiers` reads a reach's tiers (concurrently, each tier's mounts strongest first) and returns `{ layers, unread, consulted }` in tier order; `shadowLayers` shadows them strongest first, first claim wins. All three pools build from it, so the Inventory no longer reads each tier reversed and shadows last-wins.
- Every pool now knows what it failed to read: the Atlas pool and cast view gained `unread` (they swallowed a failed tier), and the wearable pool gained `unread` (the repository swallowed a failed shared store; it now reads one mount at a time with `readSharedTiers(..., { strict: true })`). The Inventory's `consultedMounts` lists a tier's mounts strongest first.

#### Refactor: item-family kernel (phase 1: #186)

- #186: one failed read of an Inventory tier made the next equip, unequip or pick-up rewrite the carried set without every object carried from that tier. The rewrite now keeps any stored id the pool could not resolve while a tier is unread (`heldForUnreadTiers`, `lib/inventory/equipped-set.ts`); with every tier read, an unresolvable id is still pruned. The Wardrobe does not share the shape: it edits the stored slots, never a pool-filtered copy.

#### Refactor: client server-state (phase 5: drafts and stale answers)

- The chat's LLM tool settings dialog reset unsaved toggles on every chat refetch (an effect keyed on array identity). Its two lists are `useDraft`s over the chat's values, so a refetch with the same values keeps the toggles; Cancel discards them. Its tool list is a query (`queryKeys.tools.availability`).
- Search as you type: the character memory list, a character's conversation list and the global search dialog put the term (and the dialog's type filter) in the query key, so a slow answer for an earlier term can no longer replace the current one. The memory and conversation lists keep the previous page on screen while the next loads; the search dialog pages with `useInfiniteQuery`. New keys `memories.list`, `characters.chats` / `chatLists`, `uiSearch`. The memory list had no guard at all; the dialog's guarded the term but not the filter.
- LLM log retention saved on every keystroke: typing "60" over "30" saved 6 first, and emptying the field saved 0, which means unlimited. It now saves on blur or Enter, restores the saved value for an empty or non-numeric entry, and clamps to 0–365. Help updated.
- Importing a chat from the Salon list now refreshes the list; it highlighted a chat that was not shown until the next refetch.
- `GenerateImageView` derives its character options instead of copying them into state; the eslint-disable reasons in touched files no longer cite SWR.

#### Refactor: client server-state (phase 4: plugins; saved values re-seeded)

- The Plugins tab reads the registry, the installed list, the deployment shape and the upgrade check as queries (`usePluginsQuery`, `lib/hooks/use-plugins.ts`; keys `plugins.list` / `installed` / `upgrades`, `system.deployment`) instead of eleven pieces of component state. Enable, disable, install, uninstall, upgrade and a config save invalidate `plugins.all`, which also refreshes the attention strip's plugin-error count.
- The plugin config dialog's form is a `useDraft` over the cached config, and a save writes the saved config back into the cache. Reopening within the stale time showed, and could re-save, the pre-save values.
- The memory recall card writes the saved settings into `memories.recallConfig`, for the same reason.

#### Refactor: client server-state (phase 4: the character list)

- New `useCharactersList(filters)` (`lib/hooks/use-characters-list.ts`): the one read of `GET /api/v1/characters`. Its filters (`controlledBy`, `archived`, `npc`) are the endpoint's query parameters and are folded into `queryKeys.characters.list(filters)`. Eleven inline `queryFn`s (New Chat, the Salon list, Add Character, Compose Mail, Generate Image, the mention typeahead, the spellcheck feed, Save Scenario, the container catalogue, the project roster card, the entity search), the persona reads (`useUserCharacterDisplayName`, the character page's user-character list), the Aurora roster, and four effect loaders (group members, the image detail modal, Insert Announcement, search-and-replace scope) now use it, so a character created or archived anywhere shows in all of them.
- The shared list hooks' `select` wrapper (`useEnvelopeSelect`) is stable while the caller's `select` is, so TanStack memoises its result (`useUserCharacterDisplayName` depends on a stable `Set`).

#### Refactor: client server-state (phase 4: projects and document stores)

- The Prospero project list and the Scriptorium store list read shared queries (`useProjectsQuery`, `lib/hooks/use-projects.ts`; `useDocumentStoresQuery`, `lib/hooks/use-document-stores.ts`) instead of component state, so the `projects` and `mountPoints` realtime topics now refresh them: a background scan, embedding pass or conversion shows without a tab switch. Creates and deletes invalidate the shared keys, so the New Chat dialog, the move-to-project and library pickers, Save Scenario, the container catalogue and the document destination dialog see them. The Scriptorium's optimistic scan and conversion states edit the cached list. New key prefix `queryKeys.projects.lists`.

#### Refactor: client server-state (phase 4: profile, key and template lists)

- The Settings "by kind" connection, embedding and image profile tabs read the shared list queries instead of private copies, and their writes (create, edit, delete, reorder, reset sort, auto-configure) invalidate the shared key. A profile created there now shows in every dropdown on the page and in the by-provider card at once; a deleted one disappears. The connection tab's `?t=` cache-buster and an unused function that fetched every chat to count messages are gone.
- Every reader of `/api/v1/connection-profiles`, `/image-profiles`, `/embedding-profiles`, `/api-keys` and `/roleplay-templates` goes through `lib/hooks/use-profiles.ts`: the New Chat dialog, the Salon sidebar and list, Add Character, Create NPC, the participant controls, the wardrobe image panes, the project Model Behavior card, the API keys tab, the attention strip, the External Prompt and AI Wizard / AI Import flows, and the Select Profile, Insert Announcement and Impersonation Voice dialogs. `hooks/useConnectionProfiles` is a `select` over the shared list. `ImageProfilePicker` keeps its server-side sort and reads `queryKeys.imageProfiles.sorted(...)`, under the `image-profiles` prefix.
- Create NPC: the new character now appears in the character pickers (it did not invalidate the character list). Its connection profile defaults to the first in the list without an effect.
- The API keys tab invalidates the shared key list after a write, so the profile modals' key pickers see a new key.

#### Refactor: client server-state (phases 1–3)

- #170: project instructions typed before a tab switch, a roster change or a realtime hint were overwritten by the refetch, and Save then wrote the old text. New `useDraft(serverValue)` (`lib/hooks/use-draft.ts`) holds a form's draft and adopts a new server value only while the draft is clean, or when the server value already equals it. `useProjectDetail` reads the project through `queryKeys.projects.detail` and keeps two drafts: the header (name, description) and the instructions, each saving only its own fields. The instructions Save is disabled while nothing has changed. The unused `SettingsTab` component is gone.
- #176: "Announce Generated Images" in the Salon sidebar sent `alertCharactersOfLanternImages` at the top level of the chat update, where it was stripped, so it never saved. It now goes under `chat`. `chatUpdateRequestSchema` is strict: an unknown top-level key is a 400.
- New `usePatchChat(chatId)` (`lib/chat/use-patch-chat.ts`) over `putChatUpdate` / `patchChat` (`lib/chat/patch-chat.ts`, now typed from the route's schemas): toasts the server's error, runs `onSaved`, and invalidates the chat's detail, the chat lists and `chats.project(id)`. The sidebar's template, image profile, Lantern, clock and Concierge selects, `ChatRenameModal` and `ChatProjectModal` write through it; moving a chat to another project now refreshes an open wardrobe's project tier, which had `staleTime: Infinity` and was never invalidated.
- New `useChatSettingsMutation()` / `putChatSettings` (`hooks/useChatSettingsMutation.ts`): the one writer of `PUT /api/v1/settings/chat`. It applies the patch to the cached row at once, writes the server row on success, and on failure rolls back, re-reads and toasts the server's sentence. Failed settings saves were console-only.
- `useChatSettings` (831 lines) is a table of `set(key)` / `merge(key, defaults)` setters over the mutation (228 lines). Nested merges read the cached row at call time, so two quick changes to one object no longer lose each other.
- The Auto-Lock card, the Core whisper card, the roleplay-template default picker, the Avatar Display provider and the setup wizard write through the mutation. The Avatar Display provider reads the style from the shared settings query, so `syncStyle` / `syncAvatarDisplayStyle` are gone. The Auto-Lock minutes field keeps its typed value across a refetch, and an unusable number restores the saved one instead of being saved. A passphrase change now refreshes the card (the listener was a no-op).
- New list hooks in `lib/hooks/use-profiles.ts`: `useConnectionProfilesQuery`, `useImageProfilesQuery`, `useEmbeddingProfilesQuery`, `useApiKeysQuery`, `useRoleplayTemplatesQuery`, each the one `useQuery` for its endpoint with a caller-supplied `select`, plus `useInvalidateProfileLists`. The setup wizard invalidates the profile and key lists when it finishes.

#### Refactor: one Salon stream lifecycle

- #172: Enter in the composer during a Continue, nudge, opening or storyteller run started a second turn stream over the first. `useSSEStreaming` now holds one in-flight claim (`isStreamInFlight`) that every lifecycle takes and checks; a send refused by it shows the "still speaking" toast and leaves the text in the composer. The composer's Enter path and Send button ask the same question. A claim is released only by its own stream's `finally` (or by Stop's local abandon), so an abandoned stream cannot clear a newer one's.
- #173: one failed chat read left the Salon on its full-page error screen for the life of the tab. `useChatData` clears `error` on a successful read; `SalonView` shows the error screen only when there is no chat, and a failed refresh of a chat on screen is a toast.
- `useSSEStreaming` (1,846 lines) split: pure helpers and shared types in `stream-helpers.ts` (re-exported from the hook), the rAF content/reasoning buffers in `useStreamingBuffers`, live tool batches in `useStreamingToolBatches`, and the frame reader in `readTurnStream` (`read-turn-stream.ts`), a plain async function with no React, now unit-tested per frame kind. The four lifecycles (send, open, continue, storyteller) are request builders over one `runTurnStream`, which owns the abort controller, the claim, the shared frame handlers and the one `finally`; the hook is about 1,080 lines. `sending` is derived (`streamKind === 'send'`) and `abortControllerRef` is no longer returned. A stream abandoned by Stop no longer runs its `finally` over a stream started after it.
- Storyteller runs notify the queue badges on `chainComplete` as continue runs do (they did so only in their `finally`).
- `SalonView` (2,419 lines) lost the avatar watch, avatar timeline and `getMessageAvatar` to `useSalonAvatars`, and in-conversation search and message reveal to `useMessageReveal`; about 2,070 lines remain.
- `components/providers/chat-context.tsx` was never mounted. It is now `ChatActionsProvider` / `useChatActions`, mounted by `SalonView` around the sidebar, carrying the 13 participant-card actions (`onNudge`, `onQueue`, `onDequeue`, `onTalkativenessChange`, `onRemoveCharacter`, `onImpersonate`, `onStopImpersonate`, `connectionProfiles`, `onConnectionProfileChange`, `onSystemPromptChange`, `onSubpromptsChange`, `onRebuildSystemPrompt`, `onRegenerateAvatar`) that were threaded through `ChatSidebar` and `ParticipantsSection` untouched. `ChatSidebarProps` no longer has them.
- Removed `SalonView`'s quick-hide check. It read the unmounted context, so it never hid anything.

#### CI

- The Test job's zsh install retries three times and, if the runner's Ubuntu mirror is still unreachable, posts a warning and continues instead of failing the job. Only the zsh completion-template parse check is skipped in that case. Every CI run on 2026-11-11 had failed at this step on `Temporary failure resolving 'azure.archive.ubuntu.com'` before any test ran.

#### Refactor: API inputs validated by schemas (phases 1–6)

- #165: SillyTavern character export (JSON and PNG) and chat JSONL export returned 500 for a name with characters above U+00FF and broke on a `"`. They, the theme export, the backup download and the two `system/tools` downloads now build `Content-Disposition` with `buildContentDisposition`. A grep-test forbids a hand-spelled `filename=` header.
- #166: an invalid body to `POST`/`DELETE /api/v1/projects/[id]/mount-points`, `PATCH /api/v1/mount-points/[id]` or `?action=close-document` was a 500; the `ZodError` now reaches the middleware, which answers 400.
- #167: new `readPagination(req, { defaultLimit, maxLimit })` (`lib/api/query-params.ts`) clamps `limit` to `[1, maxLimit]`, treats a negative or non-numeric value as the default, and keeps `offset >= 0`. Used by `llm-logs`, `ui/search`, project chats, character chats and the chat list. `GET /api/v1/llm-logs` pages the recent, type and standalone listings in SQL (`findRecent` / `findByType` / `findStandalone` take an offset) and reports `total` from `countByScope`; `offset` used to return an empty page and `limit=-1` read every row.
- #168: `POST /api/v1/messages/[id]?action=swipe` with a malformed `swipeIndex` returns 400 instead of running a regeneration; `DELETE` validates `memoryAction` against the enum instead of casting it.
- `PUT /api/v1/settings/chat` validates with `ChatSettingsPutSchema` (`patchSchemaOf(ChatSettingsSchema)`, strict, server-owned columns omitted). The 36-argument validator, the hand `ACCEPTED_KEYS` set and the 400-or-500 choice by `errorMessage.includes('Invalid')` are gone. Nested objects validate against their full sub-schema, so a `null` or malformed nested object is refused and unknown nested keys are dropped. `avatarDisplayStyle` must be `CIRCULAR` or `RECTANGULAR`; `contextCompressionSettings` is held to its schema's bounds.
- `patchSchemaOf` also strips a `.default()` under an `.optional()` or `.nullable()`. `sidebarWidth: z.number().default(256).optional()` kept its default, so any chat-settings patch would have reset the sidebar width.
- Connection profile create and update validate with `ConnectionProfileCreateSchema` / `ConnectionProfileUpdateSchema` (`lib/llm/connection-profile-input.ts`, derived from `ConnectionProfileSchema`, strict); the fallback and API-key rules are one `checkConnectionProfileReferences` and Courier forcing is one `applyCourierForcing`. Create now refuses a `null` or string `parameters`, a non-boolean flag, a string `courierDeltaMode` and an unknown `pseudoToolMode` (previously stored, coerced, or silently turned into `auto`). About 330 lines left the two routes.
- Image and embedding profiles likewise (`lib/image-gen/image-profile-input.ts`, `lib/embedding/embedding-profile-input.ts`), on shared identity fields in `lib/schemas/profile-input.ts`. An image-profile update with an empty `apiKeyId` cleared it instead of answering 404; an embedding profile's `provider` is checked against its enum instead of cast. The embedding profile editor sends `null` for a cleared key, URL or dimension count; it sent `undefined`, which JSON drops, so an edit could never clear them.
- `validationError` responses carry a `message` summarising the issues (`name: Name is required`); `fetchJson` and the image profile form show it instead of "Validation error" (`readErrorMessage`, `lib/fetch-helpers.ts`).
- `jest.setup.ts` stubs `requiresBaseUrl` beside the other provider-validation questions.
- `projects/[id]/mount-points` and `groups/[id]/mount-points` are one factory, `createOwnerMountLinkRoutes` (`lib/mount-index/owner-mount-links-routes.ts`). The group GET now also returns `officialMountPointId`. Unlink takes `?mountPointId=`; the old DELETE body is read for one release with a warning, and both clients send the query.
- Schemas replace the hand checks in `api-keys` (create, update, test, export, import, import-preview; `lib/api-keys/api-key-input.ts`), `roleplay-templates` create and update (`lib/roleplay-templates/template-input.ts`), `system/jobs` POST (type, object payload, integer `priority`, `maxAttempts` 1–20; `priority` and `maxAttempts` of the wrong type used to be dropped silently), `system/restore` (preview and restore), `chats/[id]/files` (`link`, `attach-mount-file`), `plugins/[name]` PUT (`enabled` must be a boolean; any value was accepted) and `mount-points/[id]?action=delete-file`. The API-key import dialog shows the validation message.
- `app/api/v1/system/tools/route.ts` (1,187 lines) is a dispatch table over six modules in `lib/system-tools/`, each with Zod schemas for its bodies and queries and `RequestContext` in place of `context: any`. An export with no `type`, an unknown export `scope`, a non-object `exportData` and a malformed Almanack generate body are now 400s.
- `GET /api/v1/tools` maps over `BUILT_IN_TOOL_PICKER` (`lib/tools/tool-picker.ts`): each built-in tool's display name, description, category, definition and availability requirements in one entry, or an unlisted entry with a reason. The route went from 890 to 303 lines; the snapshot test fails on a declared tool with no picker entry. `doc_copy_file` now has the same project-and-stores availability rule as the other `doc_*` tools, and `?includeSchemas=true` serves parameters for every listed tool (the old hand map missed some). Thirteen character tools stay unlisted pending a decision on the picker.
- `PUT /api/v1/chats/[id]` no longer accepts `chat.contextSummary` (it was written with no anchor or turn bookkeeping), and a `title` sent without `isManuallyRenamed` marks the chat manually renamed.
- `GET /api/v1/settings/chat` answers the defaults for a user with no saved settings instead of creating the row; the first PUT creates it.
- Manual memory create answers success with a `warning` when the keystone mark is refused after the memory is saved (it answered 400, which read as "nothing saved"); the memory editor shows the warning.
- `GET /api/v1/models` no longer reads or echoes `hasVision` / `hasStreaming`, which were never applied (cached model rows record neither).
- Path-segment and body-discriminator actions moved to `?action=`: `wardrobe?action=analyze-image|preview-avatar|move-to-tier|copy-to-tier`, `atlas` and `inventory` `?action=move-to-tier|copy-to-tier`, `groups?action=scenarios`, `system/plugins?action=state|initialize|upgrades|mark-upgrades-notified`, `system/directories` (was `system/browse-directory`), `chats/[id]?action=turn-nudge|turn-queue|turn-dequeue|turn-query|turn-skip-user`, and `system/tools?action=tasks-queue-start|tasks-queue-stop`. The old forms answer until 4.14 through `deprecatedPath` (`lib/api/deprecated-path.ts`: one warning per path, `Deprecation` and `Link` headers). All clients use the new forms. The item-family factories take `extraGetActions` / `extraPostActions` for actions only the General route answers. `files/proxy/[...key]` and `chats/[id]/qtap-target` stay path-addressed (the page-CSP exemption in `next.config.js` matches paths, and proxy URLs are stored in content); `search-replace` already dispatched on `?action=`.
- GETs no longer write. The default chat GET's housekeeping (cold-chunk re-embed, terminal reconcile, operator mail) is `POST /api/v1/chats/[id]?action=visit`, which the Salon posts before each full read. `?action=mailbox` reads the character's vault pointer instead of creating a vault. `GET /api/v1/system/jobs` no longer starts the processor; boot starts it (after unlock), as does every enqueue — so the toolbar poll no longer restarts a processor the operator stopped.
- The tool picker lists `read_conversation`, `upsert_annotation`, `delete_annotation`, `terminal_list`, `terminal_read`, `doc_open_document`, `doc_close_document` and `doc_focus`, which every character was offered but nobody could switch off. `doc_move_folder` and the four `doc_*_blob` tools stay unlisted: no surface offers them.

#### Fix: standalone document tab saves (follow-up to #174 / #175)

- The workspace's standalone document tab (`components/workspace/StandaloneDocumentView.tsx`) had the same two save bugs as Document Mode. `saveDocument` now records the text it sent as saved and writes text typed during the save in the same run, one save at a time, and returns whether everything was written. Closing or renaming after a refused save (409 or any error) keeps the tab open with its text and shows a toast. The toast text (`UNSAVED_EDITS_MESSAGE`) is shared from `useDocumentMode.ts`.

#### Fix: nine audit bugs (#164, #169, #174, #175, #177, #178, #183, #184, #185)

- #164: bulk re-attribute (`?action=bulk-reattribute`) updates only the affected rows' `participantId` through `updateMessage`. It used to clear the transcript and replay every row through `addMessage`, which reset `lastMessageAt` and the cycle state, bumped the transcript once per row, ran in O(N²), and lost every row after a failed insert. A row that fails to update is logged and the rest stay in place.
- #169: the Scriptorium list's Edit dialog mounts per store (`key={store.id}`) and sends only changed fields; an emptied pattern field sends `[]`. It used to open with Filesystem / Documents / Enabled and save those over the store. The mount-point PATCH refuses a `storeType` or `mountType` change on a live character vault, as it already refused a rename.
- #174: Document Mode records the text it actually sent as saved. Text typed during a save stays dirty and is written by the same save run before it resolves. One save runs per document; a second call joins it.
- #175: `saveDocument` returns whether everything was written. Closing or renaming after a refused save (409 or any error) keeps the pane open with its text and shows a toast.
- #177: already fixed in 11bc7b59a (an explicit `imageProfileId: null` is sent and honored); added the project-default case to `cast.test.ts`.
- #178: the import memory-creation dialog posts to `/api/v1/chats/[id]?action=queue-memories` with an empty body, instead of the nonexistent `/queue-memories` path. The server's error message is shown on failure.
- #183: a swipe regeneration whose stream yields no content throws before any write, so no blank swipe is saved and the original line's memories are not retired.
- #184: wearing a composite leaves its archived components off unless already worn (`analyzeComposite` / `dissolveCompositeToLeaves` take the worn set; `WearableNode` carries `archivedAt`). A composite whose every part is archived puts nothing on. `wardrobe_create` refuses an archived component.
- #185: an ordinary send to a chat whose opening has not run runs the opening first, without the greeting, on the send's stream (`openBeforeSend`). Autonomous rooms are left to their run start.

#### Refactor: the job queue's dedupe rule and the query translator's quiet failures

- #192: memory text search treated user text as a regex turned into `LIKE`. Escaped punctuation (`Mr. Darcy (the elder)`) became literal backslashes and matched nothing; `.`, `%` and `_` were wildcards. New filter operators `$contains` and `$startsWith` (`LIKE … ESCAPE '\'`, value escaped by `like-escape.ts`) replace it in `searchByContent`, `countMemoriesWithText`, `findMemoriesWithText` and `searchByContentAboutCharacter`. `$regex` now throws on a pattern containing a backslash; `AbstractBaseRepository.escapeRegex` is removed.
- The translator refuses what it cannot translate with a `QueryTranslationError` (`lib/database/query-translation-error.ts`): a sort on a field that is not a column (checked against the live table's `PRAGMA table_info`), an unknown filter operator (previously dropped from the filter), an unsupported array-object or `$expr` operator. `safeQuery` rethrows it even in fallback mode, so it never reads as "no rows".
- #194: DEAD jobs were never reaped: the reaper keys on `completedAt`, which no path to DEAD wrote. `markFailed` (at max attempts), `cancel`, `cancelByType` and `resetAllProcessingJobs` now stamp it; migration `backfill-dead-job-completed-at-v1` sets `completedAt = updatedAt` on existing DEAD rows. `resetStuckJobs` sends a stuck job at its last attempt to DEAD instead of FAILED, where it was never claimed or reaped again.
- One `enqueueDeduped(userId, type, payload, { key, absorbs, scope?, label })` replaces seventeen hand-rolled find-then-enqueue bodies in `queue-service.ts`. `absorbs` (`'pending'` or `'active'`) is required. `CONVERSATION_RENDER`, `SCENE_STATE_TRACKING`, `CHAT_DANGER_CLASSIFICATION`, `STORY_BACKGROUND_GENERATION` and `EMBEDDING_GENERATE` (single and batch) now dedupe on PENDING only: a running job read its inputs before the change. Memory extraction, Carina and established-fact memories, title updates, regenerations and head-and-shoulders backfill keep absorbing into a running job; each says why. The read is `backgroundJobs.findAbsorbers` (by type, status, user and one payload field, no row cap); the old reads through `findByUserId` saw only the newest 100 jobs. Maintenance enqueue reads through it too. `findPendingForEntity` is removed.
- Embedding writes for conversation and mount chunks are conditional: the job passes a hash of the text it embedded (`embeddedTextHash`), and `updateEmbedding` applies only if the row still holds that text. A chunk re-rendered or deleted while its job ran is skipped instead of getting a stale vector or failing the batch.
- The write applier transcodes `linkBlobContent` images before `BEGIN IMMEDIATE` and replays them with `normalizeImages: false`, so no real I/O runs inside a partition transaction; development builds log an error if a transaction body yields to the event loop.
- Filed the spec's remaining audit findings as #204, #205, #206 and #207 (not fixed here).
- `backgroundJobs.markCompleted` no longer takes a `result` argument (it wrote to a nonexistent `payload.result` column; no caller used it).
- Removed the `as any` casts in `background-jobs.repository.ts`, `chats-messages.ops.ts`, `chats-search.ops.ts`, `chats.repository.ts`, `chats-tokens.ops.ts` and `memories.repository.ts`, plus the casts on connection-profile `sortIndex`, help-chat `chatType` / `helpPageUrl` and `getRepositories()` at the terminal sites. New row types for the messages table (`ChatMessageRow`, `LegacyChatMessagesDoc`). The casts hid two type errors: `incrementTokenAggregates` typed `priceSource` as `string`, and `TerminalSessionsRepository.create` required `createdAt` / `updatedAt`.

#### Refactor: one insert policy and one id-field table for import and restore

- `.qtap` import and backup restore bring every row in through `insertUnderPolicy` (`lib/backup/insert-policy.ts`): skip maps to the existing row, overwrite keeps the existing id (updated in place, or removed and recreated under the same id), duplicate maps to the created row. Summaries count outcomes instead of array lengths.
- Both drive id remapping from one table, `ID_FIELDS` (`lib/backup/id-fields.ts`), through `remapEntity`: each id field's target kind and what happens when it does not resolve (`keep`, `null`, `drop-row`; never a minted id). `id-fields-guard.test.ts` walks every exported entity's Zod schema and fails on a UUID field that is neither listed nor exempt.
- #188: import Overwrite no longer deletes and recreates rows under new ids. Profiles, tags, templates, projects and groups update in place; characters, chats and files are recreated under the existing id. An overwritten profile keeps its API key. Built-in templates and archived characters are not overwritten.
- #195: import Duplicate maps every kind to the row it created.
- #193: annotations, chat documents, informs, outfit history and avatar timeline rows are imported only for chats the import wrote. Reconciliation rewrites only rows the import wrote, never skipped ones.
- #190: restore keeps prompt and roleplay template ids. Built-in roleplay templates have fixed UUIDv5 ids (`lib/roleplay-templates/built-in-ids.ts`); migration `rekey-built-in-roleplay-templates-v1` re-keys existing built-ins and their pointers in `characters`, `chats` (column and participants JSON) and `chat_settings`, and the boot step `rekeyProjectRoleplayTemplatePointers` updates project stores. A backup from before this change cannot identify which built-in a chat used; those pointers resolve to nothing and are cleared on a new-account restore.
- #199: new-account restore remaps `summaryAnchorMessageIds`, `archiveFileId` / `archivedAvatarFileId`, `consoleConnectionProfileId`, template pointers and ids inside message payloads; reissues `linkGroupId`; and no longer mints ids for references the backup does not carry. Sidecar rows whose chat or store is absent are dropped.
- Import now remaps a chat's `roleplayTemplateId`, `imageProfileId`, `consoleConnectionProfileId`, a character's `partnerLinks`, and character ids inside message payloads. An unknown summary anchor is dropped from the array instead of clearing the summary (decision §8.2); `plugin:*` template references are kept.
- #200: a groups-only import reattaches members and linked stores that already exist in the instance and warns about the rest.
- #201: an NDJSON export without its `__footer__` record is refused as truncated.
- #202: backup and data deletion read characters, projects and groups raw (`lib/backup/owned-rows.ts`), so a row whose store is unreadable is backed up as its bare row with its memories (noted in the new `manifest.warnings`, repeated at restore) and is deleted by a replace restore or delete-all. All LLM logs are backed up (paged) and deleted (`deleteByUserId`), not the newest 10,000.

#### Fix: null comparisons in SQLite filters (#198, by mikemikimike)

- #196: the LLM logs page's Standalone list was always empty. `findStandalone` filters with `$eq: null`, which the SQLite query translator bound as `= NULL`, a comparison that matches no row. Null comparisons are now written `IS NULL` / `IS NOT NULL` (`lib/database/backends/sqlite/query-translator.ts`): `$eq`, `$ne`, `$ieq`, a `null` inside `$in` / `$nin`, and `$eq` / `$ne` on a field inside an array column (`jsonArrayObjectMatch`).
- `$ne: value` and `$nin: [values]` now match rows where the column is NULL, as a Mongo-style filter should (`IS NOT ?`; `IS NULL OR NOT IN (…)`). Recent-conversation recaps no longer skip chats whose `chatType` is NULL.
- A nested array-column `$ne` bound the raw operand instead of the match's parameters.
- New real-SQLite tests for the translator's null cases and for `findStandalone` and the token-usage sums.

#### Test: deterministic outfit-selection concurrency check

- `applyOutfitSelections` "bounded by the slowest character" test no longer asserts a wall-clock bound (under 120 ms), which failed on a loaded CI runner with coverage on (231 ms). Each mocked selection now waits on a barrier that only opens once all four have started, so serial resolution fails and runner speed doesn't matter.

#### Refactor: one substitute call in provider failover

- Every failover stand-in (same-profile retry, the Concierge's uncensored understudy, each fallback-chain candidate) is called by `callSubstitute` (`lib/services/chat-message/provider-failover.service.ts`). It formats the turn's tools for the substitute's provider, re-applies the image transport budget and model params for it, streams it, and decides whether it answered.
- #181: a substitute on another provider was sent the primary provider's tool array. Tools are now rebuilt per profile by `TurnToolSlate.formatToolsFor` (`turn-tools.service.ts`) with the turn's options, narrowed to the tools the primary was offered.
- #182: a substitute whose answer was only a tool call was recorded as `empty-response` and the next candidate was called. "Answered" is now prose or a detected tool call, at all three sites. After an empty-response recovery answers, the orchestrator runs the tool loops again so the call is executed.
- A substitute whose resolved tool mode (native / simple-json / text-block) differs from the turn's is skipped and recorded on the route trail (`provider-error`); the system prompt was built for the turn's mode.
- After a swap, the native tool loop and the text tool passes continue on the substitute's tools, image-budgeted messages and params (`StreamingState.effectiveCall`) instead of the primary's.
- The failover stream writes every frame through `safeEnqueue`. A closed client stops the walk; it is no longer recorded as a provider failure and no further candidate is called. What arrived is kept for the partial preserver.
- The partial preserver saves when there is prose, whether or not the primary stream started (a tool-loop continuation after a silent tool call never set the flag), and saves the TOOL rows of tools that ran before the failure.
- The same-profile and uncensored retries now carry the turn's stop sequences (simple-json).

#### Hardening: network defaults, stored files, imports and tool permissions

- The server binds `127.0.0.1` by default (`server.ts`, `quilltap` CLI). Listen on every interface with `quilltap --host 0.0.0.0` or `QUILLTAP_HOST`. The Docker image still binds `0.0.0.0` inside the container. `docs/DEPLOYMENT.md` and the new `help/network-access.md` say that Quilltap has no login and how to expose it.
- One request-origin check (`lib/api/request-origin.ts`) for HTTP (`proxy.ts`) and WebSocket upgrades: requests addressed to an unrecognized host name are refused, and API requests a browser marks as cross-site or cross-origin are refused. Loopback names, IP addresses, the host of `BASE_URL` and `QUILLTAP_ALLOWED_HOSTS` are accepted. No CORS headers are sent. The CSP and other security headers now come from `next.config.js` for every response.
- Stored files are served through one helper (`lib/api/serve-stored-bytes.ts`): raster images, PDF and plain text may display inline; everything else downloads, with `nosniff` and a sandboxing CSP.
- One path-containment helper (`lib/paths/resolve-inside.ts`, realpath-aware) for document stores, the file store, theme bundles and theme routes. Theme manifest paths must be relative to the bundle. Symlinks in a filesystem store that point outside it are refused.
- Server-rendered message HTML applies the same link protocol rules as the client renderer (`lib/markdown/safe-urls.ts`). Roleplay template class names are limited to letters, digits, `_`, `-` and spaces, and template patterns to 500 characters without nested repetition (`lib/utils/safe-regex.ts`); doc grep and `log_grep` share the regex limits.
- `run_sql` accepts only introspection PRAGMAs (`table_info`, `table_xinfo`, `table_list`, `index_list`, `index_info`, `index_xinfo`, `foreign_key_list`) and runs on a read-only connection.
- Tool calls go through one permit (`resolveToolPermit`, `lib/tools/effects.ts`): a tool not offered to the character this turn is refused, and the turn's effect ceiling carries into Carina answerers. `@Brahma` / `ask_carina` to Brahma is refused in a turn limited to reads. `doc_open_document` with a URI that names no file is an error; `doc_delete_blob` deletes blobs only and honours write permissions.
- Outbound fetches for image import by URL, theme install by URL and the theme and plugin registries go through `safeFetch` (`lib/net/safe-fetch.ts`): http(s) only, public addresses only, redirects checked per hop, size-capped. The curl plugin checks redirects per hop, resolves DNS and matches allowlist patterns against the parsed URL; NanoGPT and Z.AI image downloads require https and a public host.
- `.qtap` import: filesystem and Obsidian stores arrive disabled, and the preview shows their folder; Overwrite keeps an existing store's folder and type.
- Backup restore no longer installs plugin code (the restore lists the plugins to reinstall), refuses archives with symlinks or over the entry and size caps, and reads archive-named files only inside the archive.
- Theme registries with a key refuse an index or bundle whose signature fails; cached indexes are re-verified. The verifier accepts both the CLI's and the library's signature formats.
- Plugin config fields can be marked `secret: true`; secret fields are left out of `.qtap` exports and backups. The MCP plugin's server list is marked secret.
- API key previews show the last four characters. New API-key export files use 600,000 PBKDF2 iterations (older files still import). Repeated wrong passphrases at unlock are throttled (429 with `Retry-After`). `GET /api/v1/memories` validates `sortBy` / `sortOrder`. Download filenames escape quotes and backslashes.
- Plugin versions: curl 1.0.36, MCP 1.1.49, NanoGPT 1.2.16, Z.AI 1.1.37.

#### Fix: setup wizard and first-run defaults

- Setup wizard API keys: Validate tests a key before storing it. `?action=test-connection` on `/api/v1/connection-profiles` takes an unsaved `apiKey`. A rejected key is no longer saved, re-validating replaces the row the wizard stored instead of adding another, and in settings mode an untouched masked field tests the existing key instead of saving the literal `********` (`components/setup-wizard/key-validation.ts`).
- Setup wizard "Manual" background model: saved as `cheapLLMSettings.userDefinedProfileId`. It was sent as `profileId`, which the schema dropped, leaving `USER_DEFINED` with no profile.
- Cheap LLM strategy is honored. A profile flagged `isCheap` is now only a stand-in for User Defined with no profile chosen; it no longer overrides Provider Cheapest or Local First (`getCheapLLMProvider`). The Almanack reports the cheap LLM the ladder actually resolves instead of the first `isCheap` profile.
- Profile setup saves the name to the account, so the home page greets the user by name instead of "Local User".
- Default image profile: a new chat with no project or character image profile gets the instance's default image profile (one with an API key), and the Start Chat dialog shows it. An explicit "No image generation" is now sent as `imageProfileId: null` and honored; the create schema accepts null. The chat and standalone Generate Image dialogs preselect the default profile (`ImageProfilePicker` `preselectDefault`).
- An empty character wardrobe is logged at debug instead of as an error ("wardrobe is unreadable") on every turn.
- Help: rewrote Cheap LLM Configuration for the strategy card; updated the setup wizard, startup wizard, chats and Courier pages.


#### Fix: first-run and restart failures found dogfooding a fresh instance

- Background jobs were dead on every brand-new instance until a restart. Startup enqueues jobs (the seed stores' embeddings) before first-run setup has produced the encryption pepper; the job child refuses to run without it, so it exited five times, used up the restart budget, and stayed down after setup succeeded. The processor host (`lib/background-jobs/host/processor-host.ts`) now defers forking the child until the pepper exists, without spending the crash budget, and `?action=setup` wakes it once the databases are reopened.
- A browser reload or closed tab could crash the server. Node destroys an abandoned incoming request with `Error('aborted')` / `ECONNRESET`; when that escaped its request it reached the process-wide `uncaughtException` handler, which closed SQLite and exited. It is now logged as a warning and the server keeps running (`isClientDisconnectAbort`, `lib/database/backends/sqlite/client.ts`). `server.ts` also listens for errors on a WebSocket upgrade's socket from the start, instead of only after the handler module has loaded.
- Tailwind no longer scans `docs/` (`@source not "../docs"` in `app/globals.css`). A developer doc that mentioned a class such as `text-[var(…)]` produced invalid CSS and failed the whole dev build, and every doc save recompiled the stylesheet and full-reloaded every open page, which made the unlock screen unusable while docs were being written.

#### Docs: Release checklist 14 pass

- README tour: the Atlas, character kind (roleplay / assistant), the one-page character editor and birthdays, line editing, fixed-in-time portraits, Turns mode, the Green Room opening, and the rebuilt Foundry settings page.
- About page: Atlas bullet and subsystem mention; Aurora, Salon and Foundry bullets updated for 4.13.
- API.md: documented the custom-tool operator-intervention actions (`?action=interventions`, `intervention-preview`, `intervention-reask`, `intervention-resolve`) on `/api/v1/chats/[id]/custom-tools`.
- DEVELOPMENT.md: project tree lists `lib/atlas`, `lib/documents/core`, `lib/inventory`, `lib/progressions`, `lib/settings` and `lib/terminal`; settings and character entries updated.
- CLAUDE.md: chokepoint note for the Salon avatar timeline (`ChatAvatarTimelineRepository.record` / `avatarAt`).
- 4.13.0 release notes: theme-storybook 1.0.111, the shared dialog overlay and `qt-text-brand`, and the opening state's exclusion from backups.
- Restored the root `package.json` requirement on `@quilltap/plugin-utils` to `^2.7.5`; the dead-code sweep commit had reverted it to `^2.7.4` while the lockfile stayed at `^2.7.5`.

#### Docs: CLI README (release checklist 12)

- No CLI command or flag changes since 4.12.2; help text and the bash / zsh / fish completions were already current.
- `packages/quilltap/README.md` now documents `instances set-passphrase` (in `--help` and completions since 4.5.0, never in the README), `instances show`, `instances path`, and the `rm` / `delete` aliases of `instances remove`.

#### Chore: Dead code sweep (release checklist 5)

- Deleted importer-less barrels `components/new-chat/index.ts`, `components/new-chat/hooks/index.ts`, `lib/characters/vault/index.ts`.
- Removed `buildRecentConversationsBlock`, `calculateRecentConversationsLimit` and the `RECENT_CONVERSATIONS_*` constants from `lib/memory/recall/recap.ts`; their only caller was the legacy greeting builder removed when the greeting became a turn. The bug-158 tests now run against `generateMemoryRecap`.
- Removed unused `resolveUserCharacterParticipant` (`turn-transcript.ts`), `isOpeningInFlight` (`lib/chat/opening/run.ts`), `InventoryImagePointerFix` (`uuid-remap.ts`) and `DocumentStoreOps` (`useDocumentStoreSource.ts`).
- Details in `docs/developer/DEAD-CODE-REPORT.md`.

#### UI: Release checklist 13 — WCAG 2.2 AA pass

- Startup, instance-lock and version-guard screens: the `--qt-*` component defaults are now declared on `:root` as well as `[data-theme]`. These screens render before a theme is set, so `.qt-card` had no background and the dark text sat directly on the dark startup art.
- Status badges (`qt-badge-success` / `-warning` / `-info` / `-destructive`, queued and user-turn position badges): `--qt-status-*-bg` is the status color at full strength instead of an 85% mix. White on the mixed color measured 3.7–4.1:1 in the default light theme.
- Tinted badge text (character, user-character, chat, tag, memory, message, project, enabled, related, manual, source, capability, wardrobe): 76 foreground values across the default theme and five bundled themes moved darker (light mode) or lighter (dark mode) at the same hue to reach 4.5:1 on the theme's card and page colors. Art Deco light was the worst case at 2.4:1. Earl Grey and Rains also get their own `--qt-status-info-fg` for light and dark, and Earl Grey light an info background of its own. Bundled theme versions: Art Deco 1.0.15, Earl Grey 1.3.12, Great Estate 1.0.12, Old School 1.0.16, Rains 1.3.16.
- Toggle switches: new `qt-toggle-off` utility (muted track with an inset muted-foreground edge) on all eight hand-built switches. The plain muted track was about 1.1:1 against a card.
- Theme cards in Appearance: the white/dark text picker now chooses by contrast ratio and reads `hsl()` colors as real luminance rather than HSL lightness. The "Active" badge uses it (it was white on the default theme's blue at 2.85:1), and the "Quilltap" wordmark in a card description takes the card's ink through `--qt-brand-fg` (it kept the page's dark foreground on the dark card, 1.1:1). Rains sets its wordmark color through `--qt-brand-fg` instead of overriding `.qt-font-brand`.
- Salon: the "already spoken" turn-position badge keeps its number at full strength and shows its state with a dashed outline instead of 50% opacity. The provider/model badge under an avatar uses `qt-text-secondary` instead of `opacity-60`.
- Pascal's Workbench: a disabled tool's card is no longer faded to 60% (it stays fully operable; the "disabled" badge marks it).
- Aurora template tools: the swap buttons and their `{{char}}` / `{{user}}` chips use foreground text on the tinted button instead of green or blue text on stacked tints.
- Avatar fallback initials (`lib/avatar-styles.ts`): `qt-bg-muted` / `qt-text-secondary` instead of raw `bg-gray-300` / `text-gray-600` with `dark:` variants, which read 2.1:1 in Madman's Box (a dark palette under the `light` class).
- Reflow (320 px) and text zoom (200%): the formatting toolbar wraps instead of being clipped by its card; the Aurora character header's avatar is capped at the pane width and its action buttons wrap; the color-mode buttons, theme-card badge row and display-option toggle row wrap.
- Toasts: the polite live region is mounted empty before the first toast renders into it, so the first toast of a session is announced. Test: `__tests__/unit/lib/toast-live-region.test.tsx`.
- `packages/theme-storybook` regenerated and bumped to 1.0.112; `create-quilltap-theme` bundle template defaults updated, 2.0.24.

#### Backup/restore: 4.13 coverage tests

- New tests: `avatar-timeline-backup.test.ts` (backup file and manifest count, restore via `upsertRows`, pre-4.13 archive, new-account remap of ids and `imageId`, rows for missing characters dropped), `backup-4-13-remap.test.ts` (`cheapLLMSettings.outfitSelectionProfileId` remap; Atlas entry ids verbatim and `imageFileId` pointer fix), and a 4.13 block in `restore-field-fidelity.test.ts` (`toolResultVerbatimTurns` carried, `0` kept, default 3 for older archives).
- `chats.openingState` / `openingPhase` / `openingPlan` are now listed as a deliberate backup exclusion in `help/system-backup-restore.md` and in the release checklist's sanctioned list. A restored chat reads as `'done'`.

#### Chore: Release checklist 7 — raw Tailwind colors to `qt-*` utilities

- New `qt-text-brand` / `hover:qt-text-brand` utilities (`--color-primary` as a text color; `qt-text-primary` remains the main foreground color). `packages/theme-storybook` regenerated and bumped to 1.0.111.
- Components added or changed since 4.12.2: `text-foreground` → `qt-text`, `hover:text-primary` → `hover:qt-text-brand`, back links → `qt-action`, a hand-drawn spinner → `qt-spinner`, `bg-background` panels → `qt-bg-default`.
- Across `app/` and `components/`: every hand-built `bg-background/80 backdrop-blur-sm` dialog backdrop → `qt-dialog-overlay` (now z-60, above the left sidebar, theme backdrop color, no blur); every hand-built primary button → `qt-button qt-button-primary` (toolbar theme hooks and `flex-1` kept); remaining `bg-primary` / `text-primary-foreground` (toggles, stepper dots, tab underlines, selected pills) → `qt-bg-primary` / `qt-text-on-primary`.
- No `qt-*` equivalent yet, left as is: `bg-border` on the import wizard's step line, `ring-primary` on the AI wizard's current step, `focus:ring-ring`.

#### Tests: Release checklist 2 pass

- Regression test for the `node:crypto` client-bundle fix: `__tests__/unit/lib/characters/vault-paths-client-safe.test.ts` walks the static value-import graph from `character-field-semantics.ts`, `field-hints.ts` and the Aurora new-character page and fails on any reachable `node:` import; it also checks `paths.ts` imports nothing and `layout.ts` re-exports its constants. Fails with the old `layout.ts` import restored.
- Unit test for `resolveChatExtractionProfileId` (queue-memories and edit-regenerate): seat profile order, cheap default, `USER_DEFINED` pick, foreign or missing profiles skipped. `__tests__/unit/lib/memory/extraction/resolve-chat-extraction-profile.test.ts`.
- Confirmed the tests shipped with every other fix since 4.12.2 fail with that fix reverted.

#### Feature: Picture view for document-store file browsers

- `DocumentStoreBrowser` has a List / Pictures toggle beside the search box. Pictures lays folders and files out as square tiles (`DocumentTile`): image files show the image, other files and folders show a generic icon, and the name and modified date are overlaid on the tile (`qt-gallery-caption`). The ⋮ menu, select checkboxes and in-place rename work in both views. Applies everywhere the browser is used, including the Salon's attach-from-library picker, where browsing hundreds of images as thin rows was impractical.
- The choice is stored per browser in `localStorage` (`quilltap.documentBrowser.layout`) and read through `useSyncExternalStore`, so a server render is always the list view.
- `FolderBrowserShell` takes `layout: 'list' | 'grid'`; `ItemFolderRow` takes `tile`. Row/tile shared logic (menu labels, kind icons, rename state) moved to `components/document-browser/document-item.tsx`.
- Test: picture-view case in `document-store-browser.test.tsx`.
- Help: `mount-points.md`, `scriptorium.md`.

#### Feature: Save an Atlas entry's picture to a document store

- The full-screen Atlas picture viewer now has Save to a document store, like Wardrobe and Inventory pictures. `SaveImageDialog`'s `SaveImageTarget` gains an `atlas` kind; the three item doors share one `itemImagesUrl` helper and post to the item's own images route (`save-targets` / `save-to-store`, already served by `createItemImagesRoute`).
- Tests: `save-image-dialog-item-doors.test.tsx` (all three item doors' URLs), Atlas case in `item-image-viewer.test.tsx`.
- Atlas browser rows: the thumbnail is now a button that opens the current picture in the full-screen viewer, as on Wardrobe rows (`AtlasEntryPicture` `onOpen`, `useAtlasEntryActions.openImage` / `imageView`, viewer rendered by the Atlas host at the entry's home tier). Previously the viewer was reachable only from the entry editor. Test: `atlas-entry-row.test.tsx`.
- Help: `atlas.md`.

#### Feature: The Atlas — named things, what they look like and what is known of them

- New `Atlas/` folder in each of the four tiers (character vault, group store, project store, Quilltap General). One Markdown file per entry: frontmatter carries `id`, `name`, `aliases`, `graphicPrompt`, `imageFileId`, `metadata`, `archivedAt` and timestamps; the body is `knowledge`. Identity is the frontmatter `id`. Schema `lib/schemas/atlas.types.ts`; code in `lib/atlas/`.
- Writes go only through `lib/atlas/vault-writes.ts` (projection over `projectArrayIntoVaultFolder`, serialised per folder; notes and duplicate-id files are never swept). `resolveAtlasLocation`, mutations, transfers and pictures mirror the Inventory without archetypes, kits or equip. A live entry's canonical name is unique per tier, case-insensitively (`NAME_TAKEN`, 409). Aliases are normalised on write.
- Pool (`loadAtlasPool`): character > group > project > general, shadowed by canonical name, archived dropped per tier first. Cast view (`loadCastAtlasView`) for chips and pictures: present seats' vaults in participant order, then the cast's groups, project, General. The project roster is not consulted.
- Matching (`lib/atlas/match.ts`): whole word, case-insensitive, letter-bounded, longest first, no stemming; a canonical name beats an alias; terms any workspace character answers to are excluded. `buildNameMatcher` gains a `caseInsensitive` option (default off).
- Knowledge delivery: `buildAtlasSection` adds a trailing `## What is being spoken of` section right after the referent ledger (`TrailingSections.atlas`), for entries the responding character can reach that are named in the referent ledger's window, plus the scenario on the seat's first turn under the current scenario (swipes count as first turns). Capped at 8 entries; empty is absent; never throws; nothing stored. `recentSpokenLines` extracted from `buildReferentSections` so both sections share one window and one workspace-characters read.
- Chips: `GET /api/v1/chats/[id]?action=atlas-mentions` (`findAtlasMentions`, over spoken lines and the Host's `scenario` / `scenario-change` rows), `hooks/useAtlasMentions.ts`, `queryKeys.chats.atlasMentions`. `MentionChip` takes `kind: 'person' | 'thing'`; a thing's popup shows picture, aliases, graphic prompt, knowledge (Markdown) and tier. People's chips are marked first and win overlapping runs. New CSS: `.qt-mention-chip-thing`, `.qt-tooltip-image`, `.qt-tooltip-markdown`.
- Pictures (`lib/atlas/image-reference.ts`, the only image-side reader): story backgrounds pass `knownThings` on `StoryBackgroundPromptContext` (scene context, scene state, recent messages, scenario; the crafter's system prompt gains a "known things" paragraph only when the block is present). `generate_image` (tool, image-profile generate, uncensored retry) crafts with `knownThings` even without character placeholders, rewrites a `{{Name}}` naming only an Atlas term to the canonical name, and appends looks when the crafter fails. The legacy image dialog appends looks to the typed prompt. A prompt naming nothing is unchanged. Avatars, wardrobe and Inventory pictures never read the Atlas.
- Entry pictures under `Atlas/images/<entryId>/`, upload and generate; new LLM log type `ATLAS_ENTRY_IMAGE`, counted as image spend.
- Routes: `/api/v1/atlas`, `/api/v1/{characters,groups,projects}/[id]/atlas` (+ `/[entryId]`), `?action=folders|overlaps`, `duplicate`, folder actions, `move-items`, `copy-items`; `POST /api/v1/atlas/transfers`; `/api/v1/atlas/[entryId]/images` (renames the folder's `entryId` param to the `itemId` the shared images route reads).
- UI: left-sidebar Atlas button (after Inventory), `atlas` workspace tab, Prospero `AtlasCard`, Aurora Appearance card, browser and editor in `components/atlas/` (alias token input, graphic-prompt count with a non-blocking warning past 200 characters, overlap notices), `atlas` icon. Shared folder-browser pieces now pluralise properly (`pluralWord` / `pluralize`). `packages/theme-storybook` regenerated and bumped to 1.0.110.
- Realtime topic `atlas` (lists, folders, overlaps, every chat's Atlas chips); a job-child document write under `Atlas/` names it.
- `Atlas` added to `CHARACTER_VAULT_CORE_FOLDERS` (hidden from an opaque character's `doc_*` tools). Not kept by the archived-character prune.
- Restore: entry ids travel verbatim; the Inventory's picture-pointer repair is generalised over an `ItemFileKind` descriptor (`planItemImagePointerFixes`) and now repoints Atlas entries' `imageFileId` too. No DDL, migration or export-schema change.
- Tests: `__tests__/unit/lib/atlas/*` (files, mutations, pool order, match, prompt section, mentions, image reference, routes, grep fences), `own-vault-core-guard.test.ts`, `image-generation-atlas.test.ts`, story-background Atlas cases, realtime topic cases, `atlas-entry-editor.test.tsx`, `atlas-icon.test.ts`.
- Help: new `atlas.md`, `project-atlas.md`; `salon-host-introductions.md`, `story-backgrounds.md`, `image-generation-profiles.md` revised.

#### Fix: Wardrobe History's Wear again stages until Done

- Wear again on the Wardrobe dialog's History tab posted `?action=wardrobe-rollback` immediately, so the outfit changed in the Salon while the Live outfit tab still showed the old staging. It now stages: `useStagedLiveOutfits.stageRollback` replaces the character's staged slots with the entry's, the Live tab shows them, and nothing is sent until Done.
- On Done, a pick whose staged slots still match goes through `?action=wardrobe-rollback` (cursor move, Aurora announcement); a pick edited further on the Live tab goes as a normal `set_all`.
- The History tab marks the staged entry ("Staged — on at Done") with an Unstage button, and asks before replacing other staged edits.
- New pure helpers in `lib/wardrobe/staged-live-outfits.ts`: `rollbackTargetSlots` (client mirror of `filterStaleItems`), `rollbackGesture`, `standingRollbacks`. `discard` no longer takes `{ reseed }`; it re-seeds at once.
- Tests: `outfit-history-tab.test.tsx`, `use-staged-live-outfits-discard.test.tsx`, `staged-live-outfits.test.ts`.
- Help: `wardrobe.md`.

#### Chore: dependency updates

- `npm update -S` across the root, `packages/*` and `plugins/dist/*`. Root: `next` / `eslint-config-next` 16.4.6, `openai` 7.54.0, `@tanstack/react-query` (+ devtools, eslint plugin) 5.107.1, `@tanstack/react-virtual` 3.14.26, `@openrouter/sdk` 1.5.73, `@tailwindcss/postcss` 4.3.5, `ws` 8.22.2, `dotenv` 18.0.10, `@testing-library/user-event` 14.6.9, `@quilltap/plugin-utils` 2.7.4.
- `@quilltap/plugin-utils` 2.7.5 (`openai` dev dependency); `packages/theme-storybook` 1.0.109 (Storybook 10.6.6).
- Plugins: all now on `@quilltap/plugin-utils` ^2.7.4; `openai` ^7.54.0 in the OpenAI-based plugins; Anthropic `@anthropic-ai/sdk` ^1.7.0; OpenRouter `@openrouter/sdk` ^1.5.73. Patch versions bumped and rebuilt for every plugin except `qtap-plugin-builtin-embeddings` (unchanged).

#### Feature: emoji and symbol typeaheads in every Markdown editor

- `MarkdownLexicalEditor` (character fields, prompts, scenarios, memories, wardrobe and inventory editors, mail, announcements, informs, Scenario Builder, and the other form and dialog editors) now mounts `CharTypeaheadPlugin` for `EMOJI_PROFILE` and `UNICODE_PROFILE`, so `:name` and `\name` work there as they do in the Salon composer and Document Mode. Each still obeys its composer setting. The toolbar's `☺` and `Ω` buttons were already present in all three editors. The `/` command menu and `@` mentions remain composer-only.
- `.qt-typeahead-menu` z-index raised from 50 to 200. Lexical mounts the menu anchor on `<body>`, so at 50 it rendered under every modal overlay (60–101); 200 keeps it below toasts (1000). `packages/theme-storybook` regenerated and bumped to 1.0.108.
- Test: `memory-editor.test.tsx` now renders through `renderWithQuery`, since the editor reads chat settings.
- Help: `chat-settings-composer.md`.

#### Feature: characters without system transparency may use their own vault's non-core folders

- The doc-tool opacity rule hid every character vault, the acting character's own included, from a character with `systemTransparency !== true`. It now hides only peer vaults; the character's own vault is reachable with its core guarded: every root-level file, and the `Prompts`, `Wardrobe`, `Outfits`, `Inventory`, `Mail` and `images` folders (with their contents), can be neither read nor written, and those folders and the root cannot be deleted or moved. Everything else (Scenarios, Knowledge, Tools, lore, files, and folders the character creates) is open to the full `doc_*` and `doc_*_blob` toolset. A new root-level folder may be created; a new root-level file may not.
- New pure module `lib/characters/vault/core-guard.ts` (`CHARACTER_VAULT_CORE_FOLDERS`, `isOwnVaultCorePath`, `isOwnVaultEntryHidden`, `ownVaultCoreRefusal`) is the one statement of the rule.
- `PathResolutionContext.hideCharacterVaults` / `AccessibleMountPointsQuery.hideCharacterVaults` are replaced by `guardOwnVault`: the participant tier is dropped, the character tier kept. The resolver refuses the vault root and core folders (`ACCESS_DENIED`, with a message naming the boundary) and tags the result `ownVaultGuarded`; `assertCharacterMayRead` / `assertCharacterMayWrite` refuse root-level files through `assertOwnVaultFileOpen`, before the new-file early return. `getAccessibleMountPoints` tags the guarded vault; `doc_list_files`, `doc_grep` and `doc_list_blobs` drop its core entries via `ownVaultEntryFilter`; `doc_read_blob` / `doc_write_blob` / `doc_delete_blob` refuse core paths. The `self` token resolves for opaque characters again.
- Tests: new `lib/doc-edit/__tests__/own-vault-core-guard.test.ts`; the two `path-resolver-opacity-*` suites updated to the new rule.
- Help: `character-system-transparency.md`, `document-editing-tools.md`, `character-editing.md`.

#### Feature: the Green Room panel can be closed and docks into the transcript

- The Green Room panel stayed pinned above the Salon transcript for the rest of the session. It now has a close button; closing it docks the room as a collapsed card inside the message list, placed after the last message that was on the page when the room began (the top for an opening), so it scrolls with the conversation. The card's disclosure shows the wardrobe, packing and activity record as before.
- `useGreenRoom` now keeps a list of rooms (one per opening or watched join) with `docked` / `expanded` state; starting a new room docks the previous one instead of discarding it. Client-only; nothing is persisted or sent to a model.
- New `RenderItem` kind `green-room`, placed by `insertGreenRoomItems`; `renderItemMessageIds` replaces the two hand-rolled kind checks in `SalonView`.
- CSS: `qt-green-room-docked`, `-header`, `-close`, `-toggle`; `packages/theme-storybook` regenerated and bumped to 1.0.107.
- Tests: `insertGreenRoomItems` placement cases in `announcement-render-items.test.ts`.

#### Fix: Inventory pool lists consulted stores in tier order (#155)

- `loadInventoryPool` read its four tiers concurrently and every tier pushed into one shared `consulted` / `unread` array, so `consultedMounts` (and the title lint's Census `pools` DEBUG line) interleaved tiers in read-settlement order. `readTier` (`lib/inventory/pool.ts`) now returns its own records, consulted and unread lists, and the pool concatenates them in tier order (own, group, project, General) after the reads settle. Reads stay concurrent; the lint's verdict was never affected.
- Test: `pool-order.test.ts` pins the consulted order.

#### Theme: Madman's Box backdrops for the Concierge, Pascal, Saquel and Brahma

- Madman's Box replaced only eight subsystem backdrops; the Settings redesign made the Concierge's, Pascal's, Saquel's and Brahma's visible (as group and lens backdrops), so they showed the default art. Added `textures/{concierge,pascal,saquel,brahma}-bg.webp` (2731×1536, WebP q75, 700–890 KB) and their `subsystems` entries in `theme.json`; theme bumped to 1.1.11.

#### Feature: The Foundry, rebuilt — a settings page organised by what things do, with search

- Implements `docs/developer/features/complete/settings-redesign.md` (phases 0–5).
- New `lib/settings/registry.ts`: the one list of settings groups and cards (id, group, title, description, persona, keywords, advanced, hosted-by, help slug). `SettingsView`, the workspace `settings` tab, the Foundry persona `href`s, the help-guide categories and the help chat's link labels all read it. Card bodies are mapped by id in `components/settings/cards.tsx` (lazy per group module, in `components/settings/cards/`). The eight `components/settings/tabs/*TabContent.tsx` files and `useSettingsSection` are deleted.
- Ten groups in a left rail (a `<select>` below `md`) replace the eight persona tabs: Connections, Composer & Display, Context & Memory, Characters & Prompts, Images, Games & Tools, Moderation, Appearance, Security, Data & Maintenance. Rarely used cards sit below an "Advanced" divider. The page heading is now "The Foundry", subtitled "Settings".
- Every card wears its persona's badge. A persona row above the rail filters the whole page to one persona (`?persona=<id>`), with that persona's backdrop and a "Show everything" banner. `SubsystemId` gains `brahma`; `CHILD_SUBSYSTEM_IDS` regains `pascal` and `saquel` and adds `brahma`; every subsystem `href` is its lens URL; `app/foundry/<id>` redirects follow, and `app/foundry/brahma` is new.
- Search field (`/` focuses, Escape clears): folded-case substring match over card title, description, keywords, group title and theme-resolved persona name, all terms required. The rail narrows to matching groups with counts; matches open with the terms marked (`CollapsibleCard` gains `highlight` and `badge` props); an `aria-live` region reports the count; clearing restores the previous group and open cards. `?q=` pre-fills it.
- Attention strip (`components/settings/AttentionStrip.tsx`): chips for a profile with a missing key or absent provider plugin, the Concierge off duty (replaces the inline warning), memories awaiting backfill, a failed background task, and a plugin load error. `/settings` with no parameters opens the first lit chip's group, else Connections.
- Connections → Providers: one collapsible card per configured provider (a key, or any profile naming it) with its keys and every connection, image and embedding profile using it, kind and persona badges, and an Add menu that opens the existing modal with the provider preselected; an "Add a provider" card; a By provider / By kind toggle (localStorage) that keeps the four original list cards. The four modals take an optional `initialProvider`; new `useConnectionProfileModal`, `ApiKeyCard`, `useApiKeyActions`, `provider-groups.ts`. New query keys `embeddingProfiles.models` and `embeddingProfiles.providerNames`.
- URLs: `/settings?group=`, `?section=<cardId>` (group derived), `?persona=`, `?q=`, and `&provider=` (opens a provider card). `resolveSettingsLink` keeps every old `?tab=` / `?tab=&section=` link working (`LEGACY_TAB_TO_GROUP`, `LEGACY_SECTION_ALIASES`; `the-courier` → `connection-profiles`, the retired memory sections → `memory-maintenance`). The workspace `settings` payload gains `group`, `persona`, `q`, `provider`; a deep-linked settings tab is titled "The Foundry · <group>".
- Fix: `help/the-courier.md` linked to a section that no tab rendered; it now resolves to Connection Profiles.
- Help: every `/settings` link in `help/*.md` rewritten to the new form; `help/settings.md` rewritten; prose naming the old tabs updated across the help docs; the five key/profile docs rewritten around the provider view. `help_navigate`'s examples use the new form (tool snapshot updated).
- CSS: new `app/styles/qt-components/_settings.css` (`qt-settings-*`); `packages/theme-storybook` regenerated and bumped to 1.0.106.
- Tests: `registry.test.ts` (integrity, legacy bridge for all 56 original cards, search), `help/settings-links.test.ts` (every help doc's settings link resolves and uses the new form), `subsystem-assets.test.ts`, `app/settings/SettingsView.test.tsx` (replaces `ConciergeTabContent.test.tsx`), `AttentionStrip.test.tsx`, `providers-view.test.tsx`.
- New art: Brahma's backdrop (`public/images/brahma.webp`, 2731×1536) and thumbnail (`public/images/thumbnails/brahma.webp`, 800×450).

#### Style: The Green Room panel on `qt-*` classes

- `GreenRoomPanel` used Tailwind utilities directly. It now uses `qt-green-room*` classes from the new `app/styles/qt-components/_green-room.css` (plain CSS; colours, widths and heights read `--qt-green-room-*` hooks with token fallbacks; the pulse and spinner stop under `prefers-reduced-motion`).
- `packages/theme-storybook` regenerated and bumped to 1.0.105.

#### Refactor: Casting, the opening, and the Green Room in the Salon

- Implements `docs/developer/features/refactor-green-room-and-opening.md` (all six phases; §10 records departures).
- `POST /api/v1/chats` is casting only (`castChat`, `lib/chat/opening/cast.ts`): it resolves every default once (`resolveCastingDefaults`), creates the chat with `openingState: 'pending'`, applies the Concierge state and the continuation backfill, and returns. No model call runs before the response. `app/api/v1/chats/route.ts` went from 1,671 lines to 250.
- New `GET /api/v1/chats?action=casting-defaults`: the title, timestamp config, image profile, roleplay template, tools, avatar setting, Concierge state, default scenario, per-seat outfit modes and a continuation's previous outfits for a prospective cast. An absent key on create means "use the default"; the scenario keys are one override.
- The opening (`runOpening`, `lib/chat/opening/run.ts`) runs the phases in `OPENING_PHASES` (identity stacks, Prospero, Host scenario, Host user-character, arrivals, greeting, autonomous start), skipping those that do not apply to the chat (Salon, continuation, autonomous room). The Salon starts it when it opens a chat that is not `'done'` (`POST …/messages` with `{ continueMode: true, opening: true }`); an autonomous room's run start and `POST /api/v1/chats/[id]?action=open` start it too. It runs under the stream's turn control: Stop skips the greeting and marks the chat opened, a send waits for it, and an interrupted opening resumes from the last recorded phase. A startup reconciler returns stale `'running'` openings to `'pending'`.
- The greeting is a turn (`purpose: 'opening'`): the Salon's prompt, recall (recap pool), Informs, Inventory, progressions, the Core whisper, the fallback engine, Concierge routing, the stall watchdog with the Salon's budgets, and the finalizer (speaker recorded, title check, Lantern cue). An ephemeral opening note trails the context. A scripted `firstMessage` is posted through the finalizer's shared tail (`finalizeScriptedOpener`). Removed: `lib/chat/initialize.ts`, `lib/chat/initial-greeting.ts`, `lib/chat/first-message-context.ts`, the greeting's provider ladder and 90 s / 60 s budgets, and the SYSTEM prompt row new chats used to start with. The opening speaker is drawn by the turn manager, not by casting.
- One arrival: `seatArrival` / `seatArrivals` (`lib/chat/opening/arrival.ts`) for chat start, add-participant and merge, in one order (outfit, inventory, identity stack, Host welcome, Aurora's opening-outfit whisper, avatar refresh) with one default outfit rule (`defaultOutfitMode`). It is the only caller of `applyOutfitSelections` and `applyInventoryDefaults`.
- Fix (#151): a character added mid-chat with "Dress Themselves" was dressed in silence. A join now narrates in the Salon (`?action=add-participant` with `narrate: true` answers with a Green Room stream) and posts the opening-outfit whisper; a merge posts it and refreshes the avatar too.
- Fix (#152): creating a chat without `outfitSelections` dressed a `canChooseOutfit` character in defaults; the server now applies the same rule the dialog showed.
- Fix (#153): the greeting's private recall stamped `lastAccessedAt` outside `deliverRecall`; the greeting now uses the turn's recall.
- Fix (#154): the per-seat `imageProfileId` on create, documented as ignored, was consulted. It is removed; the participant object is strict (an unknown key is a 400), and the chat's image profile falls back to the primary character's `defaultImageProfileId`, which the old code named but never read.
- The Green Room is a panel above the Salon transcript fed by new `greenRoom` stream frames (`GreenRoomNarrator`, `lib/chat/opening/narrator.ts`); it folds to one line when the opening is done. Removed: `ChatCreationProgressModal`, `CreationProgressProvider`, `lib/chat/creation-progress.ts`, `GET /api/v1/chats/creation-progress` and `progressId`. The operation-progress bus stays for the Almanack.
- New Chat dialog: reference data and defaults through TanStack Query (`queryKeys.casting`, `queryKeys.chats.autonomousRoom`), form state as defaults plus overrides, and the request body carries only what the operator changed. One mount: `NewChatProvider.open` from the character page, the homepage card and Continue Elsewhere; `/salon/new` renders the same `NewChatDialogBody` through `NewChatFormProvider`. `EditEnclaveModal` reads and saves through queries. Removed: `scenario-seed.ts`, the `touched` flags, client title generation, `computeSyncInitialMode`.
- Data: migration `add-chat-opening-state-v1` adds `chats.openingState` (default `'done'`), `openingPhase` and `openingPlan`; patch-only, outside `ChatMetadataSchema`, not exported or backed up. List and detail GETs carry `openingState`.
- Docs: `API.md`, `DDL.md`, `SYSTEM_FLOWCHARTS.md` (new §11), `CLAUDE.md`, `help/chats.md`, `help/chat-participants.md`, `help/chat-multi-character.md`, `help/chat-settings-ai-services.md`.
- Verified live on V4test. That pass found and fixed two bugs: the `opening` flag was dropped by `buildContinueMessageOptions`, so the Salon's opening request ran as a plain continue; and the staff phases' duplicate check skipped a continuation's own Host scenario and Prospero posts because the replayed history held the source chat's (the check now runs only when resuming).
- Tests: `__tests__/unit/lib/chat/opening/` (`arrival`, `cast`, `run`, `staff`, `opening-chokepoints` grep fences), `route.create.test.ts`, `participants-arrival.test.ts`, an `opening` golden stream, opener-context cases in `context-management.test.ts`, the scripted opener in `message-finalizer.service.test.ts`, and rewritten New Chat tests. The four handler-traversing route tests and `route.greeting-stall.test.ts` were removed; their cases moved to the module tests.

#### Docs: spec for rebuilding the Settings page

- New spec `docs/developer/features/settings-redesign.md`. The Settings page is eight tabs named for personas holding 56 cards, 21 of them under Chat; connection, image and embedding profiles sit in three tabs while the API keys they share sit in one; Pascal and Saquel are real subsystems whose Foundry links land on tabs where they own a card or two; the Almanack and Image Description sit under the wrong personas; two help documents deep-link to sections that do not exist because nothing holds the list of cards; and there is no search. Decided, all confirmed with the human: a logical spine of ten plain-named groups in a left rail (with an "Advanced" tier per group) instead of top tabs, the page retitled The Foundry; a persona badge on every card, a persona row above the rail as the hub, and each persona a lens over the same page (Brahma becomes a Foundry subsystem with new art; the Host's cards wear the Salon's badge); one React-free registry (`lib/settings/registry.ts`) that renders the page, resolves every settings URL (new `?group=` / `?section=` / `?persona=` / `?q=`, old `?tab=&section=` bridged permanently), derives the Foundry hrefs, the workspace tab payload and the help-guide route patterns, and is held by a test over every help document's `url:`; an in-place search over card titles, descriptions and keywords with highlighting; a required attention strip (missing key, Concierge off duty, backfill owed, failed task, plugin trouble) whose first lit chip picks the default group, else Connections; and Connections organised by provider — one card per provider with its key and every connection, image and embedding profile that uses it, kind badges, an Add menu that preselects the provider, and a By kind toggle keeping today's four cards reachable. Full card-by-card move table, six phases. No code changed.
- `docs/developer/features/ROADMAP.md` and `.claude/commands/update-documentation.md` list the spec.

#### Fix: Production build failed on `node:crypto` in the client bundle

- `character-field-semantics.ts` (imported by the Aurora new-character page) took its vault path constants from `lib/characters/vault/layout.ts`, which pulls the parsers and `lib/utils/stable-uuid.ts` (`node:crypto`) into the browser bundle. `next build --webpack` failed with `UnhandledSchemeError`.
- The path constants now live in client-safe `lib/characters/vault/paths.ts`; `layout.ts` re-exports them.

#### Feature: Aurora sends intent; a broken vault gets a repair card

- Phase 6 of `refactor-character-repository-and-vault.md`.
- The character page shows a vault-health card instead of "could not be loaded" when the item GET answers 503: each vault file present or absent, the parse error of a present one that fails, a **Restore** button that seeds only what is absent, and **Look again** (`app/aurora/[id]/components/VaultRepairCard.tsx`, query key `characters.vaultHealth`).
- The client no longer re-derives server rules. Hydration settles the default prompt (flags aligned with `defaultSystemPromptId`, column first), so the page reads the flag; a character's first prompt is the default on the server, so the prompts editor, the AI Wizard apply and the create form stop saying so; aliases are de-duplicated by `normalizeAliases` in the `properties.json` codec, so the AI Wizard and the Optimizer send the list they want.
- `applyCharacterFieldUpdates` is the one fan-out: the main PUT, then per-item prompt and scenario calls (new `scenarioUpdates`). The Optimizer's and TemplateTools' scenario applies go through the per-item route. No client mints a physical-description id or sends the retired `name`.
- `NewCharacterView` sends aliases, pronouns, birthday and kind in the one create (no follow-up PUT). The Metadata card and the Progressions card save through `?action=patch-metadata`, so neither can overwrite the other's keys.
- Fix: `CreateNPCDialog` read `id` from the `{ character }` envelope, so an uploaded NPC avatar was posted to `/api/v1/characters/undefined`.
- Docs: `help/character-editing.md` (When the Vault Is in Disarray; Clear; per-item prompt and scenario files; key-level fact-sheet saves).
- Tests: `vault-repair-card.test.tsx`, new cases in `apply-character-field-updates.test.ts` and `character-page-save-model.test.ts` (no client default-prompt derivation, no whole-array PUT, no minted physical id); `template-highlighter`, `progressions`, `wizard-text-fields` and `character-autosave-patch` tests updated.

#### Feature: Derived, strict character API; vault health and repair; key-level metadata patch

- Phase 5 of `refactor-character-repository-and-vault.md`.
- `lib/characters/api-schemas.ts` derives `updateCharacterSchema` and `createCharacterSchema` from `CharacterSchema` minus server-owned fields; both are `.strict()`, so an unknown key is a 400 instead of a silent drop (#146's shape). The PUT refuses `systemPrompts` and `scenarios` (they have per-item routes); the create takes them and mints ids. The PUT handler has no hand-written field list; it publishes `characters` after a write; `?action=depiction-guidelines` runs the archive guard.
- `GET /api/v1/characters/[id]?action=vault-health` reports each layout file from the row and the file list without hydrating; `POST ?action=repair-vault` seeds an absent `properties.json` / `metadata.json` (or scaffolds a missing vault) and nothing else (`lib/characters/vault/health.ts`). The item GET and POST check existence on the raw row and hydrate per action, so both answer for a character whose hydrated read is a 503.
- `PUT ?action=patch-metadata` takes `{ set, unset }` and merges keys server-side under a per-character write chain (`CharactersRepository.patchMetadata`); 409 when the sheet is present but not an object. The repository primitive and job-child writers still replace the whole object.
- `?action=avatar` returns `{ character }` like every other character-returning action. `CharacterArchivedError` is a 409 in the route error handler. The mount-point rename guard uses `findByStorePointerRaw` instead of scanning every character.
- The Almanack lists the vaults whose `properties.json` the boot heal found invalid and names the health and repair actions.
- A single read (`findById`) now refuses a `properties.json` that is present but will not parse, as it refuses a missing one, so the character page answers 503 and shows the repair card instead of opening with default settings. List reads stay lenient so the character remains in the roster. `vault-health` lists the file under `needsAttention`; its parse error drops the strict parser's who-and-where prefix.
- Docs: `docs/developer/API.md`. Tests: `vault-health.test.ts`, `put.route.test.ts` (unknown key, sub-collections, server-owned fields refused), `patchMetadata` cases in `vault-stable-ids.test.ts`; the Almanack snapshot.

#### Refactor: Characters on the store-backed base

- Phase 4 of `refactor-character-repository-and-vault.md`. `AbstractStoreBackedRepository` is generic over row and entity and takes the pointer column (`pointerField`), an update guard (`guardUpdate`) and post-write hooks (`afterCreate` / `afterRename` / `afterDelete`) as parameters; `update()` reads the raw row once. `CharactersRepository` extends it with the vault binding (`lib/characters/vault/binding.ts`), the archive guard and the store-name reconcile as hooks, and keeps only character-specific methods. `createBoundToVault` is `createBoundToStore`; `findByOfficialMountPointIdRaw` / `findByDocumentMountPointIdRaw` are `findByStorePointerRaw`.
- `ensure-official-store.ts` takes the store name, shape, stale-pointer rule (`heal` / `trust`), adoption rule and post-create seeding as config; projects and groups adopt by link, a character vault by name (never a vault another character owns), and `ensureCharacterVault` is its binding.
- Restore binds characters with `createBoundToStore` and re-provisions a failed vault through `provisionOfficialStore`. Import still provisions a scaffold vault it later discards (see the spec's §10).
- Tests: `restore-store-binding.test.ts`, `ensure-store-raw-fk.test.ts` and the vault chokepoint test updated.

#### Refactor: Stable prompt and scenario ids; per-item writes

- Phase 3 of `refactor-character-repository-and-vault.md`. `Prompts/*.md` and `Scenarios/*.md` carry `id:` in frontmatter; parsers prefer it and fall back to the old path hash (`resolveFileItemId` in `lib/utils/stable-uuid.ts`, shared with the wardrobe), so existing references keep working and an id survives a rename. Project, group and General scenarios follow the same rule (`ParsedScenario.id`; `idForPath` / `characterScenarioIdForPath` removed).
- The repository's prompt and scenario operations write, rename (through `renameDocument` + `sweepChatDocumentsAfterMove`) or delete one file each (`lib/characters/vault/items.ts`), never sweeping a file that does not parse as an item. `addSystemPrompt` and `addScenario` return the real id; the bug-165 re-read and the transient-id special case in the default-prompt column are gone, and the column always names the effective default. `update()` refuses `systemPrompts` / `scenarios`. The rename service writes per item.
- The prompt and scenario routes check existence on the raw row, publish `characters`, and the scenario routes take `description`.
- Tests: `vault-stable-ids.test.ts` (ids across a rename, adds, the default column, drafts untouched, read counts), `sub-collection-routes.test.ts`; `character-add-scenario-projected-id.test.ts` and `character-default-system-prompt-lockstep.test.ts` replaced.

#### Docs: Projects and groups stay on their own store engine

- Phase 7 of `refactor-character-repository-and-vault.md` (gated) was attempted and not kept: the project and group stores throw on an invalid `properties.json` and on a null pointer, which the character layout table has no descriptor for, and the engine is typed to `Character`. Recorded in the spec's §10.
- The spec moved to `docs/developer/features/complete/`; `CLAUDE.md` gains a chokepoint paragraph for the character vault; `DDL.md` (characters), `SYSTEM_FLOWCHARTS.md` §10 (Character Write) and `ROADMAP.md` updated.

#### Refactor: One character vault layout table, in `lib/characters/vault/`

- Phase 2 of `refactor-character-repository-and-vault.md`. The character's vault layout — which field lives in which file, its codec, its default, its scaffold seed and whether it is a keystone — is one declarative table, `CHARACTER_VAULT_LAYOUT` in `lib/characters/vault/layout.ts`. The physical description is one composite entry over its two files. Derived from it: the hydrator (`hydrate.ts`, a fold over the table), the patch writer and the full projection (`write.ts`), the scaffold seeds (`scaffold.ts`), the keystones (`CHARACTER_VAULT_KEYSTONES`, used by vault adoption and the filesystem sync planner), the archive keep-set (`CHARACTER_VAULT_KEEP_PATHS`), the character page's "character files" figure (`CHARACTER_VAULT_FILE_PATHS`) and `MANAGED_FIELDS`. A `CharacterVaultFilePath` union keeps `CORE_VAULT_FILE_SUMMARIES` exhaustive.
- `lib/database/repositories/vault-overlay/` and the `character-properties-overlay.ts` barrel are gone. Wardrobe modules moved to `lib/wardrobe/` (`vault-parsers.ts`, `vault-readers.ts`, `vault-writes.ts`, `vault-sync.ts`), inventory modules to `lib/inventory/` (`vault-readers.ts`, `vault-writes.ts`), `item-folder-ops.ts` and `vault-projection.ts` to `lib/mount-index/`, `stableUuidFromString` to `lib/utils/stable-uuid.ts`. `lib/mount-index/character-scaffold.ts` is `lib/characters/vault/scaffold.ts`. The prompt / scenario / physical renderers moved from `character-vault.ts` into the layout. `CharacterArchivedError` and `validateCharacterArchivePatch` live in `lib/characters/archive-guard.ts` (re-exported by the repository), so `lib/mount-index/` no longer imports a repository.
- Deleted: the eleven per-field `readCharacterVault*` readers (three had callers; they now read one file through `readVaultFile`), the uncalled `readCharacterVaultManagedFields`, `CHARACTER_VAULT_DESCRIPTORS`, `REQUIRED_VAULT_FILES` and the planner's restated keystone list, and the second copy of the default-prompt normalisation. `readVaultTextFile` is `readVaultFile`; new `readVaultFileStrict` throws on an unreadable file instead of reporting it absent. The strict `properties.json` parse is one function, `parsePropertiesStrict`, used by the patch writer and the heal.
- A fresh vault's `properties.json` seeds `title` and `firstMessage` as `null` (it seeded `''`), matching what the projection writes; its `physical-prompts.json` carries `headAndShoulders: null`.
- `migrateVaultPhysicalFiles` seeds through `ensureCharacterPhysicalFiles`. The Almanack, the Host's identity read, the Brahma SQL prompt and the self-inventory checklist take their paths from the layout.
- Tests: `vault-layout.test.ts` (the table covers exactly the managed fields; every codec round-trips), `vault-chokepoint.test.ts` (only the vault module spells a vault path or writes a layout file; the whole-character projection has exactly its two sanctioned callers; no file hand-lists the managed set). The overlay test moved to `__tests__/unit/lib/characters/vault-hydrate-write.test.ts`, the scaffold test to `vault-scaffold.test.ts`; tests of the deleted readers were removed.

#### Refactor: `CharacterRow` and `Character` are two types

- Phase 1 of `refactor-character-repository-and-vault.md`. `lib/schemas/character.types.ts` now defines `CharacterRowSchema` (the slim `characters` table) and `CharacterManagedFieldsSchema` (the nineteen vault-managed fields); `CharacterSchema` is the row extended with them. `CHARACTER_MANAGED_FIELDS` and `characterManagedDefaults()` are derived from the schemas; `MANAGED_FIELDS` in the vault overlay is built from them instead of a hand-kept list.
- `CharactersRepository` is generic on `CharacterRow`. `findByIdRaw`, `findAllRaw`, `findByDocumentMountPointIdRaw` and `createBoundToVault` return `CharacterRow`; every hydrated read returns `Character`. `_update` validates against the row schema, so a managed field cannot reach `$set`; the managed-field stripping in `toPersistedRow` / `_update` is gone. `addTag` / `removeTag` read the raw row and return the hydrated character.
- The read overlay takes rows and starts every character from the managed defaults, so a character with no vault hydrates to defaults rather than whatever the row validator filled in.
- Callers the compiler flagged: the Post Office takes rows; consolidation's and the Commonplace mirror's raw fallbacks say explicitly that a row has no identity or description; maintenance builds its content-less holder from the defaults; Brahma's lookup hydrates namesakes before matching aliases (a raw row has none, so the alias match silently found nothing when two characters shared a name).
- Fix: `migrateVaultPhysicalFiles` wrote the raw row's (always empty) physical description over `physical-description.md` whenever `physical-prompts.json` was missing. It now seeds the absent file and leaves an existing description alone.
- Tests: `character-row-split.test.ts`; `character-properties-overlay.test.ts` updated.

#### Docs: spec for refactoring the Green Room, casting and the opening

- New spec `docs/developer/features/refactor-green-room-and-opening.md`. `POST /api/v1/chats` does fourteen jobs in one blocking request, three of them model calls, behind a dialog that cannot be dismissed; the greeting is composed by a legacy prompt builder (`lib/chat/initialize.ts`) that no later turn uses, with private recall copies and a four-rung provider ladder; every chat's first row is a SYSTEM message every reader filters out; the opening speaker is drawn by a second copy of the turn manager's pick; arrival (dress, pack, compile, announce, draw) is spelled three times with three default rules; the New Chat client mirrors server precedence and sends "byte-identical" bodies. Twelve decisions of record, all confirmed with the human: casting returns as soon as the row exists and the opening runs afterwards as a stoppable, resumable, turn-locked operation; the greeting is a turn with `purpose: 'opening'` through the Salon pipeline, streamed live; the Green Room becomes a panel in the Salon fed by a `greenRoom` stream frame; one `seatArrival` for chat start, joins and merges, every arriving seat announced and drawn; `openingState` patch-only; server-side casting defaults; a query-backed, overrides-only New Chat form with one mount; the SYSTEM row no longer written for new chats. Six phases; the last is gated. No code changed.
- Four defects found while writing it are to be filed as issues at the start of Phase 1: a seat added mid-chat with "Dress Themselves" gets no Green Room narration; omitting `outfitSelections` from the API dresses `canChooseOutfit` characters in defaults where the dialog would let them choose; the greeting's recall stamps `lastAccessedAt` outside `deliverRecall`; the participant-level `imageProfileId` is documented as ignored but consulted.
- `docs/developer/features/ROADMAP.md` and `.claude/commands/update-documentation.md` list the spec.

#### Fix: The startup vault heal never writes over content (#148); Clear clears (#149); array PUT keeps archived scenarios (#150)

- Phase 0 of `refactor-character-repository-and-vault.md`.
- #148: `backfillCharacterVaults` read `properties.json` fail-soft and, on any failure (absent, unreadable, malformed or schema-invalid, e.g. `talkativeness: 0`), re-projected the raw character row into the vault. A raw row has no content, so this wrote `''` over `identity.md`, `description.md`, `manifesto.md`, `personality.md` and `example-dialogues.md` and swept `Prompts/` and `Scenarios/` empty. The heal now reads the keystone with the strict for-write reader: an absent file is seeded with defaults (`ensureCharacterPropertiesFile` in `lib/mount-index/character-scaffold.ts`), a present-but-invalid one is logged at `error`, counted (`keystonesInvalid`, `invalidKeystones`) and left alone. Nothing else is written. `BackfillResult.filesRepopulated` is gone.
- `ensureCharacterVault` no longer projects content into a vault it creates; it writes the scaffold only. Callers holding a raw row (mail, subprompts, seed, the write overlay's on-the-fly provisioning) get defaults and blank files instead of `''` files that look authored. A same-name vault already linked to another character is never adopted. New `provisionCharacterVaultWithContent` (ensure without adoption, then project) is the path for `create` and for the restore fallback that re-provisions a character whose vault failed to arrive; that fallback now projects the backup's content rather than an empty row. The cutover migration falls through to its populate step when it creates a vault.
- #149: `update({ physicalDescription: null })` now writes an empty `physical-description.md` and a `physical-prompts.json` with every prompt `null`, keeping `humanoid`. Before, the write overlay skipped the vault on `null` and the Clear button did nothing.
- #150: the character PUT's scenario item schema carries `archived` and `description`, so a whole-array save (the Optimizer's apply, TemplateTools) no longer un-archives scenarios or drops descriptions.
- Prompt and scenario folder projections pass `ownsFile` (`isPromptItemDocument` / `isScenarioItemDocument` in `vault-overlay/parsers.ts`, quiet twins of the parsers): a whole-array write sweeps only files that parse as items, so a hand-written `Prompts/draft.md` without frontmatter, or a scenario with an empty body, survives a save.
- Tests: `backfill-character-vaults-heal.test.ts`, `physical-description-clear.test.ts`, `vault-projection-owns-items.test.ts`, a new case in `put.route.test.ts`; `backfill-character-vaults-metadata.test.ts`, `character-properties-overlay.test.ts` and `restore-store-binding.test.ts` updated.

#### Docs: spec for refactoring the character repository, the vault and Aurora's writes

- New spec `docs/developer/features/refactor-character-repository-and-vault.md`. `CharactersRepository` re-implements about 250 lines of `AbstractStoreBackedRepository` (the base projects and groups share), the vault layout is spelled in nine places, prompt and scenario ids are path hashes that change on rename, and every sub-collection save re-projects the whole folder and deletes any file it does not recognise. Twelve decisions of record: a `CharacterRow` type distinct from `Character`, one store-backed base with the pointer column and the archive guard as parameters, one declarative layout table in `lib/characters/vault/` that every reader, writer, seed, keystone list and keep-set derives from, frontmatter `id:` on prompt and scenario files, per-item writes, derived strict API schemas, a vault-health / repair action, a server-side key-level `metadata` patch for the HTTP route, and the client's copies of server rules deleted. Eight phases; the last (projects and groups on the same engine) is gated. No code changed.
- Three defects found while writing it are filed: #148 (the startup vault backfill writes blank content and sweeps every prompt and scenario when `properties.json` is invalid), #149 (clearing a physical description is a no-op), #150 (a whole-array scenarios PUT un-archives scenarios and drops descriptions). Phase 0 of the spec fixes them.
- `docs/developer/features/ROADMAP.md` and `.claude/commands/update-documentation.md` list the spec.

#### Fix: Custom tooltips no longer stick open

- `components/ui/Tooltip.tsx` closed only on the anchor's own `pointerleave` or `blur`. Neither fires when the trigger re-renders or vanishes under the pointer, when an overlay covers it, or when the window loses focus mid-hover, so the bubble could stay up indefinitely.
- While a bubble is open, a document-level `pointermove` listener now starts the close grace period whenever the pointer is outside the anchor and bubble (unless pinned, or opened by keyboard focus that is still inside the anchor). It also closes on any `pointerdown` outside the bubble (pinned or not), on window `blur`, and when the document is hidden.
- Focus opens the bubble only when it is `:focus-visible`. Before, a mouse click on a trigger, or `useDialogFocus` restoring focus to a trigger when a dialog closed, opened a tooltip that nothing would close until the next blur.
- Touch `pointerenter` no longer opens a bubble; pinnable triggers still open on click.
- Docs: `help/appearance-settings.md` (A Word on Tooltips).
- Tests: new cases in `__tests__/unit/components/tooltip.test.tsx`; `MentionChip.test.tsx` now simulates keyboard focus.

#### Fix: Folder moves match folder paths case-insensitively (#147)

- A filesystem store's `move-folder` typed in another casing (`notes` for `Notes/`) renamed the directory on a case-insensitive disk but left every `doc_mount_folders` row and `doc_mount_file_links` row at the old path, so the next scan dropped the files (chunks, embeddings, descriptions) and re-added them as new. `moveFolderWithinMount` (`lib/mount-index/folder-ops.ts`) now matches the source row and the descendant prefixes case-insensitively, as `under()` and the database store's NOCASE lookups already did.
- `chatDocuments.findUnderFolder` matches the folder prefix case-insensitively, so a Document-Mode row recorded as `Notes/a.md` is swept by a move of `notes`.
- A within-store folder move from the Scriptorium (`?action=move-folder`, both storage types) now calls `sweepChatDocumentsAfterFolderMove`, so open documents under the folder follow it. Before, only the doc tools' moves swept them.
- Docs: `help/mount-points.md`.
- Tests: `__tests__/unit/lib/database/repositories/chat-documents-find-under-folder.test.ts`, new cases in `folder-ops-fs-move.test.ts`.
- The other-casing case in `folder-ops-fs-move.test.ts` assumed a case-insensitive disk and failed on Linux CI (`SOURCE_NOT_FOUND`). It now probes the temp dir: on a case-insensitive disk it checks the rows are carried; on a case-sensitive one it expects the move refused and no rows written.

#### Fix: Wardrobe pop-up dialogs no longer sit under the left rail

- The image-prompt optimizer, import-from-image, item editor and the editor's mode-change prompt rendered inside the `.qt-workspace` stacking context, so the left nav rail (and sticky toolbar) painted over their edges at narrow widths (1024px cut off the dialog title and the start of each line). All four now render through `createPortal(..., document.body)`, matching `BaseModal` and the search dialog.
- `import-from-image-modal.outfit.test.tsx` finds the file input on `document.body`.

#### Feature: Wardrobe image-prompt optimizer; import-from-image writes image prompts

- New "Polish portrait cues" wizard in the Wardrobe dialog, on every wardrobe tier — a character's, a group's, a project's and Quilltap General (`components/wardrobe/image-prompt-optimizer-modal.tsx`). The cheap LLM checks each of the browsed tier's own garments' `imagePrompt` against its title, slots and description, fills blank ones, fixes ones that contradict the description, and trims ones over 200 characters. Pieces from other tiers, archived items and composites are excluded; multi-slot leaves are included. The operator reviews (and may edit) each recommendation, then applies all of them or a chosen subset.
- `POST <tier>/wardrobe?action=optimize-image-prompts` (characters, groups, projects and `/api/v1/wardrobe`) returns recommendations and writes nothing; `?action=apply-image-prompts` writes the chosen cues. Registered on every tier by the wardrobe route factory; only a character tier's review is filed against the character in the LLM logs. Logic in `lib/wardrobe/prompt-optimizer.ts` (batches of 12, two in flight, cheap-LLM task `optimize-wardrobe-image-prompts` logged as `IMAGE_PROMPT_CRAFTING`, `interactive` latency); writes through new `updateItemImagePrompts` in `lib/wardrobe/item-mutations.ts` (one `updateMany` projection, composites skipped).
- The 200-character limit is now one constant with a clamp, `lib/wardrobe/image-prompt-limit.ts` (`WARDROBE_IMAGE_PROMPT_MAX_LENGTH`, `clampWardrobeImagePrompt`: strips Markdown, quotes, line breaks and a trailing period; cuts at a comma or word boundary). The item editor uses the constant.
- Import from image: the vision analysis now asks for an `imagePrompt` on every proposed item; the parser clamps it and falls back to the title when the model omits one. The review screen shows it as an editable Portrait Cue field, and it is sent on create.
- Docs: `help/wardrobe.md` (Polishing Every Cue at Once; import-from-image), API.md.
- Tests: `__tests__/unit/lib/wardrobe/prompt-optimizer.test.ts`, new cases in `image-analysis.test.ts`, `item-mutations.test.ts`, `routes/wardrobe-route-factory.test.ts`.

#### Feature: The Green Room chooses what a character carries

- A character whose outfit mode is `llm_choose` now also chooses their arrival Inventory. `applyInventoryDefaults` takes `choose` (`InventoryGreenRoomOptions`: character ids, scenario, cheap-LLM config, progress emitter); chat creation, add-participant and merge pass it for `llm_choose` selections.
- `chooseArrivalInventory` (`lib/inventory/green-room.ts`) offers the character's reachable carriable objects and kits (no archetypes, no archived objects, no project-shelf objects when the roster does not admit them), with defaults marked "usually carried", plus scenario, character fields, seat subprompts and the outfit just chosen. New cheap-LLM task `chooseLLMInventory` (`lib/memory/cheap-llm-tasks/inventory-selection.ts`, task type `inventory-selection`) returns `{"carry": [ids]}`; ids not offered are dropped, an unreadable answer is a failure, an empty list is kept.
- Choices run concurrently outside the chat's inventory lock; the commit is serial under it. The pick is equipped leniently, silently, with `character` provenance. A failure, a timeout, or no model falls back to the existing rules (source-chat copy, then defaults). A Green Room pick wins over a continuation's copy.
- Uses the Green Room's model (`selectGreenRoomLLM`). The timeout and seat-subprompt helpers moved from `apply-outfit-selections.ts` to `lib/wardrobe/green-room-model.ts` (`withGreenRoomTimeout`, `GREEN_ROOM_LLM_TIMEOUT_MS`, `resolveGreenRoomSubprompts`) so both passes share them.
- The status dialog logs each character's choice ("Packing everyone's pockets…").
- Docs: `help/inventory.md` (Packing in the Green Room), `help/wardrobe.md`, `help/chats.md`.
- Tests: `__tests__/unit/lib/memory/cheap-llm-tasks/inventory-selection.test.ts`, `__tests__/unit/lib/inventory/green-room.test.ts`.

#### Feature: Turns mode; Paused renamed Manual

- The Salon's turn-mode control has four positions: Normal, Manual, Turns, Storyteller. Manual is the old Paused (`isPaused`, label change only).
- Turns (`chats.turnMode = 'turns'`, new value of `ChatTurnModeSchema`; the column is TEXT, so no migration) runs the chain until the cycle closes, i.e. every present character seat has spoken or passed once, then stops with chain-complete reason `turn_complete` (`paused: false`). A user-driven seat reached mid-round still stops the chain as `user_turn`, and the operator's post counts as that seat's turn.
- Cycle close is `turnClosesCycle` (`lib/chat/turn-manager/state.ts`), the same predicate `advanceSpokenThisCycle` wraps on, read against `spokenThisCycleParticipantIds` before the turn is recorded. The finalizer (`readTurnClosesCycle`) and the pass path (`closePass`) set `ProcessMessageResult.closedCycle`; `executeTurnChain` checks it after the first answer and after each chained turn and re-reads `turnMode` fresh.
- On `turn_complete` the chain queues `triggerTurnMemoryExtraction` with the latest turn's profile (the queue dedupes it against the finalizer's own turn-close trigger). A round that closed on passes alone queues nothing.
- Sidebar: Next Round button in Turns mode (runs `handleContinue`); a one-time toast when the first round closes. Continue (and Next Round) now says the floor is yours when the next seat is the operator's own; it used to show "No characters available to speak" for the operator's own seat and nothing for another user-driven seat.
- The turn-mode control (`qt-storyteller-mode`) is a 2x2 grid instead of one row: four equal slots in the sidebar clipped "Storyteller" under themes that uppercase and letter-space buttons (Art Deco). theme-storybook 1.0.104.
- Docs: `help/chat-participants.md`, `help/chat-multi-character.md`, `help/storyteller-mode.md`, API.md, DDL.md, export schema.
- Tests: `__tests__/unit/lib/chat/turn-manager/turn-closes-cycle.test.ts`, Turns cases in `turn-orchestrator.test.ts`.

#### Feature: Edit any line in the Salon, with warnings about what the edit disturbs

- The pencil now appears on every message row, not only the operator's: character lines, Staff announcements, Carina answers and established facts. `PUT /api/v1/messages/[id]` already accepted any message; the Salon was the gate (`MessageActionBar`).
- Opening the editor calls the new `GET /api/v1/messages/[id]?action=edit-impact`, answered by `assessMessageEditImpact` (`lib/services/chat-message/message-edit-impact.ts`). It reports whether a model has read the line since it landed (chat `llm_logs` rows after `createdAt`, less the line's own `CHAT_MESSAGE` / `TOOL_CONTINUATION` rows, via new `LLMLogsRepository.countForChatSince`; later character lines as the fallback when logging is off) and how many memories the old text formed. The editor (`message-row/MessageEditor.tsx`) shows a warning for the first and, for the second, a "regenerate on save" checkbox that defaults to on.
- `locateMemorySource` maps a line to the path that stamped its memories: a conversation line to its whole extraction turn (turn memories carry the turn's last character line, so a user line's memories sit on another row; autonomous rooms use the speaker anchor span), a Carina answer to `CARINA_MEMORY_EXTRACTION`, a machine established fact to `ESTABLISHED_FACT_MEMORIES`. Other Staff rows have no memory source.
- `PUT` takes `regenerateMemories: true`. After the edit is written, `regenerateEditedMessageMemories` retires the sourced memories through `retireMemories` (new reason `message-edit`; AUTO rows only, except an established fact's MANUAL rows) and enqueues that path's job (a turn job runs with `backfill: true`, so it reads the turn whole past the live cursor). With no profile to extract on, nothing is retired. Response adds `memoriesRetired`, `memoryJobId`, `memoryRegenerateFailed`.
- Editing a row that carries `opaqueContent` clears it, so opaque chats send the edited text instead of the stale persona-free copy.
- The client now drops a saved row's `renderedHtml`, so an edited character line no longer keeps showing its pre-rendered old text until reload.
- `resolveChatExtractionProfileId` (`lib/memory/extraction/context.ts`) replaces the queue-memories action's private resolver; `isAutonomousTurnAnchor` is exported from `turn-transcript.ts`.
- Not covered: tool-result rows (rendered by `ToolMessage`) and the pending Courier placeholder have no pencil. Fold-grain memories sourced inside the edited turn are retired with the turn's and come back only as turn memories.
- New `qt-chat-message-editor*` classes (`_chat.css`) for the editor layout; storybook CSS regenerated, `@quilltap/theme-storybook` 1.0.103.
- Test: `__tests__/unit/lib/services/chat-message/message-edit-impact.test.ts`.

#### Fix: Anthropic plugin no longer caches the turn's whispers instead of its history

- `applyHistoryBreakpoints` (Anthropic plugin `provider.ts`) put the conversation breakpoint on `messages.length - 2`. In a Salon turn that is usually the last of the whispers sent just before the newest user line, not history. Snapshot whispers are swept and replaced on later turns, so the entry was often never read. Friday, `claude-sonnet-4-6`: reads stalled at 60,266 tokens for two turns while the history grew. With a multi-character `[Name]` prefill as the final message, `length - 2` was the newest user line itself.
- Breakpoints now go, in order and within the four-breakpoint budget: the final message in a tool loop (the latest tool results); the previous reply (the message before the run of user messages ending in the newest line); the message just before the newest line when that is a whisper; the stepped mid-history mark. The newest line is the last user message that is not only tool results, wherever it sits. A lone message keeps its breakpoint. Placement is logged at debug. Anthropic plugin 1.0.67.
- Live, V4test, `claude-sonnet-4-6` with a whisper before the newest line: after a cold first turn, the next turn read 19,301 tokens and wrote 78, leaving only the newest line (about 2k tokens) uncached.
- Test: `__tests__/unit/plugins/anthropic-cache-breakpoints.test.ts`.

#### Fix: OpenRouter prompt caching; NanoGPT cache boundaries

- OpenRouter text-only non-streaming sends (most cheap-LLM tasks) went through the SDK's `chat.send()` and read cache hits from a top-level `usage.cachedTokens` the SDK never sets (it is `promptTokensDetails.cachedTokens`), so hits were never reported or excluded from token budgets. Every send now uses the one Chat Completions fetch body (`buildChatCompletionsBody`); the SDK is left for `models.list` and the key check. One usage reader, `readOpenRouterUsage`, serves send and stream and now also reads `prompt_tokens_details.cache_write_tokens` as `cacheCreationInputTokens`. Streams keep OpenRouter's usage object as `rawProviderUsage`.
- The per-character cache key now also goes out as `session_id` (OpenRouter's sticky provider routing starts on the first successful request, not after the first hit) and `prompt_cache_key`, besides `user`. OpenRouter skips stickiness when the profile sets `provider.order`.
- Claude on OpenRouter never cached: nothing sent `cache_control`. In V4test, `anthropic/claude-haiku-4.5` calls of about 18k prompt tokens 0.7 s apart showed no cache usage. New opt-in profile options **Enable Prompt Caching** / **Cache Duration** (`enablePromptCaching`, `cacheTTL`) place explicit breakpoints for `anthropic/*` and `~anthropic/*` models (`cache-breakpoints.ts`), at most four: the first system message; the message before the newest user line (the last `user` message, which a multi-character `[Name]` prefill may follow) and the previous reply before the final run of user messages; the final tool result in a tool loop; the host's summary-head mark; a stepped mid-history mark on long arrays. Every string content is lifted to a text part whenever caching is on, marked or not: OpenRouter merges consecutive same-role messages, and lifting only the marked one changed how its run rendered, which lost every history hit in the first live run. OpenRouter's automatic top-level `cache_control` is not used because it marks the last block, which in the Salon is the turn-variable newest user line. OpenRouter plugin 1.0.72.
- Live, V4test, Haiku 4.5 through OpenRouter (BYOK): before the lift and prefill fixes, every turn read only the 16,286-token tools+system prefix; after, turns read 18,516/18,924, 18,624/19,162 and 18,100/19,146 prompt tokens, and the second step of a tool loop 18,778/19,283.
- NanoGPT's explicit caching helper now sends `cutAfterMessageIndex` = the message before the newest user line (none for a lone message or a tool loop), so its automatic Claude breakpoints cannot land on the turn-variable newest line. The profile help now says explicit caching is billed pay-as-you-go outside a subscription. NanoGPT plugin 1.2.14.
- Audit, Friday: NanoGPT implicit caching is working (e.g. `abliterated-model-large-flash` chat turns 169/197 with cache usage, `deepseek-v4.1-flash` memory extraction 1127/2134).
- Tests: `__tests__/unit/openrouter-text-provider.test.ts`, `__tests__/unit/plugins/nanogpt-reasoning.test.ts`.

#### Fix: Z.AI plugin sends the prompt-cache key as `user_id`

- Z.AI's chat API names its end-user field `user_id` (6–128 characters). The plugin sent OpenAI's `user`, which Z.AI does not list, so the per-character cache key from `buildCharacterCacheKey` never reached it. `zaiUserId` (plugin `provider.ts`) now puts the key in `user_id` on both send and stream, and omits a key outside the documented length rather than risk a 400. Z.AI plugin 1.1.35.
- DeepSeek streams now keep the provider's own usage object (`prompt_cache_hit_tokens` / `prompt_cache_miss_tokens`) on the final chunk as `rawProviderUsage`, so the LLM log records DeepSeek's hit/miss split. DeepSeek plugin 1.0.31.
- Audit, Friday instance, same multi-character chat with identical system blocks and tools across turns: DeepSeek `deepseek-v4-flash` hit about 85% of prompt tokens per call; Z.AI `glm-5.3-flash` hit 0 on 13 straight turns with byte-identical message prefixes, and hits on other chats land on fixed sizes (often 32768). The prefix Quilltap sends is stable, so the Z.AI shortfall is on the provider side or in routing. Whether `user_id` improves it still has to be measured.
- Test: `__tests__/unit/plugins/prompt-cache-wire-fields.test.ts`.

#### Security: Docker production image moves from Debian bookworm to Wolfi

- The production stage of `Dockerfile` and `Dockerfile.ci` now starts from `cgr.dev/chainguard/wolfi-base:latest` and installs `nodejs-24`, `libstdc++`, `bash`, `zip` and `unzip` with `apk`. Every finding left in the `node:24-bookworm-slim` image (1 critical, about 10 high: util-linux, zlib, ncurses, systemd libraries, gzip, acl) was a Debian package marked affected, fix-deferred or will-not-fix, so `apt-get upgrade` could not clear them; `node:24-trixie-slim` scanned worse (13 high). Trivy on a local arm64 build: 97 findings (1 critical, 9 high) on the published 4.13.0-dev.29 image, 1 on the Wolfi build (a low in the app's own `katex` dependency, not the OS).
- Only the production stage changed. The build stages stay on `node:24-bookworm-slim`, because Wolfi only packages npm 12 and the lockfile is installed with npm 11 as in CI. node_modules built there (glibc 2.36) load on Wolfi's glibc 2.44; the SQLite driver, sharp and node-pty are all Node-API.
- The base tag is deliberately unpinned. Wolfi rebuilds it daily, and a moving tag is what invalidates the GitHub Actions layer cache so `apk upgrade` actually pulls new fixes.
- The npm/corepack/yarn removal and the forced `perl` purge are gone: npm is a separate Wolfi package that is never installed, and nothing pulls perl in.
- The `nextjs` user and `nodejs` group keep UID/GID 1001 (now created with busybox `addgroup`/`adduser`), so existing volumes stay writable.
- Images that layer extra tools on top must use `apk add` instead of `apt-get`. `docs/DEPLOYMENT.md` and `help/ariel.md` say so.

#### Change: Salon agent-mode turn cap raised to 50

- `AgentModeSettingsSchema.maxTurns` now allows 1–50 (was 1–25); the default stays 10. The Chat settings dropdown adds 30, 40 and 50.

#### Change: Brahma Console turn budget has no upper bound; default 10

- `maxAgentTurns` in `instance_settings['brahmaConsole']` is now any integer ≥ 1 (was 5–200) and defaults to 10 (was 50). The operator's value is the only ceiling on the Console's and one-shot `@Brahma`'s tool-use turns; the duplicate/stale-query guard still stops a looping run.
- The default is one constant, `DEFAULT_BRAHMA_MAX_AGENT_TURNS` in `lib/schemas/settings.types.ts`, used by the schema, `lib/instance-settings`, `turn-budget.ts` and the settings dial. `resolveBrahmaMaxAgentTurns` now logs the resolved budget (debug) and an unreadable setting (warn).
- `BoundedNumberInstanceSetting` takes an optional `max`; with none, the input has no `max` attribute and the hint reads "at least N".
- A stored value is kept as is, including a 50 written by an earlier save of the inline `@Brahma` engine (the PUT merges the whole object). Salon agent mode has its own cap (see above).

#### Feature: Brahma Console SQL cards collapse; thinking interleaves with queries

- Each `run_sql` card in the Brahma Console now starts collapsed to one line: database, a one-line query preview, and the row count or failure. Expanding it shows the Query and Result panes as before New `qt-tool-card-summary` / `qt-tool-card-chevron` / `qt-tool-card-preview` classes style the summary line.
- Thinking is shown where it happened instead of as one block above the answer. The orchestrator stores the reasoning that preceded each tool-call turn on that turn's (content-less) assistant message, and the final answer carries only the reasoning since the last tool call. The transcript renders reasoning-only assistant messages as collapsed Thinking blocks between the SQL cards. Older chats keep the whole chain on the final message and render as before.
- While streaming, the hook records where each tool batch fell in the cumulative reasoning (`streamingToolBatchMarks`); `segmentLiveRun` (`components/brahma-console/brahma-sql-tool-call.ts`) splits the chain around the batches. Only the trailing stretch stays open.
- `ThinkingBlock` gains `align: 'end' | 'start'` (default `end`, unchanged for the Salon). The console uses `start`, backed by the new `qt-chat-thinking-start` class, so thinking sits flush left with the SQL cards instead of jumping right when expanded. `@quilltap/theme-storybook` 1.0.102 with regenerated CSS.

#### Chore: dev-tag cleanup deletes Docker Hub images by digest

- `remove-old-dev-tags` removed old dev images with `regctl tag rm`, which on Docker Hub only drops the tag; the manifests and layers stayed untagged and kept using storage (`foundry9/quilltap` passed 200 GB). Step 7 now deletes each old version's index and its child manifests (both images and both attestations) by digest, skips digests reachable from the kept dev version and `latest`, and stops if the registry token lacks delete scope instead of falling back to tag-only removal. Images already left untagged must still be cleared from Docker Hub's web UI.

#### Fix: character page follow-ups; physical description name and usage context retired

- Header menus (avatar, Generate, ⋯) opened offset down and right. The sticky header's `backdrop-blur` makes it the containing block for `position: fixed`, so the viewport coordinates from `fixedMenuPlacement` were applied relative to the header. `hooks/useFixedMenu.ts` now finds an ancestor that captures fixed positioning (`fixedContainingBlock`: transform, filter, backdrop-filter, perspective, contain, will-change) and places the menu against its box. Applies to every `ItemActionMenu`.
- Header stats add the character's own Inventory shelf: objects, carried by default, archetypes and kits, each opening the Inventory dialog. `?action=stats` returns `stats.inventory`. The header's stats now re-read on `inventory` and `wardrobe` realtime events.
- The header avatar fills the header's height (square, 96–240 px) instead of a fixed 80 px. `ItemActionMenu` gains `containerClassName`.
- Removed the duplicate "Tags" label on Details (the tag editor has its own).
- New Metadata card on Details: lists the `metadata.json` keys and edits them as JSON in a modal. Only JSON objects are accepted; the reserved `progressions` key is excluded from the editor and re-read fresh and carried over on save, since the PUT replaces the whole object.
- The photo album in Appearance is collapsible and starts collapsed, like avatar rolls and wardrobe pictures.
- History's Conversations and Memories cards start collapsed (`SectionCard` gains `collapsible` / `summary`) and page with Previous/Next (`components/ui/ListPager.tsx`) instead of infinite scroll. Deleting a row re-reads the page.
- Stat links open the collapsed card they point at (`hooks/useAnchorReveal.ts`), and now scroll even when the target is in the section already showing.
- A character has one physical description, so its `name` and `usageContext` are removed from `PhysicalDescriptionSchema`, the character POST/PUT schemas, the page, the AI Wizard, AI import and NPC creation. Neither was stored in the vault (reads always produced `name: 'default'`, `usageContext: null`), so nothing is migrated; old payloads and exports carrying them are stripped by the non-strict schemas.
- The identity stack's appearance line is now `This is how you look: …` (no quoted label, no `(best used: …)`). `IDENTITY_STACK_BUILDER_VERSION` is 3; goldens registered.
- Appearance resolution takes one description per character and decides clothing only: `CharacterAppearanceInput.physicalDescription` replaces the `physicalDescriptions` array, `selectedDescriptionId` and `physicalDescriptionName` are removed, and the cheap-LLM prompt no longer asks for a description choice. Prompt expansion drops `usageContext` / `entityName` from description tiers. The optimizer and Rename/Replace no longer read or rewrite the name.

#### Feature: Salon avatars fixed to their moment

- Each Salon bubble now shows its author's avatar as it was when the message was written. A new avatar (from a wardrobe or inventory change, the configuration cache, or set by hand) takes effect when it is bound to the chat; earlier bubbles keep the old one. Previously every bubble showed the character's current avatar.
- New table `chat_avatar_timeline` (migration `add-chat-avatar-timeline-table-v1`, no backfill). Written only by `ChatAvatarTimelineRepository.record`, from `bindAvatarToChat` and the `set-avatar` / `remove-avatar` actions; buffered from the job child and replayed in the parent. The first record for a (chat, character) writes a baseline row with the chat's prior per-chat avatar, so chats that predate the table keep their current look on earlier bubbles.
- `GET /api/v1/chats/[id]?action=avatar-timeline` returns the timeline with images resolved (`loadAvatarTimeline`, `lib/chat/salon-avatar-loader.ts`). `avatarAt` (`lib/chat/salon-avatar.ts`) picks the avatar in force; a row whose image is gone falls back to the latest surviving image for that character in the chat, then the current avatar. A "character's own avatar" row shows the character's default image, not the chat's per-chat avatar.
- `getMessageAvatar` in the Salon uses it for participant, announcer, Carina answerer and fallback branches. New query key `queryKeys.chats.avatarTimeline`, refreshed by the `chats` realtime topic.
- The table is included in backups, restore remapping, `.qtap` export/import (`avatar_timeline` records, `qtap-export.schema.json`) and character cascade delete.
- Tests: `avatarAt` selection and fallback, `record` baseline and no-op rules against real SQLite, and the import remap.

#### Docs: correct two out-of-date help pages

- `help/character-system-transparency.md` said System Transparency is mirrored into the vault's `properties.json`. It is a database column only (see DDL.md); the page now says so and why.
- `help/character-management.md` described a "Partnerships" feature (partner sections, Create Partnership buttons, dissolving partnerships) that does not exist. Replaced it with "Conversation Partners", covering what does exist: the default conversation partner in Chat Defaults, which pre-fills Play As in the New Chat dialog, and multi-character chats. `help/characters.md` updated to match.

#### Feature: one character page in Aurora; Fixes #146

- `/aurora/[id]/view` and `/aurora/[id]/edit` are replaced by one page at `/aurora/[id]` (`app/aurora/[id]/CharacterPage.tsx`) with six sections: Details, Prompts, Appearance, Abilities, Chat Defaults, History. Every control saves itself; only modals have Save buttons. Design of record: `docs/developer/features/complete/aurora-character-page-unification.md`.
- Save model: `lib/autosave/autosave-engine.ts` holds per-field drafts. Prose saves after 1.5 s idle and on blur, short text on blur or Enter, selects/toggles/stars on change. Drafts are coalesced into one partial PUT, one request in flight at a time, and flushed when the workspace tab or document is hidden, on `pagehide` (with `keepalive`) and on unmount. A failed save keeps the text, outlines the field and offers Retry in the header's status chip. An empty name is not sent. `useCharacterAutosave` wires the engine to the PUT and the TanStack cache.
- The page reads the character through TanStack Query (`queryKeys.characters.detail`, shared with progressions and the pronoun filter) and the header stats through the new `queryKeys.characters.stats` key, which the `characters` realtime topic now invalidates. `useCharacterView` / `useCharacterEdit` and the two route trees are deleted.
- Header: avatar menu (choose from photos, upload, generate portrait via the Wardrobe dialog), badges for kind / NPC / user-controlled / Carina / archived, every stat a link, Start Chat, a Generate menu (AI Wizard, Optimizer, Non-Quilltap prompt) and a ⋯ menu (Export, Convert to NPC, Archive, Delete — Delete is new on this page). Carina and user-control moved to Abilities.
- Details: Facts (with Kind and Tags), the Dossier with template tools, Progressions, and a new read-only Vault card. Empty prose fields render with their hint as placeholder. `{{char}}` / `{{user}}` and the names that could become them are tinted inside the editors via the CSS Custom Highlight API (`TemplateTokenHighlightPlugin`; no document changes). `MarkdownLexicalEditor` gains `placeholder` and `templateHighlight`.
- Prompts: the system-prompt star is the only default control; Subprompts and Progressions were lifted out of `SystemPromptsEditor`. Scenarios are a list with a modal, written per row through the scenarios route (the character PUT's scenario schema drops `archived`), with a star for the default scenario. The Default System Prompt and Default Scenario pickers are gone.
- Appearance: Photos, the physical description without its Save button (text autosaves; Humanoid saves on change), depiction guidelines (`AestheticEditorField` gains an `autosave` mode), Wardrobe and a new Inventory entry point.
- Abilities: transparency, Core whisper, Carina, diagrams, the wardrobe and inventory permissions, user-controlled and NPC. Tri-states show what Inherit resolves to.
- History: conversations, memories, Search & Replace and Rename / Replace side by side, LLM logs collapsed.
- `?action=stats` also returns `missingCharacterFiles`, `subprompts`, `mail`, `scenarioFiles` and `vault: { mountPointId, name }`. Deleting a character's default scenario clears `defaultScenarioId`.
- Routing: one workspace tab kind `character` (payload `{ characterId, section? }`) replaces `character-view` / `character-edit`. Saved workspace layouts are upgraded on load (`upgradeLegacyTab`; duplicate view+edit tabs collapse to one). `/aurora/[id]/view`, `/aurora/[id]/edit` and `/characters/[id]{,/view,/edit}` redirect to `/aurora/[id]` with the old `?tab=` mapped to `?section=` (`lib/characters/page-sections.ts`, `lib/navigation/legacy-character-redirect.ts`). `?action=chat` opens the New Chat modal beside the tab instead of living in its payload. The character page is no longer exempt from tab-activation refetch. Every internal link to the old URLs is updated. `EntityTabs` gains a controlled mode and scrolls sideways at narrow widths.
- Help chat: the entity picker accepts `/aurora/:id?section=…` templates, and pattern matching prefers the doc whose query matches the current URL.
- New Character form reuses the page's Facts and Dossier blocks (`components/characters/fields/`) and now saves aliases, pronouns, birthday and kind.
- Fix (#146): the edit form's System Prompt field, the create form's System Prompt and Scenario fields, and the AI Wizard's generated System Prompt were stripped by the character schemas and silently lost. The edit-page field is gone; the create form sends them as a named prompt ("Default") and a scenario ("Opening scene"); the wizard's prompt is saved through `POST /api/v1/characters/[id]/prompts`. The create form's dead Avatar URL field is removed.
- The sticky header used `qt-bg-card/95`, which is not a defined utility, so `npm run lint` failed and the header had no background. It now uses `qt-bg-card/90`.
- Tests: the autosave engine, the section map and redirects, legacy layout upgrade, section rendering on a blank character, the draft-to-PUT builder, and a grep-test that no file under `app/aurora/[id]/` submits a form or shows a Save button outside a modal.

#### Feature: character birthdays, public progressions, and a composed public identity

- Characters have an optional `birthday` (`YYYY-MM-DD`), stored in the vault's `properties.json`. The age is derived from it on the instance calendar and never stored (`lib/characters/birthday.ts`; a leap-day birthday turns over on 1 March in common years). Absent or invalid values read as no birthday, so existing vaults need no migration. PUT `/api/v1/characters/[id]` accepts it (null clears); the export schema documents it.
- Aurora edit page: a native date picker under Pronouns, with a Clear button and the age as of today. The character page header shows the age beside the pronouns.
- Progressions have a `public` flag, default `true`. It is in the progression JSON Schema, Pascal's writable fields (`progress.<id>.public`) and the flattened sheet (`<id>.public`). The editor has a Public checkbox and previews both the line the character reads and the line others see; the Progressions card marks private entries.
- New `lib/characters/public-identity.ts` composes the public identity: age, public progressions, pronouns, then the identity text. Public progressions use fixed third-person wording (`renderPublicProgressionLine`); the description and report template are never used, and a completed `onComplete: 'once'` progression is omitted. Used by the Host's join announcement, the off-scene card (referent ledger, left-behind notice, name-chip popup), Carina's asker card (`buildPublicIdentityCard`), the self_inventory roster and Brahma's `lookup_character` (which also returns `birthday`). The identity stack and other cached prompt blocks are unchanged.
- Fix: the progression editor overlay is portalled to `document.body`, so the LLM Logs panel no longer paints over it. Its preview caption now names the character instead of the progression.

#### Fix: OpenRouter plugin off `callModel()`; streaming tool and image turns send ZDR (#145)

- OpenRouter plugin 1.0.71 streams every turn (plain, tool, image) through the direct Chat Completions fetch. The `callModel()` / `@openrouter/sdk/lib/chat-compat` path, removed upstream in `@openrouter/sdk` 1.5.57, is gone, and the SDK range returns to `^1.5.60`. The SDK is still used for text-only non-streaming sends (`chat.send`), `models.list` and embeddings.
- Both fetch paths now build their request through one `buildChatCompletionsBody`. Before this, streaming tool and image turns did not send ZDR (`provider.data_collection: 'deny'`), any other provider preference, the `user` cache key, `response_format` or the model fallback list (only an undocumented `route: 'fallback'`), and sent web search as a Responses-API `web_search_preview` tool. All of these are now sent; web search is the `web` plugin and `route` is no longer sent.
- A plain streaming turn now has the first-byte request budget the other streaming paths use (it was unbounded by default), and reasoning streams on plain turns instead of arriving after the text. Reasoning reads `delta.reasoning`, falling back to the text of `delta.reasoning_details` entries (encrypted entries skipped). A streamed `delta.refusal` reports `finish_reason: 'refusal'`.
- `npm run build:plugins` now runs `tsc --explainFiles` after each plugin's typecheck and fails when a package the plugin declares in `dependencies` resolved from outside the plugin's own `node_modules` (`scripts/lib/plugin-resolution-guard.ts`). This is what let the removed subpath typecheck locally against the root copy of the SDK.
- The plugin's debug log now records the routing fields of each Chat Completions body (model / fallback list, tool count, provider preferences including ZDR, plugins, response format, reasoning) and, at stream end, which reasoning fields arrived, usage and OpenRouter's reported `cost`. Messages and keys are never logged. Live on V4test, OpenRouter sends both `delta.reasoning` and `delta.reasoning_details`; the plugin reads `reasoning` and does not double-count.
- Tests: streaming, body parity, ZDR, reasoning, refusal and tool-call cases in `openrouter-text-provider.test.ts`; `plugins/openrouter-no-callmodel.test.ts` fails on any mention of the removed API; `scripts/plugin-resolution-guard.test.ts`. The `@openrouter/sdk/lib/chat-compat` mock and its Jest mapping are removed.

#### Docs: spec for moving the OpenRouter plugin off `callModel()` (#145)

- New spec `docs/developer/features/openrouter-plugin-chat-completions-streaming.md`: route the plugin's plain streaming turn through the existing direct Chat Completions fetch, delete `callModel()` / `chat-compat`, and return `@openrouter/sdk` to a caret range. `@openrouter/agent` is rejected (second SDK major plus an MCP client peer dependency).
- Research recorded in the spec: the streaming fetch path, already used for every tool and image turn, does not send ZDR (`provider.data_collection`), provider preferences, the `user` cache key, `response_format` or the model fallback list, and sends web search as a Responses-API tool type. The spec puts both fetch paths on one request-body builder with a parity test, adds a `delta.reasoning_details` fallback, and proposes a build-time guard against a plugin import resolving from the root `node_modules` (what hid the break locally). No code changed.

#### Fix: CI and Release builds failed on the OpenRouter plugin

- `@openrouter/sdk` 1.5.57 (a patch release) removed `callModel()` and `@openrouter/sdk/lib/chat-compat`, which moved to the separate `@openrouter/agent` package. Plugins have no committed lockfile, so CI resolved the plugin's `^1.5.34` range to 1.5.60 and the plugin typecheck failed in `provider.ts`. Locally the typecheck passed because TypeScript fell back to the root `node_modules` copy (1.5.34) for the missing subpath.
- OpenRouter plugin 1.0.70 pins `@openrouter/sdk` to exactly 1.5.56, the last release with those APIs and the version the last green Release built against. Moving the streaming path off `callModel()` is follow-up work.

#### Feature: Green Room wardrobe model; single pieces from outfit sets

- New setting `chatSettings.cheapLLMSettings.outfitSelectionProfileId` (Settings → Providers → Cheap LLM Settings → Green Room Wardrobe Model). Any connection profile; it makes the `llm_choose` opening-outfit pick instead of the cheap LLM. Unset or a deleted profile falls back to the cheap LLM. Resolved by `selectGreenRoomLLM` (`lib/wardrobe/green-room-model.ts`), carried by `buildCheapLLMConfig`. Stored in the existing `cheapLLMSettings` JSON column, so no migration; restore remaps the id.
- The outfit prompt's composite marker now names the set's pieces by title (`[composite — bundles "Linen Blazer", "Linen Trousers", 1 other item]`; pieces not offered are counted), and the prompt says one piece of a set may be picked by its own ID.

#### Fix: Green Room could dress a character in two whole outfits

- The model could list an outfit set under one slot it happens to cover beside a full outfit. On Friday, Amy got "Summer Travel Look — Peacock & Olive Linen" (top, bottom, footwear) plus "Gothic Victorian Enchantress Attire" (top, bottom, accessories, hair) listed only under `hair`. Dissolving and spreading put every piece of both on.
- New `dropOverlappingEnsembles` (`lib/wardrobe/slot-ops.ts`) runs on the green room pick before dissolving. Two picks conflict when both span more than one slot, at least one is a composite, and they share a top or bottom slot. The one listed in more slots is kept (ties go to the first in slot order) and the other is dropped. Single-slot items and two plain multi-slot garments (slip under a dress) are left alone as layering.
- The outfit prompt now says to pick at most one outfit set for top and bottom and not to list a composite under one slot for a single piece of it.

#### Fix: Green Room opening outfits repeat chat after chat

- `llm_choose` picked each opening outfit with no knowledge of earlier ones, at the cheap-LLM default temperature of 0.3, from the same alphabetical item list. On Friday (52 calls since September) Friday, Laura and Abigail opened most clothed chats in one or two outfits across 7–10 different scenarios.
- The outfit prompt now lists the character's last five opening outfits (`loadRecentOpenings`, `lib/wardrobe/recent-openings.ts`, over the new `ChatWardrobeHistoryRepository.findRecentOpenings`: entry 0 of `chat-start` / `participant-added` timelines, never `seeded`, excluding the chat being dressed) and tells the model not to repeat them. Signature pieces (a ring, a pendant) may stay, and the rule does not change whether the character is clothed. Soft-fails to no history.
- The wardrobe list is shuffled on every call.
- `CheapLLMTaskOptions.temperature` lets a task set its own temperature (default `DEFAULT_CHEAP_LLM_TEMPERATURE`, 0.3, unchanged for all other tasks); outfit selection uses 0.8 (`OUTFIT_SELECTION_TEMPERATURE`). It also applies to the fallback stand-ins.

#### Fix: OpenAI prompt-cache hit rate on GPT-5.6 and later

- From gpt-5.6 on, OpenAI reuses a cached prefix only at a cache boundary, not at any matching token. With no explicit breakpoints a request wrote one entry after the leading developer block and one after the latest user message. In the Salon that message carries the turn's trailing sections, so the second entry was never read and the history between them was never cached. On Friday, gpt-6.1-sol read exactly 26,369 tokens (tools plus the three system blocks) on every turn and wrote 14–20k tokens per turn that were never read.
- OpenAI plugin 1.0.70 sends `prompt_cache_options: { mode: 'explicit' }` on gpt-5.6+ and marks every stable boundary (`cache-breakpoints.ts`): the end of the leading developer block and every later user/developer message and `function_call_output`, capped at the latest 48. The latest user message, which carries the turn's trailing sections, is marked only when a tool call follows it. OpenAI looks a prefix up only at boundaries marked in the current request and writes only the latest four, so marking every boundary is what lets each request find the previous one's entry. Developer messages and tool outputs are always sent as `input_text` lists so they render the same marked or not. `prompt_cache_retention`, deprecated for these models, is no longer sent to them; older models keep it.
- In V4test (gpt-6.1-sol) a plain turn read 24,022 of 25,700 input tokens and wrote 30; the remaining 1,648 were the uncached trailing message. In a tool loop each step read exactly what the previous step had cached (14,419, then 17,716).
- A model that rejects any cache control is retried once without all of them (`isPromptCacheControlRejection`, `stripPromptCacheControls`); this replaces the retention-only retry.
- Removed `previous_response_id` chaining. Requests go out with `store: false`, so the chained call always failed with "Previous response … not found" and fell back to the full request, costing a wasted round trip on every OpenAI turn after the first. `findPreviousResponseId` and the `previousResponseId` plumbing through the orchestrator, primary stream and streaming service are gone; the optional field stays in `@quilltap/plugin-types`.

#### Fix: image-arrival check rejected Gemini answers on long prompts

- `verifyImageReachedModel` (bug 116) judged a vision call imageless when its prompt tokens were at or below `text / 2.5`. That slack grows with the prompt: Import from image's ~2,400-character prompt allowed 951 tokens, more than Gemini bills for a whole image (258). On Friday, NanoGPT `gemini-2.5-flash` saw the photograph three times (844 tokens; all three answers described the same garments) and every answer was discarded as "accepted and discarded".
- `textOnlyTokenCeiling` now takes the lower of `text / 2.5` and `text / 4 + 85` (typical text cost plus the cheapest image tier). Short instructions keep the old bound, so bug 116's case is still caught. Affects the describe-fallback too.

#### Feature: choose the vision profile in Import from image

- The Import from image dialog's first screen now has a **Reading the photograph** dropdown listing every profile that can receive an image (model reads images and the plugin transports them, per `profileCanReceiveAttachment`). It is preset to the profile the analysis would have auto-picked; the review screen shows which profile did the reading.
- `GET /api/v1/wardrobe/analyze-image` returns the eligible profiles and the default pick; `POST` accepts an optional `profileId`. A chosen profile that is unknown or cannot receive images is refused (400) rather than replaced by another.
- `listVisionProfiles` and `resolveChosenVisionProfile` in `lib/llm/vision-request.ts`; `resolveVisionProfile` now uses the former.

#### Fix: Character Optimizer prompt caching and usage logging

- Every optimizer pass sent one user message: character context, source context (memories and/or instructions), then that pass's instruction. The passes share everything but the instruction, but with the instruction at the end no pass could reuse another's cache.
- The shared context and the instruction are now separate user messages, so the shared message is byte-identical across a run. With the Anthropic plugin's breakpoint on the message before the final one, the analysis pass writes it and every sub-step reads it. In V4test each sub-step read back the 2,488-token shared context.
- Optimizer log rows recorded no token usage at all. They now carry usage, cache usage and the provider's raw usage.

#### Feature: per-profile tool-result elision window

- Tool results in the history were elided to a one-line stub after 3 assistant messages for every provider. Each elision changes a message partway up the history, which forces Anthropic to re-write its prompt cache from that point; on Friday one Opus chat wrote about 200k cache tokens twice from this alone.
- New `connection_profiles.toolResultVerbatimTurns` (INTEGER DEFAULT 3, migration `add-profile-tool-result-verbatim-turns-v1`), read only through `resolveToolResultVerbatimTurns`. `0` never elides. Existing profiles keep 3.
- `buildConversationMessages` takes the window; the Salon context build passes the responding character's profile and the Brahma Console its own. The stub names the actual window (`>N turns old`).
- Profile editor field under Tool format, create/update route validation (0–1000), restore and `.qtap` import seeding, export schema, DDL and help.

#### Fix: Anthropic prompt-cache hit rate

- The Brahma Console, `@Brahma`, the Scenario Builder (via `runOneShotToolLoop`) and help chat passed `modelParams: {}` to `streamMessage`, so the profile's `enableCacheBreakpoints`, thinking and max-tokens settings never reached the provider. Every Anthropic call on those paths was sent uncached; on Friday that was about 6.5M input tokens over a week. They now pass `profileParams(connectionProfile)`, like the Salon.
- The Anthropic plugin (1.0.66) put the conversation breakpoint on the last user message. In the Salon that message carries the turn's trailing sections, which are gone from the next turn's copy, so each turn wrote a cache entry that was never read and only the system prompt was reused. The breakpoint now goes on the message before the final one. In V4test, consecutive turns now read back the whole previous prefix (17,393 then 18,076 tokens) and write only the new messages.
- In a tool loop the same rule caches each step for the next; previously only the opening user message was cached, because tool results don't count as user messages.
- The plugin now keeps within Anthropic's four-breakpoint limit: tools, system and a summary-head breakpoint come first, and the mid-history breakpoint is skipped when the budget is spent. The mid-history breakpoint is no longer added under the `system_only` strategy.

#### Fix: OpenAI model fetch lists GPT-6 and later

- Fetch Models for OpenAI kept only IDs starting `gpt-4`, `gpt-5`, `o1`, `o3`, `o4`, so the gpt-6.x models never appeared. The reasoning-model and 24h cache-retention checks had the same hard-coded lists, so a hand-entered gpt-6 model would also have been sent `temperature` / `top_p`.
- The OpenAI plugin (1.0.69) now decides by family and version in `model-families.ts`: chat models are gpt-4 and later plus every o-series (gpt-3.5 drops out); reasoning models are gpt-5 and later plus every o-series; 24h retention is gpt-5.1 / 5.2 / 5.5 and every gpt-6+ model except `-chat-latest` aliases.
- Retention for unreleased models is a guess, so a 400 naming `prompt_cache_retention` is retried once without it instead of failing the turn.

#### Feature: Refine from Memories & Instructions

- The Character Optimizer ("Refine from Memories") is now "Refine from Memories & Instructions". The preflight form has an optional instructions textarea (up to 8,000 characters) and a "Consult the Commonplace Book" checkbox. A run can use memories, instructions, or both; it needs at least one.
- Instructions ride in the shared context of every pass (general fields, each scenario, each system prompt, physical description, wardrobe, aliases, new system prompts), so a requested change is applied wherever it applies. They win over conflicting memories, get significance ≥ 0.6, and never override the field vantage-point, form-of-address, trust-safeguard, or committee-drift rules.
- The analysis lists each change the instructions call for ("Author's instruction"). With no memories it is an instructions-only reading of the configuration.
- A run with instructions and too few reinforced memories continues on the instructions alone instead of stopping.
- `?action=optimize-stream` accepts `useMemories` (default true) and `instructions`. The vault suggestions file records the instructions and an `authorInstructions` frontmatter flag.

#### CI: restore the 8 GB heap for the coverage run

- `test:coverage` again passes `--max-old-space-size=8192` to the Jest parent. 4.12.1 added the flag, but the merge back into main dropped it, and every CI test run since hit the default 4 GB heap and aborted (exit 134).

#### Fix: story characters no longer invent where the user is

- In the live evaluation, characters decided the operator's persona had gone to the boathouse and planned around it for several turns.
- Every story sample prompt (plugin 1.1.33) now forbids filling a gap by deciding where the user is or what they did off-screen; characters may wonder aloud, call out, or go and look. MODERN Roleplay states it under "Whose story it is" and names "the invented absence" as a failure mode. MODERN Assistant is unchanged.
- The stakes direction used by the AI Wizard, Summon From Lore, Character Optimizer and External Prompt generator carries the same rule.
- Rerun with fresh characters: no invented errands; characters still sometimes assumed the user was present in the scene. Details in §12 of `docs/developer/features/character-kind-and-roleplay-defaults.md`.

#### Docs: live evaluation of the roleplay defaults

- Rebuilt the 2026-11-03 armed-intruder scene in V4test with synthetic characters and ran it with old-style and new prompts on DeepSeek V4 Flash and GLM 5.3 Flash. Results and method are in §12 (phase 6) of `docs/developer/features/character-kind-and-roleplay-defaults.md`, now marked implemented.
- The doorkeeper with an old-style "never tense / hostility makes you calmer" prompt reproduced the incident (offered the gunman a tour of the house); the same character with a new Wizard prompt blocked him and showed fear. A quiet scene stayed quiet.
- Follow-ups noted: characters invented the operator persona's off-screen whereabouts, and new-prompt replies ran about 65% longer.

#### Feature: group scenes need not agree; informs carry feelings

- The group-scene rules every speaker in a multi-character chat receives now say the cast does not have to agree: if the others took the measured view, a character may respond with fear, anger, or action, and should never take a position only because everyone else has.
- The inform header now reads "Things now true in this story and in you, as of this moment — what has happened, what you know, and how you feel or what you have resolved. Where any of it conflicts with an older memory, your records, or your usual temperament, this is the current truth:". Informs like "You are very alarmed" were previously filed as facts and outweighed by the character's usual calm.
- Amendment note added to `docs/developer/features/complete/salon-inform.md`. Phase 5 of `docs/developer/features/character-kind-and-roleplay-defaults.md`.

#### Feature: prompt generators follow the character's kind

- The AI Wizard, Summon From Lore, Character Optimizer and External Prompt generator now add a kind-specific direction when they write a system prompt. Roleplay characters get a stakes direction: react to danger, loss or outrage at full size, and never write temperament as an absolute ("never tense", "always calm"). Assistants get a task direction: accuracy, no invented facts, opinions once, no padding.
- Generators read the character's stored kind. A new or summoned character is roleplay. They never guess the kind from source material, since household staff read as assistants to a model.
- The Character Optimizer now treats "flattening" in a roleplay character's memories (meeting danger with small-talk calm) as drift to correct, and proposes replacing absolute temperament rules in the prompt. Assistants are not checked for it.
- Fix: the AI Wizard's system-prompt field now has a 2,500-token completion budget (was 1,000, shared with example dialogues and first message). Reasoning models spent part of the old budget thinking and returned prompts cut off mid-sentence.
- The External Prompt generator's `META_SYSTEM_PROMPT` constant is now `buildMetaSystemPrompt(kind)`; the Wizard's system-prompt meta-prompt is `buildSystemPromptFieldPrompt(kind)`.
- Phase 4 of `docs/developer/features/character-kind-and-roleplay-defaults.md`.

#### Feature: roleplay and assistant sample prompts; every story prompt matches the stakes

- New sample prompts in the default-system-prompts plugin (1.1.32): **MODERN Roleplay**, the recommended default for roleplay characters (a person inside a story with stakes; adds sections on reacting to danger and on group scenes, and the "flattening" and "mediator" failure modes), and **MODERN Assistant**, for characters whose job is doing work for the user.
- **MODERN General** is retired. Seeding now deletes built-in prompt rows the plugin no longer ships, but only after a registry seed that returned at least one prompt; user copies are never touched.
- Every companion, romantic and platonic sample gains a short "match the stakes" passage: ordinary days stay ordinary, real danger gets real fear, anger or action, and a character's usual temperament is not a vow.
- DeepSeek's style governors are now "match the stakes". They still limit purple prose and metaphor but no longer tell the character to keep the story small.
- Phase 3 of `docs/developer/features/character-kind-and-roleplay-defaults.md`.

#### Feature: Agent Mode and tool rules follow the character's kind

- Agent Mode now has two flavors, chosen by the responding character's kind; the settings cascade still decides only whether it is on.
  - Roleplay characters get "in-character" Agent Mode: tools are things they do in the scene, the turn is still written in character as prose, and they are never offered `submit_final_response`. At the step limit they are told to stop using tools and write the turn.
  - Assistant characters get the existing research loop, unchanged.
- The native tool-rules preamble follows the kind too. Roleplay characters get "## Using tools", which no longer claims to override the character; assistants keep "Tool Execution Rules (MANDATORY — overrides all other behavioral patterns)". The six rules are identical in both.
- The Brahma Console, Help chat and one-shot loops always use the research flavor and the assistant preamble.
- Text-block and simple-JSON tool instructions are unchanged.
- Phase 2 of `docs/developer/features/character-kind-and-roleplay-defaults.md`.

#### Feature: character kind (roleplay or assistant)

- Every character now has a kind: `roleplay` (default) or `assistant`. Stored as `kind` in the character vault's `properties.json`; an absent or unrecognized value reads as `roleplay`, so existing characters need no migration.
- Set on a new "Kind of character" card on the Details tab of the character view and edit pages, saved on change. Accepted by `PUT /api/v1/characters/[id]` and returned by `GET /api/v1/characters`. Documented in `qtap-export.schema.json`; export and import carry it with the character.
- Read only through `lib/characters/kind.ts`; a grep-test fails on hand comparisons against a kind literal elsewhere.
- Phase 1 of `docs/developer/features/character-kind-and-roleplay-defaults.md`; the spec now stores kind in the vault instead of the DB column it first proposed.

#### Docs: design spec for character kind and roleplay defaults

- New `docs/developer/features/character-kind-and-roleplay-defaults.md`. Proposed, not implemented.
- Diagnosis: in two Friday chats (2026-11-03) every LLM character met an armed intruder with calm negotiation. Request logs trace it to companion-framed stock prompts, anti-escalation governors in the DeepSeek and MODERN General prompts, absolute temperament rules in generated prompts, assistant-style Agent Mode and tool-rule text, a fact-only inform header, and group scenes converging on one stance.
- Plan: a per-character `kind` (`roleplay` default, or `assistant`) read through one resolver; two Agent Mode flavours (research, in-character); a kind-aware tool-rules preamble; new MODERN Roleplay and MODERN Assistant sample prompts; a stakes direction for every prompt generator; a group-scene bullet against converging on one stance.
- Decisions recorded: the inform header is reworded to cover feeling and resolve (D2), and MODERN General is retired with a guarded prune of built-in prompt rows that are no longer shipped (D1).

### 4.12.2

#### Security: Docker production image moves from Debian bookworm to Wolfi

- The production stage of `Dockerfile` and `Dockerfile.ci` now starts from `cgr.dev/chainguard/wolfi-base:latest` and installs `nodejs-24`, `libstdc++`, `bash`, `zip` and `unzip` with `apk`. Every finding left in the `node:24-bookworm-slim` image (1 critical, about 10 high: util-linux, zlib, ncurses, systemd libraries, gzip, acl) was a Debian package marked affected, fix-deferred or will-not-fix, so `apt-get upgrade` could not clear them; `node:24-trixie-slim` scanned worse (13 high). Trivy on a local arm64 build: 97 findings (1 critical, 9 high) on the published 4.13.0-dev.29 image, 1 on the Wolfi build (a low in the app's own `katex` dependency, not the OS).
- Only the production stage changed. The build stages stay on `node:24-bookworm-slim`, because Wolfi only packages npm 12 and the lockfile is installed with npm 11 as in CI. node_modules built there (glibc 2.36) load on Wolfi's glibc 2.44; the SQLite driver, sharp and node-pty are all Node-API.
- The base tag is deliberately unpinned. Wolfi rebuilds it daily, and a moving tag is what invalidates the GitHub Actions layer cache so `apk upgrade` actually pulls new fixes.
- The npm/corepack/yarn removal and the forced `perl` purge are gone: npm is a separate Wolfi package that is never installed, and nothing pulls perl in.
- The `nextjs` user and `nodejs` group keep UID/GID 1001 (now created with busybox `addgroup`/`adduser`), so existing volumes stay writable.
- Images that layer extra tools on top must use `apk add` instead of `apt-get`. `docs/DEPLOYMENT.md` and `help/ariel.md` say so.

#### Fix: image-arrival check rejected Gemini answers on long prompts

- `verifyImageReachedModel` (bug 116) judged a vision call imageless when its prompt tokens were at or below `text / 2.5`. That slack grows with the prompt: Import from image's ~2,400-character prompt allowed 951 tokens, more than Gemini bills for a whole image (258). On Friday, NanoGPT `gemini-2.5-flash` saw the photograph three times (844 tokens; all three answers described the same garments) and every answer was discarded as "accepted and discarded".
- `textOnlyTokenCeiling` now takes the lower of `text / 2.5` and `text / 4 + 85` (typical text cost plus the cheapest image tier). Short instructions keep the old bound, so bug 116's case is still caught. Affects the describe-fallback too.

#### Fix: Green Room could dress a character in two whole outfits

- The model could list an outfit set under one slot it happens to cover beside a full outfit. On Friday, Amy got "Summer Travel Look — Peacock & Olive Linen" (top, bottom, footwear) plus "Gothic Victorian Enchantress Attire" (top, bottom, accessories, hair) listed only under `hair`. Dissolving and spreading put every piece of both on.
- New `dropOverlappingEnsembles` (`lib/wardrobe/slot-ops.ts`) runs on the green room pick before dissolving. Two picks conflict when both span more than one slot, at least one is a composite, and they share a top or bottom slot. The one listed in more slots is kept (ties go to the first in slot order) and the other is dropped. Single-slot items and two plain multi-slot garments (slip under a dress) are left alone as layering.
- The outfit prompt now says to pick at most one outfit set for top and bottom and not to list a composite under one slot for a single piece of it.

#### Fix: Green Room opening outfits repeat chat after chat

- `llm_choose` picked each opening outfit with no knowledge of earlier ones, at the cheap-LLM default temperature of 0.3, from the same alphabetical item list. On Friday (52 calls since September) Friday, Laura and Abigail opened most clothed chats in one or two outfits across 7–10 different scenarios.
- The outfit prompt now lists the character's last five opening outfits (`loadRecentOpenings`, `lib/wardrobe/recent-openings.ts`, over the new `ChatWardrobeHistoryRepository.findRecentOpenings`: entry 0 of `chat-start` / `participant-added` timelines, never `seeded`, excluding the chat being dressed) and tells the model not to repeat them. Signature pieces (a ring, a pendant) may stay, and the rule does not change whether the character is clothed. Soft-fails to no history.
- The wardrobe list is shuffled on every call.
- `CheapLLMTaskOptions.temperature` lets a task set its own temperature (default `DEFAULT_CHEAP_LLM_TEMPERATURE`, 0.3, unchanged for all other tasks); outfit selection uses 0.8 (`OUTFIT_SELECTION_TEMPERATURE`). It also applies to the fallback stand-ins.

#### Fix: OpenAI prompt-cache hit rate on GPT-5.6 and later

- From gpt-5.6 on, OpenAI reuses a cached prefix only at a cache boundary, not at any matching token. With no explicit breakpoints a request wrote one entry after the leading developer block and one after the latest user message. In the Salon that message carries the turn's trailing sections, so the second entry was never read and the history between them was never cached. On Friday, gpt-6.1-sol read exactly 26,369 tokens (tools plus the three system blocks) on every turn and wrote 14–20k tokens per turn that were never read.
- OpenAI plugin 1.0.70 sends `prompt_cache_options: { mode: 'explicit' }` on gpt-5.6+ and marks every stable boundary (`cache-breakpoints.ts`): the end of the leading developer block and every later user/developer message and `function_call_output`, capped at the latest 48. The latest user message, which carries the turn's trailing sections, is marked only when a tool call follows it. OpenAI looks a prefix up only at boundaries marked in the current request and writes only the latest four, so marking every boundary is what lets each request find the previous one's entry. Developer messages and tool outputs are always sent as `input_text` lists so they render the same marked or not. `prompt_cache_retention`, deprecated for these models, is no longer sent to them; older models keep it.
- In V4test (gpt-6.1-sol) a plain turn read 24,022 of 25,700 input tokens and wrote 30; the remaining 1,648 were the uncached trailing message. In a tool loop each step read exactly what the previous step had cached (14,419, then 17,716).
- A model that rejects any cache control is retried once without all of them (`isPromptCacheControlRejection`, `stripPromptCacheControls`); this replaces the retention-only retry.
- Removed `previous_response_id` chaining. Requests go out with `store: false`, so the chained call always failed with "Previous response … not found" and fell back to the full request, costing a wasted round trip on every OpenAI turn after the first. `findPreviousResponseId` and the `previousResponseId` plumbing through the orchestrator, primary stream and streaming service are gone; the optional field stays in `@quilltap/plugin-types`.

#### Fix: Character Optimizer prompt caching and usage logging

- Every optimizer pass sent one user message: character context, memory context, then that pass's instruction. The passes share everything but the instruction, but with the instruction at the end no pass could reuse another's cache.
- The shared context and the instruction are now separate user messages, so the shared message is byte-identical across a run. With the Anthropic plugin's breakpoint on the message before the final one, the analysis pass writes it and every sub-step reads it. In V4test each sub-step read back the 2,488-token shared context.
- Optimizer log rows recorded no token usage at all. They now carry usage, cache usage and the provider's raw usage.

#### Fix: Anthropic prompt-cache hit rate

- The Brahma Console, `@Brahma`, the Scenario Builder (via `runOneShotToolLoop`) and help chat passed `modelParams: {}` to `streamMessage`, so the profile's `enableCacheBreakpoints`, thinking and max-tokens settings never reached the provider. Every Anthropic call on those paths was sent uncached; on Friday that was about 6.5M input tokens over a week. They now pass `profileParams(connectionProfile)`, like the Salon.
- The Anthropic plugin (1.0.66) put the conversation breakpoint on the last user message. In the Salon that message carries the turn's trailing sections, which are gone from the next turn's copy, so each turn wrote a cache entry that was never read and only the system prompt was reused. The breakpoint now goes on the message before the final one. In V4test, consecutive turns now read back the whole previous prefix (17,393 then 18,076 tokens) and write only the new messages.
- In a tool loop the same rule caches each step for the next; previously only the opening user message was cached, because tool results don't count as user messages.
- The plugin now keeps within Anthropic's four-breakpoint limit: tools, system and a summary-head breakpoint come first, and the mid-history breakpoint is skipped when the budget is spent. The mid-history breakpoint is no longer added under the `system_only` strategy.

#### Fix: OpenRouter plugin off `callModel()`; streaming tool and image turns send ZDR (#145)

- OpenRouter plugin 1.0.71 streams every turn (plain, tool, image) through the direct Chat Completions fetch. The `callModel()` / `@openrouter/sdk/lib/chat-compat` path, removed upstream in `@openrouter/sdk` 1.5.57, is gone, and the SDK range returns to `^1.5.60`. The SDK is still used for text-only non-streaming sends (`chat.send`), `models.list` and embeddings.
- Both fetch paths now build their request through one `buildChatCompletionsBody`. Before this, streaming tool and image turns did not send ZDR (`provider.data_collection: 'deny'`), any other provider preference, the `user` cache key, `response_format` or the model fallback list (only an undocumented `route: 'fallback'`), and sent web search as a Responses-API `web_search_preview` tool. All of these are now sent; web search is the `web` plugin and `route` is no longer sent.
- A plain streaming turn now has the first-byte request budget the other streaming paths use (it was unbounded by default), and reasoning streams on plain turns instead of arriving after the text. Reasoning reads `delta.reasoning`, falling back to the text of `delta.reasoning_details` entries (encrypted entries skipped). A streamed `delta.refusal` reports `finish_reason: 'refusal'`.
- `npm run build:plugins` now runs `tsc --explainFiles` after each plugin's typecheck and fails when a package the plugin declares in `dependencies` resolved from outside the plugin's own `node_modules` (`scripts/lib/plugin-resolution-guard.ts`). This is what let the removed subpath typecheck locally against the root copy of the SDK.
- The plugin's debug log now records the routing fields of each Chat Completions body (model / fallback list, tool count, provider preferences including ZDR, plugins, response format, reasoning) and, at stream end, which reasoning fields arrived, usage and OpenRouter's reported `cost`. Messages and keys are never logged. Live on V4test, OpenRouter sends both `delta.reasoning` and `delta.reasoning_details`; the plugin reads `reasoning` and does not double-count.
- Tests: streaming, body parity, ZDR, reasoning, refusal and tool-call cases in `openrouter-text-provider.test.ts`; `plugins/openrouter-no-callmodel.test.ts` fails on any mention of the removed API; `scripts/plugin-resolution-guard.test.ts`. The `@openrouter/sdk/lib/chat-compat` mock and its Jest mapping are removed.

#### Fix: CI and Release builds failed on the OpenRouter plugin

- `@openrouter/sdk` 1.5.57 (a patch release) removed `callModel()` and `@openrouter/sdk/lib/chat-compat`, which moved to the separate `@openrouter/agent` package. Plugins have no committed lockfile, so CI resolved the plugin's `^1.5.34` range to 1.5.60 and the plugin typecheck failed in `provider.ts`. Locally the typecheck passed because TypeScript fell back to the root `node_modules` copy (1.5.34) for the missing subpath.
- OpenRouter plugin 1.0.70 pins `@openrouter/sdk` to exactly 1.5.56, the last release with those APIs and the version the last green Release built against. Moving the streaming path off `callModel()` is follow-up work.

#### Fix: OpenAI model fetch lists GPT-6 and later

- Fetch Models for OpenAI kept only IDs starting `gpt-4`, `gpt-5`, `o1`, `o3`, `o4`, so the gpt-6.x models never appeared. The reasoning-model and 24h cache-retention checks had the same hard-coded lists, so a hand-entered gpt-6 model would also have been sent `temperature` / `top_p`.
- The OpenAI plugin (1.0.69) now decides by family and version in `model-families.ts`: chat models are gpt-4 and later plus every o-series (gpt-3.5 drops out); reasoning models are gpt-5 and later plus every o-series; 24h retention is gpt-5.1 / 5.2 / 5.5 and every gpt-6+ model except `-chat-latest` aliases.
- Retention for unreleased models is a guess, so a 400 naming `prompt_cache_retention` is retried once without it instead of failing the turn.

### 4.12.1

#### Fixed: dated searches look at the period first, and an empty search says what it means

- A `search` with `since`/`until` (and a retrospective turn's recall) now reads the period's memories by event time in SQL (`MemoriesRepository.findIdsInEventWindow`) and scores them through the same index restricted to those ids (`memoryIndex.search` `includeIds`), so they join the candidate pool before the cut. Previously the window was applied to a pool already chosen from all time, so a dated question about a recurring place returned nothing. New `HitSource` `'window'`; the `gather` trace stage records `window` / `windowAdded`.
- On the tool path, a window of 14 days or less (`TOOL_WINDOW_FLOOR_MAX_DAYS`) is its own relevance filter: in-window memories and conversation chunks skip the cosine floor. Wider windows and the per-turn prompt path keep the floor.
- Conversation search takes `chatIds`; with a window, the tool restricts the chunk search to the period's chats (`findChatsInWindow`, `lib/scriptorium/chat-window.ts`) instead of filtering the all-time top-K afterwards. A chat's span is `createdAt` to `lastMessageAt`, not `updatedAt`. `searchConversationChunks` now honours an explicit `minScore: 0`.
- When `since`/`until` is given and `sources` is omitted, only memories and conversations are searched (conversations alone on the Brahma Console).
- The tool result carries a `windowCensus` (memories dated in the window, the conversations the character took part in during it, the current chat left out). An empty result now says whether nothing matched the words or nothing happened in the period, and names the period's conversations; non-empty dated results gain a footer listing them.
- Standing tool instructions (native and simple-JSON) now tell the character to read a listed conversation before saying it does not recall.
- The retrospective mini-recap lists in-window chats that have no vault summary yet, from the `chats` table. `VaultConversationMatch.relativePath` is now nullable.
- Undated searches and turns without a resolved time window are unchanged. No schema or export change.
- Spec: `docs/developer/features/complete/search-window-first-and-honest-empty.md`.

#### CI: coverage run heap

- CI: the coverage run (`npm run test:coverage`) now gives the Jest parent process an 8 GB heap. With the v8 coverage provider, every worker ships the coverage, original source and transformed source of each module it loaded back to the parent, which holds all of it until the run ends; at ~1,300 test files that passed the default ~4 GB limit and the Test job died with "JavaScript heap out of memory" after the last suite.
