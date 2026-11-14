# Refactor 4.12 — One recursive watcher core under both filesystem watchers

**Status:** Implemented (2026-11-03), all three phases. Decisions taken: the stop functions are wired into shutdown (`lib/startup/watcher-shutdown.ts`, registered beside the start calls in `instrumentation.ts`, prepended to SIGTERM / SIGINT so it runs before the database handlers close the connections; the `files/` watcher's deferred deletes are left to startup reconciliation there rather than flushed against a closing database), and both watchers share one 750 ms debounce (`WATCH_DEBOUNCE_MS`). The core is `lib/files/recursive-watcher.ts`, the walk skeleton `lib/files/walk.ts`. One refinement over §4.2: the `files/` folder sweep is gated on "no record at this exact key" rather than on an extension, since `files/` has no indexable-extension rule. Originally proposed 2026-11-02. Part of the [4.12 refactor set](../refactor-4-12.md). The smallest spec in the set; the win is behavioural parity more than lines.

## 1. The problem

Two watchers were rewritten onto Node's recursive `fs.watch` this cycle: the document-store watcher (`lib/mount-index/watcher.ts`, 641 lines; bf7a457f, db4a76e3) and the instance `files/` watcher (`lib/file-storage/watcher.ts`, 577 lines; db4a76e3). The `fs.watch` listener, the per-path debounce, the `pendingRenames` set and the `lstat` dispatch in `handleNativeEvent` were copied from one to the other, comments included (`mount-index/watcher.ts:77-81` and `file-storage/watcher.ts:51-56` are the same paragraph). That is about 100 lines in each file. The rest is domain logic that has nothing in common, which is fine. What is not fine is that the copy diverged in ways nobody chose:

| Concern | Document-store watcher | `files/` watcher |
|---|---|---|
| `fs.watch` refuses a recursive watch | Falls back to the polling walker (`:410-426`, `:481-555`); `QUILLTAP_WATCHER_POLLING=1` forces it | Logs a warning and **stays off** (`:518-526`); no polling support at all |
| Evicted cloud placeholder (iCloud, OneDrive) | Skipped via `isEvictedCloudPlaceholder` inside `processMountFile` (`scanner.ts:195-201`) | **No guard**; `computeSha256` (`file-storage/scanner.ts:209`) reads the file and triggers a download |
| A path that vanished | Removed at once, only if its extension is indexable (`handleUnlink:273-288`); folder sweep gated on `sawRename && !detectFileType` | Defer-deleted for 3 s (`pendingUnlinks`) so a move can cancel it; **`handleDirUnlink` runs a full `findByUserId` scan on every rename-delete, plain file deletes included** (`:417-443`, `:361-384`) |
| A folder that arrived by rename | `walkDirectory` (files only, explicit symlink skip) → index | `scanDirectory` (files and folders) → folder records + orphan file records |
| Realtime hint | `publishMountChange` debounced 250 ms | None |
| `'error'` event | Logged, no restart | Logged, no restart |
| Debounce | 750 ms per path | 500 ms per path |
| Symlinks | Skipped (`:325`) | Skipped (`:433`); no test |
| Stop | Clears timers, closes; **no production caller** (`DEAD-CODE-REPORT.md:67,434`); the comment "Called during graceful shutdown" at `:607` is wrong | Flushes pending deletes, closes; no production caller |

Also: three recursive `readdir` walkers in the storage layer with three filter rule sets (`mount-index/scanner.ts:114-167 walkDirectory`, `:483-520 listFilesystemFolders`, `mount-index/sync/walk-disk.ts:64`, `file-storage/scanner.ts:124-201 scanDirectory`), stale chokidar mentions in `database-store.ts:15` and `db-store-events.ts:8`, and a stale "subscription below" comment at `mount-index/watcher.ts:380`.

## 2. Goal

One `createRecursiveWatcher` that owns everything both watchers do identically, so that what is left in each file is only the domain: what to do with a file that changed, vanished, or arrived in a folder. The `files/` watcher inherits the polling fallback, the forced-polling switch and the cloud-placeholder guard by construction.

## 3. Non-goals

- Merging the domain halves. Move detection with deferred deletes belongs to the `files/` table; immediate remove-and-reindex belongs to document stores.
- Unifying the three walkers' *filter rules*. They differ on purpose (include/exclude patterns vs fixed skip rules vs dot-entries-and-sidecars). The walk skeleton can be shared; §5.3.
- Reacting to `'error'` events by restarting. Noted as a possible follow-up; out of scope.

## 4. Design

### 4.1 `lib/files/recursive-watcher.ts`

```ts
export interface RecursiveWatcherSpec {
  root: string;
  normalize: (filename: string) => string | null;      // mount: path.normalize, keep native sep; files: toStorageKey, '/'
  ignore: (rel: string) => boolean;                     // mount: isExcluded; files: shouldIgnore
  debounceMs: number;
  polling?: { intervalMs: number; snapshot: () => Promise<Map<string, {mtimeMs: number; size: number}>> };
  on: {
    file: (rel: string, stat: Stats) => Promise<void>;        // exists, not a symlink, not an evicted placeholder
    gone: (rel: string, sawRename: boolean) => Promise<void>;
    dirArrived: (rel: string) => Promise<void>;
    inCloud?: (rel: string) => void;                           // evicted placeholder seen; default: debug log
  };
  log: Logger;
}
export function createRecursiveWatcher(spec): { close(): void; mode: 'native' | 'polling' }
```

It owns: the `fs.watch` call with `{ recursive: true, persistent: true }`; the null-filename and `..`/`.`/empty guards; `pendingRenames`; the per-path debounce with the handler's errors caught and logged; `handleNativeEvent`'s `lstat` dispatch (`ENOENT`/`ENOTDIR` → `gone`; other errors rethrown; symlink → return; `isEvictedCloudPlaceholder(stat)` → `inCloud`; directory + `sawRename` → `dirArrived`; directory without rename → ignored; file → `file`); the fallback to polling when `fs.watch` throws, and `QUILLTAP_WATCHER_POLLING=1`; the `'error'` listener; and `close`, which clears every timer and `pendingRenames` and closes the handle.

The polling walker (`mount-index/watcher.ts:481-555`) moves here with its `snapshot` made pluggable; the document-store watcher passes its `walkDirectory`-based snapshot, the `files/` watcher passes one built on `scanDirectory`.

### 4.2 The two watchers after

- **Document store** (`mount-index/watcher.ts`): per-store `createRecursiveWatcher` with `on.file → handleAddOrChange`, `on.gone → handleUnlink` + the `!detectFileType` folder sweep, `on.dirArrived → walkDirectory + handleAddOrChange`. Keeps its embedding and publish debounces, the database-store bridge and the attach/detach/refresh API. Expected: about 540 lines.
- **`files/`** (`file-storage/watcher.ts`): one `createRecursiveWatcher` with `on.file → handleFileChange`, `on.gone → handleFileUnlink` + a folder sweep **gated** the way the mount one is (a plain file delete no longer scans every record), `on.dirArrived → handleDirArrival`. Keeps `pendingUnlinks`, move detection, the Bug 69 digest policy, flush-on-stop. Gains polling fallback and the cloud guard. Expected: about 470 lines.
- Delete `stopMountWatchers` / `stopWatcher` or wire them into shutdown; the comment at `:607` cannot stay as it is. Recommendation: wire them (instrumentation already starts both at `instrumentation.ts:908-913`).

### 4.3 Walk skeleton (optional, same PR or later)

`lib/files/walk.ts`: one recursive `readdir` with a `{ include(dirent, rel), descend(dirent, rel), followSymlinks: false }` port. `walkDirectory`, `listFilesystemFolders`, `walk-disk` and `scanDirectory` become calls with their own predicates. About 60 lines saved, and the next walker does not write a fourth skip-rule set.

## 5. Tests

The two existing `watcher-native.test.ts` suites (16 and 8 tests) move their shared cases (recursive watch, add/change, ignore, delete, folder left, folder arrived, change-only directory, burst coalescing, symlink, polling and fallback) onto `recursive-watcher.test.ts`, run once, and keep only their domain cases (mount: publish, embedding, detach; files: move cancellation across the delete window, Bug 69 digest). New: the `files/` watcher falls back to polling; an evicted placeholder under `files/` is not hashed; a plain file delete under `files/` does not call `findByUserId`.

## 6. Phases

1. Extract `createRecursiveWatcher` from the document-store watcher, behaviour-neutral; its suite passes unchanged.
2. Move the `files/` watcher onto it; land the three behavioural gains with their tests and a CHANGELOG line each.
3. Walk skeleton, stale comments, the stop/shutdown decision.

## 7. Decisions needed from the human

1. Wire the stop functions into shutdown (recommended) or delete them.
2. Whether the `files/` watcher's debounce should match the mount one (750 ms) once shared, or keep 500 ms as a spec parameter. Recommendation: one constant, 750 ms.
