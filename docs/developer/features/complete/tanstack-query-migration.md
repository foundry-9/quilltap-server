# Plan: Migrate the React Client from SWR to TanStack Query

**Status:** Proposed

## Overview

The Quilltap client does its server-state fetching three different ways today:

1. **SWR** — `useSWR` in ~49 files (~124 call sites), wired through a single
   `<SWRConfig>` at the app root (`components/providers/session-provider.tsx`)
   with a shared `swrFetcher` (`lib/swr-fetcher.ts`).
2. **Raw `fetch()` mutations** — ~382 `POST`/`PUT`/`PATCH`/`DELETE` calls
   scattered through components, only ~14 of which loop back through SWR's
   `mutate()` to invalidate the read that they just made stale.
3. **Bespoke module-level caches** — three hooks
   (`hooks/useProviders.ts`, `hooks/useConnectionProfiles.ts`,
   `hooks/usePersonaDisplayName.ts`) that hand-roll a module-scoped variable plus
   a `fetchPromise` for request de-duplication, with no real invalidation story.

This plan migrates **all three** to `@tanstack/react-query` (TanStack Query v5),
unifying server-state under one cache with first-class mutations, invalidation,
and devtools. It is explicitly scoped to leave the **SSE streaming transport**
(`app/salon/[id]/hooks/useSSEStreaming.ts` and friends) untouched — TanStack
Query is not a streaming transport, and the Salon's live message path is the
hottest code in the app. The query reads *around* streaming (chat lists, message
history loads, settings) migrate; the stream itself does not.

### Why bother — SWR already works

This is a deliberate consolidation, not a rescue. The wins:

- **Mutations become first-class.** Today the ~382 raw mutations are invalidation
  on the honour system — only 14 invalidate anything. TanStack's `useMutation`
  with `onSettled`/`invalidateQueries` makes "write, then refetch what you broke"
  the default path, killing a whole class of stale-UI bugs.
- **One cache, three patterns collapse to one.** The module-level caches and the
  SWR caches stop being separate worlds. `useProviders` and an `useQuery` for
  characters become the same kind of thing, cancellable and invalidatable the
  same way.
- **Query-key factories** give us a single source of truth for cache identity,
  which is what makes targeted invalidation (`invalidate everything under
  ['characters']`) reliable instead of string-matching URLs.
- **Devtools + Suspense + `select` + structural sharing** are all things we get
  for free that SWR either lacks or does less ergonomically.

### Non-goals

- **No SSE rewrite.** The Fetch-Streams message path stays as-is. (See Phase 6.)
- **No API/route changes.** This is a client-cache migration only; `/api/v1/*`
  is untouched.
- **No behavioural change** to polling, refetch-on-focus, or optimistic updates
  unless a site is already buggy. We preserve current semantics first, then
  improve in a follow-up.

---

## Inventory (baseline to migrate against)

| Surface | Count | Source of truth |
|---|---|---|
| Files calling `useSWR` | ~49 | `grep -rl "from 'swr'" --include='*.tsx' --include='*.ts'` (minus tests) |
| `useSWR` call sites | ~124 | `grep -rn "useSWR\b"` over `app/ components/ hooks/ lib/` |
| Custom SWR wrapper hooks | 16 | see list below |
| Module-level cache hooks (non-SWR) | 3 | `useProviders`, `useConnectionProfiles`, `usePersonaDisplayName` |
| Raw `POST/PUT/PATCH/DELETE` fetches | ~382 | `grep` over `app/ components/` |
| Mutations that currently invalidate | ~14 | sites that call `mutate()` |
| Sites with `refreshInterval` (polling) | 4 | tasks-queue, autonomous-rooms-card, autonomous-room-badges, useStoryBackground |
| Conditional/null keys | ~35 | `useSWR(cond ? url : null)` |
| SSE / streaming files (NOT migrating) | 4 | all under `app/salon/[id]/` |

> Re-run the inventory at the start of work — these counts drift. The commands
> are recorded above so the baseline is reproducible.

### The 16 custom wrapper hooks (the high-value targets)

These already encapsulate read + mutate behind a domain API, so each is a clean,
self-contained migration unit:

