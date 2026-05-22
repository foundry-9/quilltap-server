# Composer Spellcheck — Layer 1 Spec

**Status:** Proposal / Not Implemented
**Scope:** quilltap-server (renderer) + quilltap-shell (Electron main + preload)
**Phase:** 1 of a planned 2 (Layer 2 — `@`/`#`/`/` typeahead — is deferred)

## Summary

Bring browser-native spellcheck to the Salon ChatComposer and Document Mode rich editor, expose it as a Chat-tab setting (default on), and — in the Electron shell only — wire up a right-click suggestion menu and a custom dictionary fed by Aurora character names. Desktop browsers do not run autocorrect on contentEditable, and Electron cannot change that; this spec stops at spellcheck plus a dictionary feed, which together cover the most useful slice of "autocorrect" without engaging an LLM.

## Goals

- Red-squiggle spellcheck on the Salon ChatComposer's Lexical ContentEditable, governed by a user setting.
- The same setting governs Document Mode's rich Lexical surface (not source-mode textareas, which stay opted out).
- In Electron: right-click on a misspelled word shows OS-style suggestions, an "Add to dictionary" entry, and an "Ignore" entry.
- In Electron: character names from Aurora are automatically added to the Chromium custom dictionary so invented names don't appear misspelled.
- In Electron: multi-language users can configure the spellchecker language list.

## Non-goals

- Autocorrect on contentEditable (not supported by Chromium on desktop; no workaround).
- LLM-driven inline completion (Layer 3 / deferred).
- User-defined text-replacement rules (Layer 1.5 / deferred).
- Typeahead menus on `@`, `#`, `/` (Layer 2 / deferred).
- Source-mode textareas — they remain `spellCheck={false}` deliberately (Markdown syntax + monospace = squiggle noise).

## Known State (verified 2026-05-22)

- **Electron version**: `^40.8.5` in `quilltap-shell/package.json`. Spellchecker APIs (`session.setSpellCheckerLanguages`, `addWordToSpellCheckerDictionary`, `removeWordFromSpellCheckerDictionary`, `listWordsInSpellCheckerDictionary`) and `webContents.on('context-menu', ...)` are all available.
- **Shell `webPreferences`**: no `spellcheck: false` anywhere. The main content `BrowserWindow` in `electron/main.ts` around line 793 sets only `preload`, `contextIsolation`, `nodeIntegration`. Default `spellcheck: true` applies.
- **ChatComposer ContentEditable** (`components/chat/lexical/LexicalComposerWrapper.tsx` lines 107–115): does **not** set `spellCheck`. Currently inherits the HTML default.
- **DocumentPane rich editor** (`app/salon/[id]/components/DocumentPane.tsx` lines 125–136, `DocumentEditorPlugins`): same — no explicit `spellCheck`.
- **Source-mode textareas** with explicit `spellCheck={false}`:
  - `app/salon/[id]/components/DocumentPane.tsx` line 462 (Markdown source view)
  - `app/salon/[id]/components/DocumentPane.tsx` line 506 (plain-text source view)
  - `components/markdown-editor/MarkdownLexicalEditor.tsx` line 222 (markdown editor source view)

  Leave these as-is.
- **Shell context menu**: no `webContents.on('context-menu', ...)` handler exists anywhere in `quilltap-shell`. Clean slate.
- **Shell capability flags**: `SHELL_CAPABILITIES` in `electron/constants.ts` is currently the empty string. This spec adds one flag.
- **Aurora character source**: `GET /api/v1/characters` returns `{ characters: Character[] }`. `Character.name` is `z.string().min(1).max(100)` and is the load-bearing field for the dictionary feed. `lib/schemas/character.types.ts:25`.
- **Preload bridge**: `quilltap-shell/electron/preload.ts` already exposes a `window.quilltap` object via `contextBridge.exposeInMainWorld`. We extend that surface; we do not create a parallel object.

## Architecture

Three moving parts. None require new packages.

