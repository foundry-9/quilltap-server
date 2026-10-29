# Bug 256 — a published `qtap://self` address opens the reader's own vault

| | |
|---|---|
| **Status** | FIXED |
| **Found** | 2026-10-19, live on `Friday`, while specifying the Inventory title lint: a request for Abigail's `metadata.json` returned Friday's |
| **Fixed** | 2026-10-19 |
| **Severity** | High. Nothing errors and nothing is stored wrongly, but a read meant for one character's vault returns a complete, plausible file from the reader's own vault — the right filename, the wrong person. Any flag or fact read that way is a confident wrong answer |
| **Who it bites** | every multi-character chat: any character following an address another character's tool result, Librarian announcement or `self_inventory` listing produced for its own vault |
| **Provenance** | Original to the `qtap://` URI work. The producers preferred `qtap://self/…` for the acting character's own vault as the "stable" form, without asking who would read it |
| **Fix site** | `lib/doc-edit/uri-producers.ts`, `lib/services/librarian-notifications/writer.ts`, `lib/tools/handlers/doc-edit/shared.ts` (`publishedMountPoint`) and its callers, `lib/tools/handlers/self-inventory/builders.ts` / `formatters.ts`, `lib/doc-edit/path-resolver.ts` (messages) |
| **v5 status** | Owed |
| **Index** | [bugs.md](../../bugs.md) |

---

**FIXED in v4 (2026-10-19).** No address Quilltap hands out depends on who reads it. The URI
producers name the store (its UUID when the name is ambiguous) for a character's own vault as for
any other; the Librarian's announcements name the resolved store instead of the `mount_point` the
caller typed, and a `self` that still reaches the writer (an old `chat_documents` row) is printed
as a bare path rather than an address; Document Mode's `chat_documents` row records the resolved
store's name; `self_inventory` lists vault files by the vault's name and gives an old `self` row no
URI. A character may still type `self` for its own vault, and the owner-only surfaces (Prospero's
vault whisper, the knowledge injector's own-vault entries) still teach it. The resolver's errors
now name an unknown store, and refuse a bare path with the reason. Covered by
`__tests__/unit/lib/doc-edit/vault-addresses-reader-independent.test.ts`.

## Symptom

In a chat with several characters, Abigail edits or opens her own `metadata.json`. The Librarian's
note, visible to everyone, ends `(qtap://self/metadata.json)`. Friday follows it with
`doc_read_file({ uri: "qtap://self/metadata.json" })` and receives Friday's own `metadata.json`:
it opens clean, parses clean, and reads as a complete, dated, first-person document. Nothing
anywhere errors.

## Root cause

`qtap://self/…` is a reserved address meaning **the vault of whoever follows it**
(`lib/doc-edit/path-resolver.ts:462`, `resolveSelfVaultMountPointId(context.characterId)`). The
resolver is right to read it that way. The producers were wrong to publish it:

- `docStoreUriFor` and `buildDocStoreUriResolver` (`lib/doc-edit/uri-producers.ts`) returned
  `formatSelfUri(...)` whenever the store was the acting character's own vault. Every `doc_*`
  tool's result `uri`, `search_scriptorium`'s hits and the blob tools went through them, and tool
  results enter every other character's context in a multi-character chat
  (`context-builder.service.ts`, TOOL messages carry `participantId: null`).
- `librarianUri` (`lib/services/librarian-notifications/writer.ts:212`) printed `qtap://self/…`
  for a `mount_point` of `'self'` or none, and every doc handler passed the caller's raw
  `input.mount_point`; the announcements are posted with no `targetParticipantIds`.
- Document Mode stored the raw `input.mount_point` (`'self'`) on the `chat_documents` row, and
  `self_inventory`'s context-file list rendered it as `qtap://self/…` with a `howToReach` for every
  caller; its vault listing did the same for the owner's own files, under a footer recommending
  `qtap://self/<relativePath>` in a tool result others read.

The store lookup itself was strict throughout: an unknown name or id is an error and every query
is filtered by store id. The defect was the relativity of the address, not a fallback.

## Why it survived

`self` was introduced as the stable, rename-proof handle for a character's own vault, and it is
exactly right inside that character's own prompt. The producers were written from the acting
character's point of view and never asked who else would read their output. A single-character
chat cannot show the fault, and in a multi-character chat the wrong answer looks correct.

## The fix

- `uri-producers.ts` no longer has a self-vault branch; `docStoreUriFor`, `uriForResolvedPath` and
  `buildDocStoreUriResolver` lost their character argument.
- `publishedMountPoint(resolved, requested)` (`doc-edit/shared.ts`) gives every Librarian
  announcement and the `chat_documents` row the resolved store's name.
- `librarianUri` prints a bare path for a leftover `self`; `scopeLabel` calls it "a character's
  vault".
- `self_inventory` names the vault in each file's `uri`, gives a legacy `self` context-file row no
  URI and an explanatory `howToReach`, and its footer explains that `self` is the reader's own.
- `resolveDocumentStorePath`'s `NOT_FOUND` names the store asked for, and `MISSING_CONTEXT` says a
  path alone names no store (every vault has a `metadata.json`).
- Not done, by ruling: a `self` read is not refused in a multi-character chat. That would punish
  the honest use (a character reading her own vault with others present) and leave the relative
  address in circulation.

## How to verify

`npx jest __tests__/unit/lib/doc-edit/vault-addresses-reader-independent.test.ts`: the producers
never return `qtap://self`; an address Abigail's own-vault read produces, followed by Friday,
resolves to Abigail's vault; five vaults with one `metadata.json` each never answer for each other
or return the same bytes for two carriers; a wrong id is an error naming it; a bare filename is
refused; `self` still means the reader's own vault. Live: in a chat with two characters, have one
`doc_write_file` into its own vault and check the Librarian's note names the vault.