- `components/settings/chat-settings/hooks/useChatSettings.ts` (4 reads + ~30 mutation handlers — the big one)
- `components/settings/roleplay-templates/hooks/useRoleplayTemplates.ts`
- `components/characters/system-prompts-editor/hooks/useSystemPrompts.ts`
- `components/tools/tasks-queue/hooks/useTasksQueue.ts` (polling)
- `components/images/embedded-gallery/hooks/useGalleryData.ts`
- `app/salon/[id]/hooks/useChatControls.ts`
- `app/salon/[id]/hooks/useLLMLogs.ts`
- `hooks/useStoryBackground.ts` (polling)
- `lib/spellcheck/useDictionaryFeed.ts`
- `lib/text-replacement/useTextReplacementRules.ts`
- plus the inline read+mutate pairs in `image-gallery.tsx`, `api-keys-tab.tsx`,
  `tags-tab.tsx`, `ThemeBrowser.tsx`, `StateEditorModal.tsx`, `help-chat-provider.tsx`.

---

## Architecture & conventions (build these first, once)

Everything downstream depends on getting these foundations right. Resist the urge
to migrate any feature before the scaffolding below exists and is reviewed.

### 1. The `QueryClient` and provider

Create `lib/query/query-client.ts` exporting a factory (not a module singleton —
a per-request factory keeps SSR/test isolation clean and matches TanStack's Next
guidance):

```ts
export function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,          // matches the app's "fresh enough" feel
        refetchOnWindowFocus: false, // preserve current SWRConfig behaviour
        retry: 1,
      },
    },
  });
}
```

A client component `lib/query/QueryProvider.tsx` holds the client in `useState`
(so it survives re-renders but not remounts) and renders
`<QueryClientProvider>` plus, in dev, `<ReactQueryDevtools />`.

Wire it in `components/providers/session-provider.tsx` **wrapping** the existing
tree. During the migration both providers coexist: `<SWRConfig>` stays until the
last `useSWR` is gone, with `<QueryClientProvider>` outside it. This is the key
that lets us migrate incrementally instead of in one terrifying commit.

### 2. The shared fetcher

Keep `lib/swr-fetcher.ts`'s `SwrFetchError` semantics (throw on non-2xx, carry
`status` + parsed `info`) — components already branch on `error.status`. Add
`lib/query/fetcher.ts` exporting `apiFetch<T>(url, init?)` that reuses the same
error class (rename the class to `ApiFetchError` with a back-compat alias, or
just re-export). Queries pass `queryFn: () => apiFetch<T>(url)`; the existing
`AbortSignal` plumbing from TanStack is forwarded so in-flight reads cancel
properly — something the module-level caches never did.

### 3. Query-key factories — the single source of truth

This is the most important convention and the thing CLAUDE.md's
"single source of truth" rule cares about most. **No raw string keys in
components.** Create `lib/query/keys.ts` with a factory per entity:

```ts
export const queryKeys = {
  characters: {
    all: ['characters'] as const,
    list: (filters?: CharacterFilters) => ['characters', 'list', filters ?? {}] as const,
    detail: (id: string) => ['characters', 'detail', id] as const,
    prompts: (id: string) => ['characters', id, 'prompts'] as const,
    photos: (id: string) => ['characters', id, 'photos'] as const,
  },
  chats: { all: ['chats'] as const, list: (f?) => [...], detail: (id) => [...], state: (id) => [...] },
  settings: { chat: ['settings', 'chat'] as const },
  connectionProfiles: { all: ['connection-profiles'] as const },
  // ...one block per entity touched by the inventory
};
```

Invalidation then targets a prefix (`invalidateQueries({ queryKey: queryKeys.characters.all })`)
and hits every list/detail under it. Document the rule in CLAUDE.md once the
pattern lands (see the Documentation phase).

### 4. Domain hook conventions

Mirror the existing wrapper-hook style so the diff to call sites is minimal:

- **Reads:** `useXxx()` returns `{ data, isLoading, error, refetch }`. Where the
  current hook returns a differently named field (`settings`, `templates`,
  `providers`), keep that name by destructuring/aliasing inside the hook so
  *consumers don't change*.
