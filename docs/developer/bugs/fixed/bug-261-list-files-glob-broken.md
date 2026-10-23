# Bug 261 — `doc_list_files`' glob pattern understands only `*.ext` and an exact name

| | |
|---|---|
| **Status** | FIXED |
| **Found** | 2026-10-23, while tracing bug 260 on `Friday` (chat `772f89bf-0158-47ca-a214-41711d8437f0`) |
| **Fixed** | 2026-10-23 |
| **Severity** | Low to medium. Nothing is lost, but a reasonable pattern returns `No files found.`, which a model reads as "the file does not exist" |
| **Who it bites** | any character who passes `doc_list_files` a pattern with `**`, `/`, `{…}`, `?` or `[…]`, or a name in different capitals |
| **Provenance** | Original to `doc_list_files`: the "simple implementation" `matchesGlob` in `handleListFiles` |
| **Fix site** | `lib/doc-edit/path-glob.ts` (`compilePathGlob`), `lib/tools/handlers/doc-edit/text-handlers.ts` (`handleListFiles`), `lib/tools/doc-list-files-tool.ts` (description), `help/document-editing-tools.md` |
| **v5 status** | Owed |
| **Index** | [bugs.md](../../bugs.md) |

---

**FIXED in v4 (2026-10-23).** `compilePathGlob` (`lib/doc-edit/path-glob.ts`, pure) compiles the
pattern to a RegExp once per call. A pattern with no `/` matches the file name in any folder; one
with a `/` matches the store-relative path. `**/` matches zero or more folders, so
`**/CHANGELOG.md` finds a file at the root. `*` and `?` stay within one segment; `{a,b}` and
`[…]` / `[!…]` work. Matching is case-insensitive, like store names. `handleListFiles` now matches
against the relative path in all three branches (filesystem walk, database store, project store).
The tool description states these rules. Tests: `lib/doc-edit/__tests__/path-glob.test.ts` and the
list cases in `lib/doc-edit/__tests__/uploaded-blob-reads.test.ts`.

## Symptom

Amy called `doc_list_files` with `scope: "project"` and `pattern: "**/CHANGELOG.md"` and got
`No files found.`, though `CHANGELOG.md` sat at the root of the project store. She then concluded
the changelog "isn't on any project shelf".

## Root cause

`handleListFiles` (`text-handlers.ts`, formerly around line 926) filtered with:

```ts
if (pattern.startsWith('*.')) return filename.endsWith(pattern.substring(1));
return filename === pattern;
```

against the file's base name. `**/CHANGELOG.md` is neither form, so it matched no file anywhere.
Neither did the examples in the tool's own schema description, `*.{ts,tsx}` and `src/**/*.js`.

## Why it survived

The common case, `*.md`, worked. A failing pattern returns an ordinary empty result, which reads as
"no such file" rather than as an error, so nobody saw a tool failure to report.

## How to verify

`doc_list_files` with `pattern: "**/<name>"` should list a file at the store root and in folders;
`pattern: "*.{md,txt}"` should list both kinds; `pattern: "changelog.md"` should find
`CHANGELOG.md`.
