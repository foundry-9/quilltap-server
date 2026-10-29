# Composer Document References (`#`)

**Status:** Proposal / Not Implemented
**Origin:** Phase 3 of [composer-typeahead.md](complete/composer-typeahead.md), split out on 2026-10-27 when the other phases were closed. The design below follows that phase, revised where the codebase has moved since it was written (May 2026); each revision is marked **Changed from the original**.

## Summary

Type `#` in the Salon composer (or the Document Mode rich editor), get a popover of Scriptorium documents matching what follows, pick one to insert a chip. On send, the reference tells the responding model about the document: a note naming its address when the model can use tools (it reads the file itself with `doc_read`), or the document's text attached as a file when it cannot.

## Goals

- `#scen` pops a menu of documents whose filename or path matches; arrows/Enter/Escape as in every other composer typeahead; the pick inserts a chip plus a trailing space.
- The chip survives a Markdown round-trip (rich mode → source mode → rich mode).
- On send, a tool-capable model gets a note naming the document and how to read it; nothing is inlined.
- On send, a model without tools gets the document's content attached, as the Library File button would.
- A per-trigger toggle on the Chat settings tab, default on.

## Non-goals

- Semantic or full-text search inside the popover. Filename/path matching only; `?action=semantic-search` stays where it is.
- Project files outside document stores (the old `chat-files` surface). Deferred.
- Rewriting stored messages when a referenced document is renamed or moved.

## Known state (verified 2026-10-27)

- **The typeahead shell exists.** `components/chat/lexical/typeahead/` has `useTypeaheadShell.tsx`, `GuardedTypeaheadMenuPlugin.tsx`, `MenuPortal.tsx`, `trigger-context.ts` and `types.ts`, built by [composer-emoji](complete/composer-emoji.md) and used by `CharTypeaheadPlugin`, `MentionTypeaheadPlugin` and `SlashCommandPlugin` (`components/chat/lexical/plugins/`). The new plugin is one more consumer; it builds no shell of its own.
- **There is still no custom `DecoratorNode`** in the composer. `MentionTypeaheadPlugin` shipped as plain-name insertion with no chip, so `DocumentReferenceNode` would be the first.
- **Per-trigger toggles, not one master switch.** **Changed from the original:** the single `composerSuggestions` flag was never built. `ChatSettings` has `composerEmoji`, `composerUnicode` and `composerSlashCommands` (`lib/schemas/settings.types.ts`), each gating only its typed trigger. Add `composerDocReferences: z.boolean().default(true)` beside them.
- **Documents have published addresses.** **Changed from the original:** instead of inventing a `doc:<mountId>/<path>` scheme, use the `qtap://` URI the rest of the system already speaks. `docStoreUriFor` (`lib/doc-edit/uri-producers.ts`) builds one from a mount id, name and relative path, falling back to the store's UUID when its name is ambiguous. A published address never says `self` (bug 256).
- **Context is built in phases, history last.** **Changed from the original:** the note to the model is not pushed onto a whisper list after the fact. It is a trailing section in `TrailingSections` / `composeTrailingMessage` (`lib/chat/context/turn-trailing.ts`), measured with everything else before history is packed (bug 263). Precedent: `buildInformBlock` (`lib/chat/context/inform-block.ts`), which is empty-is-absent in the same way.
- **Tool capability:** `checkModelSupportsTools(provider, modelName, userId)` in `lib/tools/pseudo-tool-support.ts`.
- **File attachment plumbing:** `lib/chat-files-v2.ts` loads attached files for the model, and both of its load paths already apply `shrinkImageForLlmTransport`.
- **No cross-store filename search exists.** `GET /api/v1/mount-points` lists stores; `GET /api/v1/mount-points/[id]/files` lists one store; `?action=semantic-search` is embedding-backed.

## Design

### Reference Markdown

`#[scenes/01-opening.md](qtap://Novel%20Drafts/scenes/01-opening.md)`

The bracketed text is the path as the user saw it, so a copy pasted elsewhere stays readable. The link target is the store's published address.

### `DocumentReferenceNode`

An inline, non-editable, selectable `DecoratorNode` (backspace deletes the whole chip):

```ts
{
  type: 'doc-ref',
  version: 1,
  mountPointId: string,
  path: string,
  uri: string,          // qtap:// address at insertion time
  displayName: string,
}
```

It renders `<span class="qt-doc-ref-chip">` with a document icon and the path. Clicking it opens the document in Document Mode when the composer is in a Salon chat. A reference whose document no longer resolves renders with a "Missing document" mark. New `qt-*` classes are mirrored into `packages/theme-storybook` in the same change (see CLAUDE.md, Themes).

### Markdown transformer

