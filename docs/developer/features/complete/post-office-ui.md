# Feature Spec: Post Office UI — the "Compose Mail" composer button & modal

> **Companion to** [`post-office.md`](../post-office.md) (the backend mail feature, already implemented). This spec covers **only the Salon UI**: a new composer-gutter button that opens a "Compose Mail" modal letting the operator send a letter as one of their player-characters.
>
> **Status:** Implemented (4.7-dev). The composer button, Compose Mail modal (`components/chat/ComposeMailDialog.tsx`), `send-mail`/`mailbox` chat actions, the shared `lib/post-office/deliver.ts` service, and the `mail` icon (default + Madman's Box) are all in place; see `docs/CHANGELOG.md` (4.7-dev "Compose Mail button in the Salon composer").
>
> **Voice reminder:** all user-facing strings (button tooltip, modal title, labels, placeholder, toasts, help) are in the house style — steampunk + Roaring 20s + Gatsby + Wodehouse + Lemony Snicket. `docs/CHANGELOG.md` stays plain. Spelling is **Quilltap**, never "Quilttap".

## 1. Summary

Add a **mail** button to the composer gutter palette (`ComposerGutterTools`, the same 2×2-ish block that holds Insert Announcement / Library file / Generate image / Attach / RNG, shown next to the announcement megaphone). Clicking it opens a **Compose Mail** modal that mirrors the Insert Announcement modal's construction. The modal offers:

- **From** — which player-character the letter is sent *as*. Only characters the operator controls in this chat (`controlledBy: 'user'`). If exactly one, it's fixed (show it, no dropdown needed, or a disabled single-option select); if more than one, a dropdown.
- **To** — recipient character (dropdown of the *other* characters; see §5.2 for scope).
- **In reply to** — optional dropdown of letters currently in the **From character's own mailbox**, starting with a "No quoted reply" default. Selecting one quotes it (same semantics as `send_mail`'s `in_reply_to`).
- **Letter** — a Lexical Markdown editor (`MarkdownLexicalEditor`) for the message body.
- **Send** / **Cancel** in the footer.

On send, the UI POSTs to a **new chat action** that runs the existing Post Office delivery service with `from` = the chosen player-character, then refetches the chat so Suparṇā's delivery is reflected.

### Decisions already made (do not re-litigate)