1. **Renderer setting** (`quilltap-server`): a new boolean in the Chat-tab settings module — `composerSpellcheck` — read by both the ChatComposer ContentEditable and the Document Mode rich editor. Default `true`.
2. **Shell preload bridge** (`quilltap-shell`): three new methods exposed on `window.quilltap`:
   - `setDictionaryWords(words: string[]): Promise<void>` — replaces the Quilltap-managed dictionary set (additive against the user dictionary, but tracked so we don't grow forever; see "Dictionary lifecycle" below).
   - `setSpellCheckerLanguages(codes: string[]): Promise<void>` — passes through to `session.setSpellCheckerLanguages`.
   - `getSpellCheckerStatus(): Promise<{ enabled: boolean; languages: string[]; availableLanguages: string[] }>` — read-only inspection.
3. **Shell context menu** (`quilltap-shell`): a `webContents.on('context-menu', ...)` handler on the main window that builds an `electron.Menu` from `params.dictionarySuggestions`, `params.misspelledWord`, plus standard cut/copy/paste/select-all entries. Inline, no `electron-context-menu` dependency.

### Feature detection

The renderer detects shell presence by checking `typeof window !== 'undefined' && typeof window.quilltap?.setDictionaryWords === 'function'`. Do **not** rely on `QUILLTAP_SHELL` / `QUILLTAP_SHELL_CAPABILITIES` env vars from the renderer side — those are server-process env vars per existing convention and the renderer cannot read them directly. The capability flag is added for the server's own use (and future features), not for the renderer.

### Dictionary lifecycle

Chromium persists dictionary additions across sessions and there is no namespacing. To avoid polluting the user's personal dictionary with stale character names forever:

- The shell maintains a small JSON file at `<userData>/quilltap-managed-dict.json` listing words it has added on Quilltap's behalf.
- `setDictionaryWords(newSet)`: diff against the tracked set; `addWordToSpellCheckerDictionary` for additions, `removeWordFromSpellCheckerDictionary` for deletions; write the new set to disk.
- On shell startup, **do not** clear the dictionary — let the renderer push the current set after it loads. If the renderer never pushes (e.g. server start-up fails), stale words just remain temporarily benign.

### Word tokenization

Character names need to be split into individual words before being added to a per-word spellchecker. The renderer-side hook should:

- Split each name on whitespace and punctuation (`/[\s\p{P}]+/u`).
- Drop tokens shorter than 2 characters.
- Drop tokens that match `/^\d+$/`.
- Deduplicate across all characters before sending.
- Cap the total set at 5,000 words (sanity bound; log a warning if exceeded).

## Phase 1 — Renderer changes (quilltap-server)

### 1.1 Add the setting

Find the Chat-tab settings module (likely under `lib/settings/` or the Foundry subsystem defaults — `lib/foundry/subsystem-defaults.ts` per CLAUDE.md). Add:

- Key: `composerSpellcheck`
- Type: `boolean`
- Default: `true`
- Zod schema entry alongside the other Chat-tab settings.

If there is an existing settings page section for "Chat" (`/settings?tab=chat`), add a labelled toggle: **"Spellcheck in the composer"** with a short helper line: *"Underlines misspelled words in the Salon composer and Document Mode editor. Right-click in the Electron app to see suggestions and add words to your dictionary."*

### 1.2 Wire `spellCheck` on the two surfaces

- `components/chat/lexical/LexicalComposerWrapper.tsx`: read `composerSpellcheck` from the settings hook (whatever pattern the rest of the file uses for settings — match local convention), pass it as `spellCheck={composerSpellcheck}` to the `ContentEditable` on lines 107–115.
- `app/salon/[id]/components/DocumentPane.tsx`: same — read the setting, pass `spellCheck={composerSpellcheck}` to the `ContentEditable` on lines 129–134 inside `DocumentEditorPlugins`. **Do not** touch lines 462 and 506 (source-mode textareas).
- `components/markdown-editor/MarkdownLexicalEditor.tsx` line 222: leave as-is (source mode).

If the settings hook is async/server-derived, default to `true` while loading rather than `false` — the spellcheck-on appearance is the expected default.

### 1.3 Aurora dictionary feed (Electron-only)

Create `lib/spellcheck/useDictionaryFeed.ts` (renderer-side hook). Pseudocode:

```ts
import useSWR from 'swr';
import { useEffect } from 'react';

export function useDictionaryFeed() {
  const { data } = useSWR<{ characters: Array<{ name: string }> }>('/api/v1/characters');

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const shell = (window as any).quilltap;
    if (typeof shell?.setDictionaryWords !== 'function') return; // Not in Electron
    if (!data?.characters) return;

    const words = tokenizeNames(data.characters.map(c => c.name));
    shell.setDictionaryWords(words).catch((err: unknown) => {
      console.error('[Spellcheck] Failed to push dictionary words', err);
    });
  }, [data?.characters]);
}

function tokenizeNames(names: string[]): string[] {
  const set = new Set<string>();
  for (const name of names) {
    for (const token of name.split(/[\s\p{P}]+/u)) {
      if (token.length < 2) continue;
      if (/^\d+$/.test(token)) continue;
      set.add(token);
    }
  }
  const arr = Array.from(set);
  if (arr.length > 5000) {
    console.warn(`[Spellcheck] Dictionary set capped: ${arr.length} > 5000`);
    return arr.slice(0, 5000);
  }
  return arr;
}
```

Mount this hook once at a long-lived layout level so it runs as soon as the user lands in the app. The Salon layout (`app/salon/layout.tsx` if it exists, else the authenticated app shell) is the right place. Do **not** mount it per-chat — character data is global.

Add debug logging via the project's existing logger ("for every new feature and all existing functionality that is updated or touched in the backend, make sure that there are debug logs being fired" — CLAUDE.md). The hook is renderer-side, so use the renderer logger if one exists; otherwise `console.debug` with a `[spellcheck-feed]` prefix is acceptable.

### 1.4 Add a TypeScript declaration for the extended shell bridge

Wherever the existing `window.quilltap` type is declared in the renderer (search for `declare global` and `quilltap`), extend the interface to include `setDictionaryWords?`, `setSpellCheckerLanguages?`, and `getSpellCheckerStatus?` as optional methods so the renderer can feature-detect cleanly without `(window as any)` casts in the final code.

### 1.5 Help docs

Per CLAUDE.md, all user-visible changes must be documented in `help/*.md`. Find the Chat-tab help file (most likely `help/chat.md` or `help/settings-chat.md`) and add a section describing the spellcheck toggle. Include the standard frontmatter `url` (pointing to `/settings?tab=chat&section=spellcheck` or equivalent) and an "In-Chat Navigation" section with the matching `help_navigate(url: "...")` call, matching the pattern in neighbouring help files.

Voice: steampunk + Roaring 20s + Wodehouse + Lemony Snicket, as for all user-facing docs.

### 1.6 Changelog

Add a terse entry to `docs/CHANGELOG.md` at the top (reverse chronological). Direct American English, **not** the steampunk voice. Example:

```
- ChatComposer and Document Mode rich editor now run browser spellcheck, controlled by a new "Spellcheck in the composer" toggle on the Chat settings tab (default on). Electron shell adds a right-click suggestion menu and feeds character names into the custom dictionary so invented names don't appear misspelled.
```

## Phase 2 — Shell changes (quilltap-shell)

### 2.1 Add the capability flag

In `electron/constants.ts`, change `SHELL_CAPABILITIES` from `''` to `'SPELLCHECK_DICTIONARY'`. Per CLAUDE.md the canonical list lives here and the flag flows automatically through all four launch modes via `QUILLTAP_SHELL_CAPABILITIES`. No other plumbing needed in the shell; the server can read it later when relevant.

### 2.2 Spellcheck manager module

Create `electron/spellcheck-manager.ts`. Responsibilities:

- Load and save `<app.getPath('userData')>/quilltap-managed-dict.json` (shape: `{ words: string[] }`).
- `applyDictionaryWords(session: Session, words: string[])`: diff against the persisted tracked set, call `addWordToSpellCheckerDictionary` / `removeWordFromSpellCheckerDictionary`, write the new tracked set.
- `setLanguages(session: Session, codes: string[])`: validate against `session.availableSpellCheckerLanguages`, call `setSpellCheckerLanguages`, log warnings for any unsupported codes.
- `getStatus(session: Session)`: return `{ enabled, languages, availableLanguages }`.

Use the same logger pattern as the rest of the shell (`console.log('[Spellcheck] ...')` matches existing shell conventions per `main.ts`).

### 2.3 IPC handlers

In `electron/main.ts`, after the main `BrowserWindow` is created, register three `ipcMain.handle` channels matching the preload bridge:

- `spellcheck:set-dictionary-words` → `spellcheckManager.applyDictionaryWords(win.webContents.session, words)`
- `spellcheck:set-languages` → `spellcheckManager.setLanguages(...)`
- `spellcheck:get-status` → `spellcheckManager.getStatus(...)`

### 2.4 Context-menu handler

In `electron/main.ts`, after the main `BrowserWindow` is created, register:

```ts
win.webContents.on('context-menu', (_event, params) => {
  const template: Electron.MenuItemConstructorOptions[] = [];

  if (params.misspelledWord) {
    for (const suggestion of params.dictionarySuggestions.slice(0, 5)) {
      template.push({
        label: suggestion,
        click: () => win.webContents.replaceMisspelling(suggestion),
      });
    }
    if (params.dictionarySuggestions.length === 0) {
      template.push({ label: 'No suggestions', enabled: false });
    }
    template.push({ type: 'separator' });
    template.push({
      label: `Add "${params.misspelledWord}" to dictionary`,
      click: () => win.webContents.session.addWordToSpellCheckerDictionary(params.misspelledWord),
    });
    template.push({ type: 'separator' });
  }

  if (params.isEditable) {
    template.push({ role: 'cut', enabled: params.editFlags.canCut });
    template.push({ role: 'copy', enabled: params.editFlags.canCopy });
    template.push({ role: 'paste', enabled: params.editFlags.canPaste });
    template.push({ type: 'separator' });
    template.push({ role: 'selectAll' });
  } else if (params.selectionText) {
    template.push({ role: 'copy' });
  }

  if (template.length === 0) return;
  Menu.buildFromTemplate(template).popup({ window: win });
});
```

Note: the handler runs for **every** right-click, not just on misspellings — so it becomes the de-facto context menu for the app. Verify this is acceptable (currently there is no custom handler, so users get Chromium's default, which on Electron is minimal). If the user prefers to keep Chromium's default for non-editable contexts, gate the entire handler on `params.isEditable || params.misspelledWord`.

### 2.5 Preload bridge

In `electron/preload.ts`, extend the existing `contextBridge.exposeInMainWorld('quilltap', { ... })` object with:

```ts
// --- Spellcheck ---
setDictionaryWords: (words: string[]): Promise<void> =>
  ipcRenderer.invoke('spellcheck:set-dictionary-words', words),
setSpellCheckerLanguages: (codes: string[]): Promise<void> =>
  ipcRenderer.invoke('spellcheck:set-languages', codes),
getSpellCheckerStatus: (): Promise<{ enabled: boolean; languages: string[]; availableLanguages: string[] }> =>
  ipcRenderer.invoke('spellcheck:get-status'),
```

### 2.6 Version bump and publish

Per the shell repo's conventions and CLAUDE.md plugin guidance: bump the shell's `package.json` patch number, update any release notes the shell repo uses, and (since this is the shell itself, not an npm-published library) follow the shell's normal release process. **Pause here** and ask the human developer to confirm before tagging.

## Phase 3 — Verification

### Type checks

- Server: `npx tsc` in `quilltap-server` (per CLAUDE.md, not `npm run build`).
- Shell: `npx tsc -p electron/tsconfig.json` in `quilltap-shell`.

### Manual verification

1. **Browser path (no shell):** Run `npm run dev` in `quilltap-server`. Open Salon, type "teh quik brown fox" — red squiggles appear. Toggle the setting off — squiggles disappear. Toggle on — squiggles return. Repeat in Document Mode rich editor; confirm source-mode textareas remain squiggle-free regardless.
2. **Electron path:** Run the shell pointed at the local dev server. Repeat (1). Then right-click a misspelled word: suggestions appear in a native menu; clicking one replaces the word; "Add to dictionary" removes the squiggle and persists across reloads.
3. **Aurora dictionary feed:** Create a character named "Aristarchus the Wise." Reload the Salon. Type "Aristarchus" — no squiggle. Type "Aristarchuz" — squiggle. Delete the character. Reload. Type "Aristarchus" again — squiggle returns (confirming diff-based removal).
4. **Multi-language (optional smoke test):** With shell running, in DevTools console: `await window.quilltap.setSpellCheckerLanguages(['en-US', 'fr'])`. Type a French word with an English-only typo — confirm both dictionaries are consulted.

### Automated tests

- Unit test `tokenizeNames` in `lib/spellcheck/useDictionaryFeed.ts` (Jest).
- Unit test the spellcheck-manager's diffing logic in the shell (Jest if the shell uses it; otherwise a tiny `node --test` script).
- The context-menu handler is hard to unit-test against Electron; an integration test via Playwright with Electron is overkill for this scope. Document the manual checklist above as the verification path.

### Logs

- Server-side: confirm the renderer logs `[spellcheck-feed]` debug lines when characters load and when the push completes.
- Shell-side: confirm `[Spellcheck]` lines show the diff counts (e.g. `[Spellcheck] Applied dictionary delta: +12, -0`).

## Open questions

- **Should the rich Document Mode editor really share the toggle with the Salon composer?** Probably yes (one knob, one mental model), but if writers want spellcheck in the chat but not when drafting fiction in Document Mode, a second toggle would be warranted. I'm recommending one toggle and revisiting based on user feedback.
- **Language picker UI.** The settings toggle is binary (on/off). A multi-language picker would require listing `availableSpellCheckerLanguages` (which is shell-only) in the settings UI — a feature-detection branch on the settings page. Deferring to a v1.1 unless the human developer wants it now.
- **Custom dictionary scope.** This spec adds character names. Project names, file names from the Foundry, and Scriptorium document titles would also be useful seeds. Decide whether to expand the feed before shipping, or layer it on incrementally.

## Deferred (for later phases)

- **Layer 1.5** — user-defined text-replacement rules ("Aris → Aristarchus") as a Lexical plugin watching word boundaries, plus a Chat-tab editor. Cross-platform substitute for OS autocorrect.
- **Layer 2** — typeahead menus for `@` (participants/Aurora), `#` (Scriptorium/project files), `/` (Prospero tools), via `@lexical/react/LexicalTypeaheadMenuPlugin`.
- **Layer 3** — LLM ghost-text completion via a Lexical decorator node and a debounced call to a fast/cheap provider, gated behind a setting.

## File-touch summary for Claude Code

**quilltap-server:**
- `lib/foundry/subsystem-defaults.ts` (or the actual Chat-tab settings module) — add `composerSpellcheck` default.
- The settings Zod schema for the Chat tab — add the field.
- The Chat-tab settings page component — add the toggle.
- `components/chat/lexical/LexicalComposerWrapper.tsx` — read setting, pass `spellCheck` to ContentEditable.
- `app/salon/[id]/components/DocumentPane.tsx` — read setting, pass `spellCheck` to ContentEditable in `DocumentEditorPlugins`.
- `lib/spellcheck/useDictionaryFeed.ts` — new file.
- The authenticated layout (e.g. `app/salon/layout.tsx`) — mount `useDictionaryFeed()`.
- Renderer type declarations for `window.quilltap` — extend.
- `help/chat.md` (or equivalent) — new section.
- `docs/CHANGELOG.md` — top entry.

**quilltap-shell:**
- `electron/constants.ts` — set `SHELL_CAPABILITIES` to `'SPELLCHECK_DICTIONARY'`.
- `electron/spellcheck-manager.ts` — new file.
- `electron/main.ts` — register IPC handlers and context-menu listener for the main `BrowserWindow`.
- `electron/preload.ts` — extend `window.quilltap` with three methods.
- `package.json` — patch bump (pause before publish).