- **Mutations:** expose the same imperative handler names the components already
  call (`handleSave`, `deleteJob`, `handleUpload`, …), implemented with
  `useMutation` whose `onSuccess`/`onSettled` invalidates the relevant key. The
  component-facing API is unchanged; only the hook's internals swap.
- **Optimistic updates:** for the ~14 sites that already do
  `mutate(updated, false)` (optimistic, no revalidate — e.g. `useChatSettings`,
  `CoreWhisperSection`), reproduce with `onMutate` + `setQueryData` +
  rollback in `onError`. Preserve, don't "improve," in this pass.

### 5. Polling

The four `refreshInterval` sites map directly to `refetchInterval`. The two
conditional-polling hooks (`useStoryBackground` start/stop, `useTasksQueue`
autoRefresh toggle) map to `refetchInterval: enabled ? ms : false`. The
badge/card pollers (`autonomous-room-badges`, `autonomous-rooms-card`) are plain
fixed-interval refetches.

### 6. Conditional keys

The ~35 `useSWR(cond ? url : null)` sites become `useQuery({ ..., enabled: cond })`.
This is a mechanical, low-risk transform and a good warm-up batch.

---

## Phased migration

Each phase ends green: `npx tsc` clean, `jest` passing, app boots under
`npm run dev`. Phases 2–7 can be parallelised across agents (see "Execution"),
but Phase 1 is a hard prerequisite for all of them.

### Phase 1 — Scaffolding (no behaviour change)

1. `npm install @tanstack/react-query @tanstack/react-query-devtools`
   (and `@tanstack/eslint-plugin-query` for lint guardrails).
2. Add `lib/query/query-client.ts`, `lib/query/QueryProvider.tsx`,
   `lib/query/fetcher.ts`, `lib/query/keys.ts` (start with the entities Phase 2
   needs; grow the factory per phase).
3. Wrap the provider tree in `session-provider.tsx`, **outside** the surviving
   `<SWRConfig>`.
4. Add the test harness helper (see Testing) — `renderWithQuery()` that mounts a
   fresh `QueryClient` with retries off, mirroring the existing
   `provider: () => new Map()` SWR pattern.
5. Land `@tanstack/eslint-plugin-query` rules (`exhaustive-deps`,
   `no-rest-destructuring`) so new code is correct by construction.

**Exit:** both libraries coexist; nothing migrated yet; CI green.

### Phase 2 — Conditional-key reads & simple one-shot reads (warm-up)

Lowest risk, builds muscle memory and the key factory. Migrate the pure-read,
no-mutation sites:

- `search-dialog.tsx`, `HelpEntityPicker.tsx`, `LibraryFilePickerModal.tsx`
  (6 conditional reads), `FolderPicker.tsx`, `useFilePreview.ts`,
  `PluginConfigModal.tsx`, `useDictionaryFeed.ts`, `useEntitySearch.ts`,
  `GenerateImageDialog.tsx`, the Lexical `composerSpellcheck` reads
  (`LexicalComposerWrapper.tsx`, `TextReplacementPlugin.tsx`, `DocumentPane.tsx`),
  `tag-style-provider.tsx`, `MoveToProjectModal.tsx`, `ChatProjectModal.tsx`,
  `CreateNPCDialog.tsx`.

**Exit:** all conditional/simple reads off SWR; their components' tests updated.

### Phase 3 — Module-level cache hooks

Replace the three hand-rolled caches. Each becomes a thin `useQuery` with a long
`staleTime` (these are reference data — providers, connection profiles, the
character duplicate-name set) so they keep their "fetch once, share everywhere"
character without the manual `fetchPromise` dedup (TanStack dedups by key
automatically).

- `hooks/useProviders.ts` → `useQuery(queryKeys.providers.all)`, keep
  `getProviderIcon`/`getProviderDisplayName` as derived helpers over `data`.
- `hooks/useConnectionProfiles.ts` → ditto, keep `getProfileProvider`.
- `hooks/usePersonaDisplayName.ts` → `useQuery` for the
  `?controlledBy=user` list; derive the duplicate-name `Set` via `select`.
  **Replace `resetDisplayNameCache()`** (a test-only escape hatch) with
  `queryClient.clear()` in the test harness — note this in the test file's diff.