| Question | Decision |
|---|---|
| Who is the letter *from* | **The player-character the operator is currently playing.** If the operator controls more than one character in this chat, a **From** dropdown lists those player-characters. |
| Backend delivery | **Reuse the Post Office delivery service** (the same path `send_mail`'s handler uses), with `from` = the chosen player-character. New chat action wraps it; no new mail storage logic. |
| What the "in reply to" dropdown lists | **Letters in the FROM character's own mailbox** (`Mail/` folder of the chosen sender), matching `send_mail`'s server-side rule that `in_reply_to` must reference a letter in the sender's own mailbox. The dropdown starts with **"No quoted reply."** |
| Mail/envelope icon | **None exists** in the registry — create one. Default `public/images/icons/mail.svg` **and** a Madman's Box override (`themes/bundled/madmans-box/icons/mail.svg` + manifest line). |

## 2. Grounding: how the relevant UI already works

Verified in the codebase so the implementer doesn't rediscover it.

### 2.1 The composer gutter palette (where the button goes)

- `app/salon/[id]/components/ChatComposer.tsx` renders `ComposerGutterTools` (left gutter) and passes `onInsertAnnouncementClick`.
- `components/chat/ComposerGutterTools.tsx` is the palette: a wide Insert-Announcement button (`Icon name="megaphone"`, `gridColumn: '1 / -1'`) over a grid of `qt-composer-gutter-button`s (Library `file-plus`, Generate `camera`, Attach `paperclip`, RNG dropdown). **The new mail button is added here** as another `qt-composer-gutter-button`, wired through a new `onComposeMailClick` prop.
- The prop is threaded: `ComposerGutterTools` ← `ChatComposer` (add `onComposeMailClick` to `ChatComposerProps`, pass it down) ← `app/salon/[id]/page.tsx`.

### 2.2 Modal state, render site, and the dialog primitive

- Modal open/close state lives in `app/salon/[id]/hooks/useModalState.ts` (e.g. `insertAnnouncementOpen` / `openInsertAnnouncement` / `closeInsertAnnouncement`). **Add `composeMailOpen` / `openComposeMail` / `closeComposeMail` here.**
- `app/salon/[id]/page.tsx` calls `const modals = useModalState()`, passes `onInsertAnnouncementClick={modals.openInsertAnnouncement}` to the composer and the open/close state to `ChatModals`. **Do the same for mail.**
- Modals are rendered in `app/salon/[id]/components/ChatModals.tsx`, conditionally. **Add the `ComposeMailDialog` render block there.**
- The dialog primitive is **`FloatingDialog`** (`components/ui/FloatingDialog.tsx`) — draggable/resizable, geometry persisted by `storageKey`. Props: `isOpen`, `onClose`, `title`, `storageKey`, `initialGeometry`, `minWidth`, `minHeight`, `headerActions?`. Standard body layout: `flex flex-col h-full`, a `flex-1 overflow-y-auto p-4` content area, and a footer `border-t qt-border-default px-4 py-3 flex items-center justify-end gap-3`.

### 2.3 The model to copy: `InsertAnnouncementDialog`

`components/chat/InsertAnnouncementDialog.tsx` is the template. It:

- Renders inside `FloatingDialog` with `storageKey: 'quilltap:insert-announcement-geometry'`, `initialGeometry { width: 640, height: 600 }`, `minWidth 420`, `minHeight 460`.
- Has a **sender mode** with a **character dropdown** (the `customAnnouncer 'character'` kind) — copy this dropdown pattern for **From** and **To**.
- Uses **`MarkdownLexicalEditor`** for the body (see §2.4).
- Submits via `fetch('/api/v1/chats/${chatId}?action=announcement', { method:'POST', body: JSON.stringify({ contentMarkdown, sender }) })`, shows a success toast, calls `onPosted?.()` then `onClose()`.
- Receives `isOpen`, `onClose`, `chatId`, `participantCharacterIds`, `onPosted` from `ChatModals`.

**The mail dialog should be a near-clone** with three selects (From, To, In-reply-to) + editor, posting to a new action.

### 2.4 Lexical editor in a modal

Use **`MarkdownLexicalEditor`** (default export from `@/components/markdown-editor/MarkdownLexicalEditor`) — **not** `LexicalComposerWrapper` (that one carries chat-only plugins). It is **state-driven, not ref-driven**:

```tsx
<MarkdownLexicalEditor
  value={body}
  onChange={setBody}
  disabled={isSending}
  namespace="ComposeMailDialog"
  ariaLabel="Letter body"
/>
```

Props of note: `value`, `onChange`, `disabled?`, `roleplayTemplateId?`, `remountKey?`, `className?`, `namespace?`, `ariaLabel?`, `showSourceToggle?` (default true), `minHeight?` (default `'12rem'`). Body markdown is just the `body` state string — pass it straight to the action.

### 2.5 Character lists

- Whole-workspace characters: `fetch('/api/v1/characters')` → `{ characters: CharacterCard[] }` (`{ id, name, title?, avatarUrl?, controlledBy?, defaultConnectionProfileId?, … }`). The announcement modal uses this directly. Query-key factory: `queryKeys.characters.list()` / `queryKeys.characters.all` (`lib/query/keys.ts`) if migrating to TanStack Query (preferred for new client reads — see §6).
- In-chat participants: the `chat` object passed to `ChatModals` exposes `chat.participants` (filter `p.type === 'CHARACTER' && !p.removedAt`, read `p.character`). The announcement modal derives `participantCharacterIds` this way.
- **Player vs LLM characters:** `controlledBy` is `'llm' | 'user'` (`ControlledByEnum`, `lib/schemas/character.types.ts`). **From** = chat participant characters with `controlledBy === 'user'`. **To** = the other characters in the chat (see §5.2 for whether To is chat-scoped or workspace-wide).

### 2.6 The icon system — and why a new icon is required

- `Icon` (`components/ui/icon.tsx`) renders `<span data-icon="<name>">`; the glyph is a CSS `mask-image` of `/images/icons/<name>.svg`, tinted by `currentColor`. Names are the public contract in `components/ui/icons/icon-registry.ts`.
- **There is no `mail`/`envelope`/`letter` icon** in the registry (verified against `ICON_REGISTRY` and `public/images/icons/`). One must be created (see §3).
- Theme bundles override icons by name. **Madman's Box** (`themes/bundled/madmans-box/theme.json`) carries an `"icons": { "<name>": "icons/<name>.svg", … }` map and ships per-icon SVGs under `themes/bundled/madmans-box/icons/`. It overrides essentially every registry icon, so a new `mail` icon needs a Madman's Box variant too, or that theme will fall back to the default glyph and look out of place. **The Madman's Box variant must obey the Gallifrey aesthetic** (see §3.4) — Charlie's explicit requirement.

## 3. New icon: `mail` (default + Madman's Box) — fully specified, do exactly this

> **The two SVG asset files are already drawn and committed to the repo** (Cowork designed the Madman's Box icon set, including this one). **Do NOT redraw, restyle, or "improve" them.** Use the exact bytes below. Your job is the *wiring* (registry entry, CSS regen, theme manifest line) plus verification. The canonical icon name is **`mail`** — a permanent public contract; never rename it.

Perform these steps in order. Each is exact — file path, content, and insertion point are given.

### 3.1 Default asset — already present; verify it matches

File: `public/images/icons/mail.svg`. It must contain **exactly** this (rounded caps/joins, matching the neutral house set):

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <rect x="3" y="5" width="18" height="14" rx="2"/>
  <path d="M3.5 6.5 L12 13 L20.5 6.5"/>
</svg>
```

If the file is missing or differs, write it verbatim. Do not alter coordinates, stroke widths, or cap/join values.

### 3.2 Madman's Box asset — already present; verify it matches

File: `themes/bundled/madmans-box/icons/mail.svg`. It must contain **exactly** this (the theme's sharp hand — `stroke-width="2"`, **butt** caps, **miter** joins; an envelope with a clear triangular flap seated inside the Gallifreyan seal ring with four cardinal dots):

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="butt" stroke-linejoin="miter">
  <circle cx="12" cy="12" r="8.5"/>
  <circle cx="12" cy="3.5" r="0.9" fill="currentColor" stroke="none"/>
  <circle cx="20.5" cy="12" r="0.9" fill="currentColor" stroke="none"/>
  <circle cx="12" cy="20.5" r="0.9" fill="currentColor" stroke="none"/>
  <circle cx="3.5" cy="12" r="0.9" fill="currentColor" stroke="none"/>
  <rect x="6.5" y="8.5" width="11" height="7.5" stroke-width="1.5"/>
  <polyline points="6.5 8.5 12 13 17.5 8.5" stroke-width="1.5"/>
</svg>
```

If missing or differing, write it verbatim. **Do not redesign it** — this is the signed-off art.

> Why these conventions: the default set uses rounded caps; the Madman's Box set uses butt caps + miter joins and builds glyphs from rings/dots/arcs (the Gallifrey "sacred clockwork" language — circle as structural grammar, four cardinal dots, radial reading). Both files above already honour their respective set. You don't need to reason about the aesthetic — just don't change the bytes.

### 3.3 Register the icon name (REQUIRED — the asset does nothing without this)

In `components/ui/icons/icon-registry.ts`, add one entry to the `ICON_REGISTRY` object in the **"people & domain actors"** group, immediately after the `'megaphone'` line, so it sits with the other domain-actor glyphs:

```ts
  'megaphone':     { defaultFile: '/images/icons/megaphone.svg',     defaultMode: 'mask' },
  'mail':          { defaultFile: '/images/icons/mail.svg',          defaultMode: 'mask' },
  'dice':          { defaultFile: '/images/icons/dice.svg',          defaultMode: 'mask' },
```

(The middle line is the addition; the surrounding lines show the exact placement and the column alignment to match.) This both extends the `IconName` union (so `<Icon name="mail" />` type-checks) and declares the default asset + `mask` render mode.

### 3.4 Regenerate the default icon CSS (REQUIRED)

Run:

```
npm run generate:icon-css
```

This writes the `data-icon="mail"` `mask-image` rule into the generated default stylesheet. **The icon will not render without this step.** Commit the regenerated CSS along with the rest. (Do not hand-edit the generated CSS; always regenerate.)

### 3.5 Wire the Madman's Box override into the theme manifest (REQUIRED)

In `themes/bundled/madmans-box/theme.json`, add one line to the `"icons"` map, immediately after the `"megaphone"` entry (keep the existing trailing-comma/last-entry structure valid — `"megaphone"` is followed by more entries, so just insert a new line after it):

```json
    "megaphone": "icons/megaphone.svg",
    "mail": "icons/mail.svg",
    "dice": "icons/dice.svg",
```

(The middle line is the addition.) Without this, Madman's Box falls back to the default envelope and the two won't match.

### 3.6 If theme bundles have a build/index step, run it

Check `lib/themes/` and `package.json` scripts (e.g. a `themes` build, `build:plugins`, or a bundle-index regeneration). If installing/validating bundled themes requires a build step so the new override is picked up, run it. If bundled themes are read directly from `themes/bundled/<id>/theme.json` at runtime with no build, no action is needed beyond 3.5.

### 3.7 Inventory / Storybook

If `docs/developer/ICON_INVENTORY.md` (the registry header cites it as the signed-off name contract) or an icon Storybook enumerates the set, add `mail` so the catalogue stays complete.

### 3.8 Verify

- `isIconName('mail')` returns `true`; `<Icon name="mail" className="w-5 h-5" />` type-checks and renders the envelope in the default theme.
- After `generate:icon-css`, the generated stylesheet contains a `[data-icon="mail"]` (or equivalent) mask rule pointing at `/images/icons/mail.svg`.
- Switching to **Madman's Box** swaps the glyph to the seal-ring envelope (confirm the override resolves — same visual weight as its sibling icons like `clock`/`megaphone`).
- `npx tsc` passes.

### 3.9 Other bundled themes

If any other bundled theme (`art-deco`, `earl-grey`, `great-estate`, `old-school`, `rains`) overrides the *full* icon set in its `theme.json`, it will fall back to the default `mail.svg` (which is fine and legible) unless you add a theme-specific variant. **Do not invent art for those themes in this pass** — leave them on the default fallback and note it in the PR description. Only Madman's Box gets a custom `mail` glyph here.

## 4. The composer button

In `components/chat/ComposerGutterTools.tsx`, add a button alongside the others (decide placement in the grid; logically it pairs with the announcement megaphone as another "insert a special message" action — consider giving mail a slot adjacent to it):

```tsx
<button
  type="button"
  onClick={onComposeMailClick}
  disabled={disabled}
  className="qt-composer-gutter-button"
  title="Compose mail"          // rewrite in house voice, e.g. "Post a letter"
  aria-label="Compose mail"
>
  <Icon name="mail" className="w-5 h-5" />
</button>
```

- Add `onComposeMailClick: () => void` to `ComposerGutterToolsProps`.
- Thread `onComposeMailClick` through `ChatComposerProps` in `ChatComposer.tsx` (add to the interface, destructure, pass to `ComposerGutterTools`).
- In `page.tsx`, pass `onComposeMailClick={modals.openComposeMail}`.
- Disabled state should match the gutter's existing `disabled={sending || !hasActiveCharacters}`. **Additionally**, mail requires at least one player-character (`controlledBy: 'user'`) and at least one possible recipient — if the modal would have an empty From or To list, either disable the button with an explanatory tooltip or let the modal open and show an in-voice empty state. Prefer opening + empty state so the operator learns *why*.

## 5. The Compose Mail modal (`components/chat/ComposeMailDialog.tsx`)

A new component mirroring `InsertAnnouncementDialog`.

### 5.1 Props (from `ChatModals`)

```ts
interface ComposeMailDialogProps {
  isOpen: boolean;
  onClose: () => void;
  chatId: string;
  /** Active CHARACTER participants in this chat (id + name + controlledBy + avatarUrl). */
  participants: Array<{ id: string; name: string; controlledBy: 'llm' | 'user'; avatarUrl?: string | null }>;
  /** Refetch the chat after a letter is delivered (so Suparṇā's delivery shows). */
  onPosted: () => void;
}
```

`ChatModals` already has `chat` and derives participant character lists for the announcement modal — derive `participants` the same way and pass it.

### 5.2 Fields

**From (sender player-character).**
- Source: `participants.filter(p => p.controlledBy === 'user')`.
- If 0 → empty state: in-voice "You aren't playing anyone in this scene, so there's no one to sign the letter." and disable Send.
- If 1 → show the single name as fixed (read-only chip or disabled select); default-selected.
- If ≥2 → a dropdown; default to the most-recently-active player-character if that's cheaply known, else the first. (Active-speaker default is a nice-to-have, not required.)
- Changing **From** must **reset the In-reply-to dropdown** and refetch that character's mailbox (§5.2 In-reply-to).

**To (recipient).**
- **Scope decision for the implementer to confirm against product intent:** the backend `send_mail` allows **any character → any character** (workspace-wide). For the UI, the natural list is **the other characters in this chat** (exclude the chosen From). If Charlie wants to mail characters *not* in the chat, widen To to the full `/api/v1/characters` list (minus the From). **Default this spec to: other characters in the current chat**, and leave a clearly-marked TODO to widen to workspace-wide if desired. Either way, exclude the currently-selected From character (though self-mail is technically allowed server-side, it's a confusing default in the UI).
- Dropdown of `{ id, name }`; show avatar + name if easy (the announcement character dropdown shows names; match it).

**In reply to (optional quote).**
- First option: **"No quoted reply"** (value `null`) — the default.
- Remaining options: letters in the **From character's own `Mail/` folder**, newest first, labelled by sender + date (e.g. *"From Bertie · 14 Jun"*). The option **value is the letter's `Mail/…` path** (the agent-facing message ID from the backend spec), which is exactly what the action needs for `in_reply_to`.
- Fetched on demand when the modal opens and whenever **From** changes. Needs a backend list endpoint (see §5.4) scoped to a character's mailbox. If the mailbox is empty/absent, the dropdown shows only "No quoted reply."

**Letter (body).**
- `MarkdownLexicalEditor` (§2.4), `namespace="ComposeMailDialog"`, `ariaLabel` in voice. Required — Send disabled while empty/blank.

### 5.3 Submit

On **Send**:

```ts
const res = await fetch(`/api/v1/chats/${chatId}?action=send-mail`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    fromCharacterId,        // the player-character signing the letter
    toCharacterId,          // recipient
    bodyMarkdown,           // editor content
    inReplyToPath,          // Mail/… path or null
  }),
});
```

On success: in-voice success toast ("Suparṇā has the letter and is already aloft."), `onPosted()` (refetch chat), `onClose()`. On error: surface the action's message inline (e.g. recipient vanished, reply-letter no longer in the sender's box) without closing.

Use the announcement modal's toast + error-handling shape. **Prefer TanStack Query `useMutation`** over a raw `fetch` for the send (and `useQuery` for the mailbox + character lists) per the repo's client-data-fetching rules (`lib/query/`), invalidating chat/message keys via the `queryKeys` factory. The raw `fetch` above is shown only to convey the payload.

### 5.4 New backend action(s)

Follow the `/api/v1/` action-dispatch pattern (the announcement action is the template: `app/api/v1/chats/[id]/actions/announcement.ts`, registered in `app/api/v1/chats/[id]/actions/index.ts`, schema in `app/api/v1/chats/[id]/schemas.ts`).

1. **`POST /api/v1/chats/[id]?action=send-mail`** — `app/api/v1/chats/[id]/actions/send-mail.ts`:
   - Zod schema in `schemas.ts` (e.g. `sendMailActionSchema`): `{ fromCharacterId: uuid, toCharacterId: uuid, bodyMarkdown: string.min(1), inReplyToPath: string.nullable().optional() }`.
   - Validate that `fromCharacterId` is a CHARACTER participant in this chat **and** `controlledBy === 'user'` (the operator can only send as a character they actually play — don't trust the client). Reject otherwise.
   - **Reuse the Post Office delivery service** that `send_mail`'s tool handler calls (from `post-office.md`: the `lib/post-office/` deliver helper + the shared `resolveCharacterByNameOrId`). Deliver with `from` = the From character, `to` = recipient, body = `bodyMarkdown`, applying the same `in_reply_to` quoting rules (quote body-only, "In reply to your email of {date}:"). Enforce the **same rule** that `inReplyToPath` must resolve within the **From character's** own mailbox; return a clear error if not.
   - Return `{ success: true }` (and optionally the delivered path). Log per the logging convention.
   - **Do not duplicate** delivery/quoting logic in the route — call the shared service so the tool and the UI stay in lockstep. If the existing service isn't cleanly callable outside the tool-dispatch context, refactor it into a `lib/post-office/` function both call (note this as the one likely refactor).

2. **`GET /api/v1/chats/[id]?action=mailbox&characterId=…`** (or a cleaner REST shape — implementer's call) — lists the letters in a given chat-participant character's `Mail/` folder for the In-reply-to dropdown. Returns `[{ path, from, sentAt }]`, newest first. **Authorize**: only allow listing a mailbox for a character that is a `controlledBy:'user'` participant of *this* chat (the operator may inspect their own players' mailboxes, nothing else). Reuse the backend's `collectUnalertedMail`/`listDatabaseFiles`-based read (without the unalerted filter — list all).

> Both endpoints are operator actions (single-user app), gated by the standard `@/lib/api/middleware` context. No cross-user concern, but **do** enforce the "From must be a user-controlled participant of this chat" check so the UI can't be coaxed into sending as an LLM character or a stranger.

## 6. Conventions to honour (the repo enforces these)

- **TanStack Query**, not raw fetch, for new client reads/writes; keys via `lib/query/keys.ts` factory; `apiFetch` as the `queryFn`. Add a `mailbox` block to the key factory if needed.
- **API routes**: new actions only under `/api/v1/` with `withActionDispatch`; responses via `@/lib/api/responses` (`badRequest`, `notFound`, `created`, …).
- **Logging** on every new backend path.
- **Next.js 16**: App Router only; `await params`/`searchParams` are Promises; no `pages/` or `middleware.ts`.
- **`qt-*` semantic classes** for styling — reuse `qt-composer-gutter-button`, `FloatingDialog`'s structure, and existing `qt-*` form/select classes the announcement modal uses rather than ad-hoc Tailwind. If a genuinely new style is needed, add a `qt-*` utility (and propagate to the stylebook/theme-storybook per CLAUDE.md).
- **Icons**: never swap `Icon` for inline SVG; the new glyph goes through the registry (+ `npm run generate:icon-css`).

## 7. Tests

- **Component (`ComposeMailDialog`):** renders From (fixed when 1, dropdown when ≥2; only `controlledBy:'user'` participants), To excludes the From, In-reply-to defaults to "No quoted reply" and lists the From character's mailbox; Send disabled on empty body/missing recipient; changing From resets + refetches the reply dropdown; empty-state when no player-characters.
- **Gutter button:** fires `onComposeMailClick`; respects `disabled`.
- **Backend `send-mail` action:** rejects a `fromCharacterId` that isn't a `controlledBy:'user'` participant of the chat; rejects `inReplyToPath` not in the From character's mailbox; happy path delivers via the shared service and the letter lands in the recipient's `Mail/`; quoting matches `send_mail` (body-only).
- **Backend `mailbox` list action:** returns the From character's letters newest-first; refuses a character that isn't a user-controlled participant of this chat.
- **Icon:** `isIconName('mail')` is true; the default CSS includes the `mail` mask rule after `generate:icon-css`; Madman's Box manifest includes `mail`.
- Snapshot/key tests as applicable; type-check with **`npx tsc`** (not `npm run build`).

## 8. Standing-rules deliverables

- **`docs/CHANGELOG.md`** (plain voice): "Added a Compose Mail button to the Salon composer: the operator can send a letter as one of their player-characters to another character, optionally quoting a letter from the sender's mailbox. New `mail` icon (default + Madman's Box)."
- **`help/*.md`** — update the Post Office help doc (`help/post-office.md` from the backend spec) to document the composer button + modal, with the required `url:` frontmatter and an "In-Chat Navigation" section whose `help_navigate(url: "…")` matches. Cover: where the button is, the From/To/In-reply-to/Letter fields, and that it delivers via Suparṇā just like the character tool.
- **Docs upkeep:** keep this file linked where features are tracked; move to `features/complete/` when shipped; update `/.claude/commands/update-documentation.md` if a new doc class is introduced.
- **Theme propagation:** the new `mail` icon must exist in Madman's Box (drawn to the Gallifrey aesthetic, §3.4); if other bundled themes (`art-deco`, `earl-grey`, `great-estate`, `old-school`, `rains`) also override the full icon set, add a `mail` variant to each that does (in that theme's own visual language), or confirm they fall through to the default acceptably.

## 9. Suggested implementation order

1. Icon: registry entry + `public/images/icons/mail.svg` + `npm run generate:icon-css`; Madman's Box override (+ other themes as needed). Verify `<Icon name="mail" />` renders in both default and Madman's Box.
2. Backend: `mailbox` list action + `send-mail` action (refactoring the Post Office delivery into a shared `lib/post-office/` callable if needed); schemas + dispatch registration; tests.
3. `useModalState` mail state; thread `onComposeMailClick` through `ChatComposer` → `ComposerGutterTools`; add the button.
4. `ComposeMailDialog` (From/To/In-reply-to/Letter) on `FloatingDialog` + `MarkdownLexicalEditor`, wired to the actions via TanStack Query; render it in `ChatModals`; pass props from `page.tsx`.
5. Tests, `npx tsc`, CHANGELOG, help-doc update.

## 10. Open items for the implementer to confirm against live code

- **To scope:** chat-participant characters (default) vs workspace-wide. Confirm with Charlie; ship chat-scoped with a TODO.
- Whether the Post Office delivery service is already cleanly callable outside the tool handler, or needs the small refactor in §5.4(1).
- Exact `participants` shape available in `ChatModals` (mirror what the announcement modal derives) and whether `controlledBy` is present there or must be read from `/api/v1/characters`.
- Whether other bundled themes override the full icon set (so `mail` must be added to each) or only some.
- The cleanest REST shape for the mailbox-list read (query action vs sub-route) given the repo's action-dispatch conventions.