`components/chat/lexical/transformers/doc-reference-transformer.ts`, shaped like `table-transformer.ts`, matching `#\[([^\]]+)\]\((qtap:\/\/[^)]+)\)`, and added to `COMPOSER_TRANSFORMERS` in `MarkdownBridgePlugin.tsx`. The exclusion of `ITALIC_STAR` / `BOLD_ITALIC_STAR` there stays as it is.

### Trigger

`#` opens the menu only when followed directly by a non-space character, and never at the start of a line followed by a space, so a Markdown heading (`# Title`) and a bare `#` still type normally. Use `trigger-context.ts` the way the slash plugin does.

### Search endpoint

`GET /api/v1/mount-points?action=search-files&q=…&limit=…&mountPointIds=…` through `dispatchAction`. **Changed from the original:** an action on the collection, not a new `/search` sub-route.

- `q` required (min 1 char); `limit` default 20, max 50; `mountPointIds` optional, comma-separated.
- Case-insensitive substring match on file name and relative path in the mount-index DB. Order: exact filename → filename prefix → filename substring → path substring; apply the limit after ordering.
- Response: `{ results: [{ mountPointId, mountPointName, fileId, fileName, relativePath, uri }] }`, with `uri` from `docStoreUriFor`.
- Archived characters' vaults are tombstones and are left out.

### Send-time resolution

`lib/chat/parse-doc-references.ts` pulls `{ uri, displayName }` pairs out of the user's message. A new `lib/chat/context/doc-references-section.ts` resolves each address and returns the trailing section text:

- **Tool-capable model:** one short section naming each referenced document by its address, saying the operator pointed at it and that `doc_read` will open it. Nothing is inlined.
- **No tools:** load each document through the file-attachment path in `lib/chat-files-v2.ts` and attach it. Nothing goes in the trailing section.
- A reference that no longer resolves is logged at `warn` and skipped. The literal path stays in the message text, so the model still sees something.
- Debug logs at parse, resolve and inject (`[DocRefs]`).

### Settings and help

- `composerDocReferences` on the Chat tab, labelled and described in the same style as `composerSlashCommands`. Only the typed trigger is gated; existing chips still render with it off.
- Help: the composer help file (`help/chat-settings-composer.md`) gains a section, with `url` frontmatter and a matching `help_navigate(url: "...")` in its In-Chat Navigation section.

## Open questions

1. **Which turns carry the note?** Only the turn the referencing message is sent on, or every turn while that message is in the history window? The inform block's "consumed against a persisted assistant message" rule is a model for the first answer.
2. **Whose reach?** The operator can see every store, but the responding character may not be able to read the document (the project roster gate, `character_read` policy frontmatter). Either filter the popover to what the chat's characters can reach (via `resolveScenarioBuilderMountPool`-style pooling) or let `doc_read` refuse and say so.
3. **Renames.** A `qtap://` address carries the store name, so renaming the store breaks old chips. Should resolution fall back to the node's `mountPointId`, or always resolve by id and treat the URI as display only?
4. **Multi-character turns.** In a Salon with several characters, does every responder in the cycle get the note, or only the next one?

## Acceptance

- Typing `#scen` in a chat with `scenes/01-opening.md` in a visible store opens the menu; Enter inserts a chip and a space.
- `# Heading` at the start of a line types normally with the toggle on.
- A tool-capable model's request contains the trailing section naming the address and no file content.
- A model without tools gets the file attached, as with the Library File button.
- Rich → source → rich round-trips the chip.
- A reference to a deleted document shows a "Missing document" mark and is skipped on send with a `warn` line.
- Toggle off: `#` types plainly; old chips still render.

## File-touch summary

**New:** `components/chat/lexical/nodes/DocumentReferenceNode.tsx`, `components/chat/lexical/plugins/DocReferenceTypeaheadPlugin.tsx`, `components/chat/lexical/transformers/doc-reference-transformer.ts`, `lib/chat/parse-doc-references.ts`, `lib/chat/context/doc-references-section.ts`, plus tests for the parser, transformer round-trip, section builder (both capability branches) and search ordering.

**Modified:** `components/chat/lexical/LexicalComposerWrapper.tsx` and `app/salon/[id]/components/DocumentPane.tsx` (register node, mount plugin); `MarkdownBridgePlugin.tsx` (transformer); `app/api/v1/mount-points/route.ts` (`search-files` action); `lib/chat/context/turn-trailing.ts` (new section slot); `lib/schemas/settings.types.ts` and the Chat-tab settings UI (`composerDocReferences`); `app/styles/qt-components/` and `packages/theme-storybook/src/css/qt-components.css` (chip and menu classes); `docs/developer/API.md`; `help/chat-settings-composer.md`; `docs/CHANGELOG.md`.