These three are also the ones with no invalidation today; wiring their keys into
the relevant mutations (e.g. creating a connection profile now invalidates
`connectionProfiles.all`) is a real bug-fix win, but do it as a *follow-up* note,
not silently in this pass.

**Exit:** zero module-level fetch caches remain; `useProviders` & co. read from
the shared client.

### Phase 4 — Self-contained wrapper hooks (read + mutate units)

The meat. Migrate the 16 wrapper hooks one per change, smallest first so the
pattern is proven before the big ones:

1. `useLLMLogs`, `useChatControls`, `useTextReplacementRules`,
   `useStoryBackground` (polling), `useTasksQueue` (polling + 5 mutations).
2. `useGalleryData`, `useSystemPrompts`, `useRoleplayTemplates`.
3. `useChatSettings` **last** — 4 reads + ~30 optimistic mutation handlers. This
   one deserves its own change, its own reviewer, and careful preservation of the
   `mutate(updated, false)` optimistic semantics via `onMutate`/rollback.

Also fold in the inline read+mutate pairs that aren't extracted into hooks:
`image-gallery.tsx`, `api-keys-tab.tsx`, `tags-tab.tsx`, `ThemeBrowser.tsx`,
`StateEditorModal.tsx`, `help-chat-provider.tsx`, `capabilities-report-card.tsx`,
`llm-logs-card.tsx`, `autonomous-rooms-card.tsx`, `autonomous-room-badges.tsx`.

**Exit:** every custom wrapper hook and inline read+mutate pair runs on TanStack.

### Phase 5 — Page-level reads & remaining raw mutations

The big page components and the long tail of raw `fetch()` mutations that were
never paired with invalidation:

- `app/salon/page.tsx` (6 reads, `mutateChats`), `app/aurora/page.tsx`
  (`mutateCharacters`), `app/profile/page.tsx`, `app/generate-image/page.tsx`,
  `app/salon/new/page.tsx`, `ChatSidebar.tsx` (3 reads),
  `AddCharacterDialog.tsx`, `AutoLockSettingsCard.tsx`, `core-whisper`.
- The remaining raw mutations: wrap in `useMutation` and, crucially, **add the
  invalidation that was missing**. This is where most of the correctness win
  lands — but it's also where behaviour can change, so each batch needs a manual
  smoke test of the affected screen.

**Exit:** no `useSWR` imports remain outside `__tests__`; raw mutations either go
through `useMutation` or are deliberately left as fire-and-forget (documented
case-by-case).

### Phase 6 — SSE boundary (reads only, transport untouched)

Confirm the streaming hooks (`useSSEStreaming.ts`, `useMessageStreaming.ts`,
`StreamingMessage.tsx`, `VirtualizedMessageList.tsx`) are clean of `useSWR` — they
already are. The only work here is making sure the **query reads that surround**
streaming (the initial message-history load, chat list, chat settings consumed in
the Salon) are migrated and that a completed stream invalidates the right query
keys (e.g. after a turn finishes, invalidate `chats.detail(id)` so any non-stream
consumers refresh). Do **not** push stream chunks into the query cache. Document
the boundary explicitly in the Salon hooks' comments.

**Exit:** the SSE/query boundary is documented; streaming still uses Fetch
Streams; no regression in the live message path (manual + Playwright smoke).

### Phase 7 — Removal & cleanup

1. Remove `swr` from `package.json`; delete `lib/swr-fetcher.ts` (or reduce it to
   the re-exported error class if anything still imports it).
2. Remove `<SWRConfig>` from `session-provider.tsx`.
3. Update the two SWR-specific tests
   (`image-gallery-deleted-handling.test.tsx`, `tasks-queue-card.test.tsx`) to the
   new `renderWithQuery` harness.
4. `npx tsc`, full `jest`, lint, and a Playwright pass.

**Exit:** SWR fully gone; one cache to rule them all.

---

## Testing strategy

Today's two SWR-aware tests wrap components in
`<SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, fetcher }}>`
and mock global `fetch` via `jest-fetch-mock` (already enabled in
`jest.setup.ts`). The equivalent:

```tsx
// __tests__/helpers/renderWithQuery.tsx
export function renderWithQuery(ui, opts) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>, opts);
}
```

- `fetch` stays mocked exactly as now (`jest-fetch-mock`), so endpoint stubs
  don't change — only the wrapper does.
- `retry: false` + `gcTime: 0` give the deterministic, isolated-per-test cache
  that `provider: () => new Map()` gave under SWR.
- Add focused tests for: optimistic update + rollback on `useChatSettings`;
  invalidation-after-mutation on one representative wrapper (e.g.
  `useRoleplayTemplates` create → list refetches); polling enable/disable on
  `useStoryBackground`.
- Playwright smoke for the Salon (streaming unaffected), Aurora list (create →
  appears), and Settings → Chat (toggle persists).

Per CLAUDE.md, every backend-touching change needs debug logging — this migration
is client-only, so that rule mostly doesn't bite, but any new `apiFetch` error
paths should `console`-log at the existing levels the components already use.

---

## Risks & mitigations

- **Optimistic-update regressions** (`useChatSettings`, `CoreWhisperSection`,
  the autonomous-room cards). *Mitigation:* migrate these last, one per change,
  with explicit before/after manual tests; reproduce `mutate(x, false)` exactly
  with `onMutate`+rollback.
- **Polling semantics drift.** *Mitigation:* the 4 polling sites get dedicated
  tests asserting interval behaviour and enable/disable.
- **Hidden cross-component cache coupling.** Some components rely on SWR's
  URL-as-key dedup so two unrelated components share a fetch. The key factory
  preserves this *only if* both sites use the same factory entry — audit shared
  endpoints (verified at planning time via grep: `/api/v1/settings/chat`
  referenced in ~27 files, of which ~8 are `useSWR` reads; `/api/v1/characters`
  read across ~14 `useSWR` files; `/api/v1/connection-profiles` read in ~6) and
  make sure they resolve to identical keys. Re-grep before relying on these —
  counts drift.
- **The `usePersonaDisplayName` `Set` is consumed on every `ChatCard`.** N cards
  must still mean one fetch — verify the `select`-derived `Set` is referentially
  stable (TanStack's structural sharing handles this, but test it; an unstable
  `Set` identity would thrash memoised `ChatCard`s).
- **SSR/Next 16.** Using a per-render `QueryProvider` client avoids the classic
  "shared client across requests" leak. No `dehydrate`/`hydrate` is needed unless
  we later choose to prefetch on the server (out of scope).

---

## Estimated shape of work

- Phase 1: 1 change (scaffolding) — must be reviewed carefully, it sets every
  convention.
- Phase 2: ~3–4 changes (batched conditional/simple reads).
- Phase 3: 1 change (the three module caches).
- Phase 4: ~6–8 changes (wrapper hooks, `useChatSettings` solo).
- Phase 5: ~4–6 changes (pages + raw-mutation batches).
- Phase 6: 1 change (boundary + Salon reads).
- Phase 7: 1 change (removal).

Roughly 17–22 reviewable changes. The risk is concentrated in Phase 4's
`useChatSettings` and Phase 5's previously-uninvalidated mutations; everything
else is mechanical.

## Execution notes (per CLAUDE.md)

- Plan in Opus; delegate the mechanical per-file batches (Phases 2, 3, most of 4)
  to Haiku agents with the key-factory and hook-convention docs in hand. Reserve
  `useChatSettings`, the polling hooks, and the Phase-5 mutation-invalidation work
  for closer supervision.
- **Don't** use git stash or worktrees with agents.
- Per the packages rule: this migration touches **app source only**, not
  `packages/` — no npm publish gating applies. If a key-factory or fetcher helper
  is later promoted into a shared package, that triggers the publish-first rule.
- Documentation obligations: this is developer-facing plumbing, but if any
  user-visible behaviour changes (it shouldn't), update `help/*.md`. Record the
  dependency swap and provider change in `docs/CHANGELOG.md` (terse, plain
  English — the changelog exception to the house voice). Add the query-key-factory
  and "no raw string keys" rule to `CLAUDE.md` once Phase 1 lands, and to
  `.claude/commands/update-documentation.md` if it warrants its own doc entry.
