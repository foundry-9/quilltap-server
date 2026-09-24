---
url: /settings?tab=chat&section=composer-spellcheck
---

# Chat Settings — The Composer and Your Typing

> **[Open this page in Quilltap](/settings?tab=chat&section=composer-spellcheck)**

Everything on the Chat Settings page that concerns the business end of the pen: how a new chat greets your first keystroke, what the composer does with a colon and a word, which of your abbreviations it quietly expands, and whether your straight quotes are permitted to curl. The rest of the page is described in [Chat Settings](chat-settings.md) and [The Staff Behind the Scenes](chat-settings-ai-services.md).

All of these cards live on **Settings → Chat Settings**, and each applies to every chat unless noted otherwise.

## Composition Mode

Decides whether each new chat is delivered to your blotter pre-poised for prose. When the toggle is enabled, every fresh chat opens in composition mode — Enter inserts a newline, and Ctrl/Cmd+Enter sends the message — which suits leisurely paragraphs, formatted scenes, and other unhurried correspondence. When disabled (the factory default), new chats open in chat mode, where Enter sends and Shift+Enter inserts a newline, in the brisk fashion of a telegram clerk.

**Setting Options:**

- **Start New Chats in Composition Mode** — A simple boolean. On: new chats begin in composition mode. Off: new chats begin in chat mode.

**How to configure:**

1. Tick or untick the box at the top of the Chat tab in Settings
2. The change applies to chats created after the toggle, not to existing ones
3. The composer's toolbar still lets you flip the mode for any individual chat at any time

**When useful:**

- You favor multi-paragraph messages and would rather not bump Shift each time
- You're using Quilltap chiefly for long-form roleplay or co-writing rather than rapid-fire chat

**The raw-Markdown view.** While a chat is in composition mode, the formatting
toolbar offers a source toggle — a peek behind the curtain at the raw Markdown
of whatever you are drafting, laid bare in a plain writing box. Edit it there as
freely as you like: what you can see is what gets sent, and the Send button
attends to the source box while it is showing, then hands your revisions back to
the rich editor when you flip the toggle again. (Before 4.9.0 the two surfaces
were at cross purposes, and a message sent from the source view arrived in its
*pre*-edit state; that discourtesy has been dealt with.)

## Composer

A small but civilising amenity: red-pencil underlines beneath any word the dictionary fails to recognise, kept switched on by default for the saving of one's dignity. The toggle governs both the Salon composer (where one's daily correspondence is conducted) and the Document Mode rich editor (where longer compositions are mustered into shape). It does **not** disturb the raw-Markdown or plain-text source views, which are left blissfully unsquiggled so that one's punctuation and tagging are not mistaken for misspellings.

In the Quilltap desktop application — that more dignified vessel than the bare browser — a right-click upon any flagged word produces a small menu of suggestions in the manner of an attentive sub-editor, together with the option to add the offending coinage to your personal dictionary. The browser, alas, offers no such courtesy.

When running inside the desktop application, Quilltap also discreetly feeds the names of all characters in your Aurora into the spellchecker's custom dictionary, so that the invented appellations of your cast (Aristarchus, Theophilus, Penwallow, &c.) do not appear unjustly accused. New characters are added on the next reload; deletions remove them in turn.

**Setting Options:**

- **Spellcheck in the composer** — A single toggle. On: red squiggles appear beneath misspelled words in the rich-text composer and the Document Mode editor. Off: silence prevails.

**How to configure:**

1. Open the **Composer** card on the Chat tab in Settings
2. Tick or untick the box
3. The change applies at once to all open composers; no reload required

**When useful:**

- You suffer the occasional typographical lapse and would rather be told than not
- You are drafting fiction in Document Mode and want a steady second pair of eyes
- (Desktop only) You have a cast of invented names and would rather not see them all flagged as misspellings

**When to turn it off:**

- The squiggles distract you in flow
- You are writing in a language Chromium does not recognise (you may also configure additional languages in the desktop app's developer console — a refinement we will dress up in a proper picker in a later issue)

### Emoji Shortcuts

Also lodged in the **Composer** card, and quite the most cheerful amenity we have yet installed: type a colon followed by **at least two letters** — `:smi`, `:rock`, `:tada` — and a small brass-cornered menu unfurls beside the caret, offering every emoji whose name or keyword answers to what you have typed. Arrow keys to browse, Enter or a click to insert, Escape to dismiss without the slightest fuss. Should you happen to know the shortcode outright, type it entire and close it with a second colon — `:smile:` — and the character is set at once, the menu never having been troubled at all.

Two letters is the minimum, and deliberately so. A single letter would summon half the catalogue; and `:)` — that ancient and honourable glyph — must be permitted to remain exactly what it is. By the same reasoning the menu declines to appear after `http://`, inside `10:30`, in `C:\Users`, or anywhere a colon is merely doing punctuation's ordinary work. It also holds its peace inside code fences and `inline code`, where an uninvited pictograph would be a positive menace.

What lands in your document is **the plain Unicode character itself** — not a shortcode, not a picture, not some contraption of ours. This matters more than it sounds: the emoji you insert is ordinary text to every other part of the house. It exports intact, it survives a round trip through Markdown untouched, it is searchable, and the model at the other end of the conversation reads it exactly as you wrote it. One tap of Cmd/Ctrl+Z removes the character and restores the literal `:smi` you typed, in the customary single gesture.

No trailing space is added — an emoji sits closer to punctuation than to a word, and `word😄` and `😄😄` are both perfectly respectable constructions we decline to interfere with.

There is also a **button** in the formatting toolbar (the small `☺`), which opens a searchable picker with a browsable grid and a **Recently used** row of your last two dozen selections. A caution worth stating plainly: that toolbar appears only in composition and document-editing modes, so the button is a convenience rather than the feature proper. The colon is always at your disposal; the button is not. Your recents are kept in this browser alone, and are quite deliberately never sent anywhere.

The emoji catalogue is fetched only the first time you actually want it — instances whose correspondents never type a colon never pay for it at all. Should the catalogue prove unreachable, nothing whatever is impeded: the menu simply declines to appear, the picker says so, and your typing proceeds unmolested.

**Setting Options:**

- **Emoji shortcuts** — A single toggle, on by default. On: the `:` menu appears as described. Off: the colon does nothing untoward, and remains an honest colon.

**How to configure:**

1. Open the **Composer** card on the Chat tab in Settings
2. Tick or untick **Emoji shortcuts**
3. The change applies at once; no reload required

**When useful:**

- You want an emoji by *name* without leaving the keyboard or hunting through a grid
- You are on a platform whose own emoji picker is an inconvenience, or absent entirely

**When to turn it off:**

- Your prose is thick with colons — script formatting, timestamps, ratios — and you would rather the menu never stirred
- Note that the toolbar's emoji button is **not** governed by this toggle. The switch restrains the *automatic* colon, which is the part capable of surprising you; a button pressed on purpose never is.

### Symbol Shortcuts

Sitting directly beneath its cheerful cousin in the **Composer** card, and addressed to a rather more scholarly appetite: type a **backslash** followed by a name, and the appropriate character presents itself. `\to` yields →. `\phi` yields φ. `\leq` yields ≤, `\infty` yields ∞, `\dagger` yields †. The vocabulary is the one every mathematician, physicist and long-suffering thesis-writer already carries in their fingers — the LaTeX commands — some three thousand two hundred characters across twenty-six regions of the Unicode catalogue, arrows and operators and box-drawing pieces and Greek and dingbats and all.

You may also describe what you are after in plain words: `\right arrow`, `\greek phi`, `\em dash`. And should you know a character only by its number, `\u2192`, `\u+2192` and `\u{1D538}` will fetch it directly, without consulting any catalogue at all — which means **every** character in Unicode remains within reach, including the great many we did not see fit to list.

**A matter of capitalisation, and it is not a trifle.** `\phi` is φ and `\Phi` is Φ. Likewise `\gamma` and `\Gamma`, `\delta` and `\Delta`, `\sigma` and `\Sigma`, `\omega` and `\Omega`, `\theta` and `\Theta`. The house observes the distinction scrupulously, as any respectable house must; type the capital and you shall have the capital.

Two ways to commit, precisely as with emoji: pick from the menu with Enter or a click, or — knowing the name outright — type it entire and follow it with a **space**. `\to ` becomes `→ `, space and all, the menu never having been troubled. Should the name mean nothing to us, your text is left exactly as you wrote it and the menu withdraws; we do not guess.

**Your mathematics is safe.** Quilltap renders LaTeX, and `$$\phi$$` is a formula, not a request. The backslash therefore holds its peace inside any formula you have opened — `$$…`, `$…`, `\(…`, `\[…` — so a formula being typed is never quietly mangled into a character. A dollar sign followed by a figure is understood to be money and not mathematics, so `costs $5 and \to ` behaves perfectly normally. As with the colon, nothing whatever fires inside code fences or `inline code`.

The backslash and the markdown escape do not collide, and cannot: an escape is a backslash followed by *punctuation* — `\*`, `\_`, `\[` — while a symbol name must begin with a *letter*. The two occupy entirely separate quarters of the house.

There is a **button** in the formatting toolbar as well (the small `Ω`), which opens the same catalogue as a browsable grid arranged by Unicode block, with its own **Recently used** row — kept quite separately from your emoji recents, since a drawer holding both 😄 and ∮ would serve neither. The catalogue is fetched only the first time you want it, and pressing the space bar — the most-pressed key on the board — never summons it.

**Setting Options:**

- **Symbol shortcuts** — A single toggle, on by default. On: the `\` menu appears as described. Off: the backslash does nothing untoward, and remains an honest backslash.

**How to configure:**

1. Open the **Composer** card on the Chat tab in Settings
2. Tick or untick **Symbol shortcuts**
3. The change applies at once; no reload required

**When useful:**

- You write mathematics, linguistics, or anything else that wants → ≤ ∈ ∞ φ Σ ∮ without a trip to a character map
- You want an em dash, a proper ellipsis, a degree sign or a non-breaking space and would rather not memorise an operating-system incantation for each

**When to turn it off:**

- Your prose is thick with backslashes — file paths, regular expressions, LaTeX you intend to keep verbatim — and you would rather the menu never stirred
- As with emoji, the toolbar's `Ω` button is **not** governed by this toggle. The switch restrains the *automatic* backslash; a button pressed on purpose is never a surprise.

### Impersonated Lines in the Character's Own Words

The last tenant of the **Composer** card, and the only one switched off by the factory. When you have taken a character's seat with the **Impersonate** button, your typed line is handed first to that character — their own model, their own prompt, the recent conversation as they would see it, and a fresh Commonplace Book recall against your draft — and returned for your inspection before a syllable reaches the room. Send their restatement, have it attempted afresh, retire to the composer and rewrite it yourself, or send your own words exactly as typed. Nothing posts until you choose.

It fires only for seats taken with **Impersonate**. Speaking as yourself — or as a seat you have set to *User (you type)* in the participant card's dropdown — is left entirely alone, as are sends carrying only attachments or tool results, and lines beginning with a Carina address (`@Name:`), which are machinery and must survive verbatim.

**Setting Options:**

- **Impersonated lines in the character's own words** — A single toggle, off by default. On: an impersonated line opens a review panel first. Off: impersonated lines post exactly as typed, as they always have.

**How to configure:**

1. Open the **Composer** card on the Chat tab in Settings
2. Tick or untick the box
3. The change applies at once to open chats; no reload required

**When useful:**

- You know what your character means to say but would rather not hear your own cadence in their mouth
- You are playing a character whose diction is a long way from your own — archaic, terse, foreign, drunk
- You want the scene's narration conventions applied to your line without minding the asterisks yourself

**When to turn it off:**

- You are a careful stylist and the rehearsal is an extra step between you and the room
- The model reliably mangles a notation you depend on (the per-send **Send as written** door covers the occasional case)

The full account — what the character is told, what they are not, and the honest caveat that the line is model-written and worth reading — is at [In their own words](/settings?tab=chat&section=composer-spellcheck).

## Auto-Scroll

A question of etiquette: when a character at last lays down the pen at the close of a long reply, should the page hurry you down to the final flourish, or leave you precisely where you were reading? This toggle decides.

Left unchecked — and the factory leaves it so — the Salon is a patient host. As a reply streams in and a new message takes its place in the conversation, the page holds its station; a windy three-page soliloquy can no longer spirit your place off the bottom of the screen mid-sentence. Whenever you have wandered up the page to revisit earlier remarks, a discreet **jump to latest** button presents itself in the lower corner, ready to whisk you back down at a single tap.

Switch it on, and the Salon resumes the eager old manners: each time a reply concludes (or a fresh message arrives), it glides to the newest line — but only when you were already loitering near the bottom. Should you have scrolled up to read, it has the courtesy to stay put regardless.

Two courtesies are constant in either mode: dispatching a message of your own settles you at the foot of the conversation, and first opening a chat deposits you at its end.

**Setting Options:**

- **Chase each reply to its end** — A single toggle. On: the Salon scrolls to the newest message when a reply completes, provided you were near the bottom. Off (default): the page stays where you left it, and a *jump to latest* button appears when you're scrolled up.

**How to configure:**

1. Open the **Auto-Scroll** card on the Chat tab in Settings
2. Tick or untick the box
3. The change applies at once to open chats; no reload required

**When useful:**

- You read replies as they stream and resent being yanked to the bottom the instant they finished — leave it off
- You prefer the conversation to always present its freshest line without lifting a finger — switch it on

## Text Replacement

A scribe's tireless apprentice for the rich-text surfaces: when you type a registered trigger word and then strike a word-boundary character (a space, a comma, a full stop, what have you), Quilltap quietly swaps the trigger for its appointed replacement. `teh` becomes `the`; `Aris` blossoms into `Aristarchus the Wise`; `omw` rises into `on my way`. The transformation is wrought as a single editorial gesture, so one tap of Cmd/Ctrl+Z restores the literal letters you typed (a second tap then walks back the typing itself, in the customary manner).

Replacements fire only on **typed** input — pasted prose passes through unmolested, the better to preserve what you have copied from elsewhere. Triggers are matched as whole words against the *end* of a text node, so mid-word edits are politely declined. Source-mode surfaces (the raw Markdown view, the plain-text view) are left untouched, lest a perfectly good `#heading` find itself rewritten en route.

The feature is, at present, deliberately modest: literal triggers, literal replacements, no regex, no multi-line snippets, no cursor-positioning conjuring tricks. The aim is the cross-platform substitute for OS autocorrect that the browser otherwise withholds — and to do that one task well before reaching for more.

**Setting Options:**

- **Master toggle** — *Text replacement (autocorrect)*. On: rules fire. Off: rules sit quietly while preserving the list, so you may A/B the feature without losing your work.
- **Add a rule** — A small form for the trigger, the replacement, and a per-rule **Case-sensitive** flag. When case-sensitive, only the exact casing matches (`URL` is honoured; `url` is not). When case-insensitive (the default), any casing matches and the replacement is written verbatim.
- **Rules** — The full ledger of registered replacements. Each row may be edited in place (changes save on blur or Enter), temporarily disabled with the **On** checkbox, or struck out entirely with **Delete**.
- **Try it** — A scratch textarea at the bottom of the card. Type a trigger plus a space to confirm a rule fires as intended. Nothing typed here is saved.

**How to configure:**

1. Open the **Text Replacement** card on the Chat tab in Settings
2. Tick the master toggle on (it is on by default)
3. Add rules one at a time, or edit the rows already present
4. Test in the **Try it** box, or stroll over to the Salon composer or Document Mode

**When useful:**

- Frequent typographic stumbles you'd like silently corrected (`teh → the`, `recieve → receive`)
- Long invented names you'd prefer to invoke by a short pet form (`Aris → Aristarchus the Wise`)
- Shorthand for stock phrases you write daily (`omw → on my way`, `eta → estimated time of arrival`)

**When to turn it off:**

- You're drafting in a context where literal triggers must remain literal (technical notes, code comments inside prose)
- A particular replacement is firing where you didn't intend it — switch its **On** checkbox off, or refine the trigger
- You'd like to compare a session with and without the feature engaged — that's exactly what the master toggle is for

**Notes for the careful:**

- Newline (Enter) is **not** a word-boundary trigger in this version. Type a space before pressing Enter if you want a replacement to fire on the last word of your message.
- A rule's order in the list is presentational, not load-bearing: case-sensitive rules always win over case-insensitive rules with the same trigger.
- You cannot register two case-insensitive rules with the same trigger (the system politely declines with a conflict notice). Two rules with the same trigger but different case-sensitivity flags are perfectly legal.

## Smart Typography

The Text Replacement card's near neighbour, and its temperamental opposite in one important respect. Here reside the small civilities of the compositor's trade — curled quotation marks, the en dash, the em dash, the ellipsis — arranged in **two groups**, and the difference between those groups is not a filing convenience but the whole substance of the thing.

**The first group changes only what you see.** Tick *Curly quotes when displaying messages* and the conversation acquires proper “curly quotes” where before it wore the typewriter's flat little strokes. What is *stored*, however, and what is dispatched to the model, remains character for character what you typed. Not one byte of your correspondence is altered. Untick the box and the whole of your history reverts on the instant, as though the matter had never been raised. This is a question of dress, not of substance, and the house treats it accordingly.

Code is never touched — neither fenced blocks nor `inline code`. Mathematics is never touched. The address inside a link is never touched. And should your roleplay template have claimed the quotation mark for its own purposes as a delimiter, the curling stands aside in that chat entirely, rather than trampling arrangements you made deliberately.

One acknowledged imperfection, and we would rather name it than have you discover it: a word opening with an apostrophe — `'tis`, `'80s`, `'n'` — will be given an opening quotation mark instead. Every typesetter's engine ever built makes this same mistake, the poor thing having no way to distinguish an elision from a quotation. Because nothing is written down, the blemish is cosmetic only: your text still says `'tis`, and one flick of the toggle sets the appearance right again.

**The second group changes your text.** Type two hyphens and you get an en dash (`–`); a third promotes it to an em dash (`—`); three full stops become a proper ellipsis (`…`). These are **real characters, written into what you have composed**, and they are meant to be: a writer who types `--` wants a dash, the hyphen being merely the keyboard's apology for a key it does not possess. A fourth hyphen leaves matters exactly as they are, which doubles as your escape hatch. One tap of **Backspace** immediately after any substitution restores the literal characters; one tap of Cmd/Ctrl+Z does the same.

**Why dashes are not offered in the first group, and never will be.** Consider `run it with --verbose`. A display-time dash rule would render that as `–verbose` — the source correct, the screen wrong, and the writer with no earthly way to discover why. At the keystroke there is no such trouble: you see the dash arrive and press Backspace once. The arrangement is deliberate and permanent.

Nothing in the second group fires inside code fences or `inline code`, nor in the source-mode views, nor upon pasted text, nor while an input method editor is mid-composition.

**Setting Options:**

- **Curly quotes when displaying messages** — Off by default. On: the conversation displays curly quotes. Your stored text and the model's input are unaffected either way.
- **Dashes (`--` → `–`, `---` → `—`)** — On by default. Applies in the Salon composer and the Document Mode rich editor.
- **Ellipsis (`...` → `…`)** — On by default. Same two surfaces.
- **Try it** — A scratch textarea for the second group. Type a couple of hyphens or three full stops and watch. Nothing typed here is saved.

**How to configure:**

1. Open the **Smart Typography** card on the Chat tab in Settings
2. Tick or untick each toggle as suits you
3. The quote setting applies to every message at once — the Salon, the help chat, thinking blocks, the Brahma console alike
4. The dash and ellipsis settings apply to the next thing you type

**When useful:**

- You want your prose to *look* properly typeset without your archives being quietly rewritten to suit the fashion
- You write long-form fiction, in which the em dash is not a luxury but a load-bearing member
- You are on a platform whose operating system declines to supply these substitutions on your behalf

**When to turn it off:**

- **Curly quotes:** you are writing about code, measurements in inches, or anything where the straight mark is the correct mark on screen as well as on disk
- **Dashes:** you routinely write command-line flags in plain prose and would rather they never be disturbed — though note the ladder gives you a fourth hyphen as an escape, and Backspace as another
- **Ellipsis:** you have a use for exactly three separate full stops

**Notes for the careful:**

- Turning the quote setting on or off does not alter a single stored message, does not disturb any model's input, does not shift a prompt cache, and does not change what an export contains. It is the one setting in this house that can be flipped with no consequence whatever beyond the visible.
- Exports and backups always carry the straight quotes you actually typed.
- Dashes and ellipsis, by contrast, *do* become part of the message and travel with it everywhere.
- Neither group has any bearing on your characters' documents. Curly punctuation does find its way into files all the same — your characters write like authors and Quilltap records them faithfully — and the [document editing tools](document-editing-tools.md) now read past a difference of punctuation when hunting for a passage to amend, so an edit is never refused over the shape of an apostrophe.

## In-Chat Navigation

Characters with help tools enabled can navigate directly to this page:

`help_navigate(url: "/settings?tab=chat&section=composer-spellcheck")`

## Related Settings

- [Chat Settings](chat-settings.md) — The rest of the chat-wide defaults
- [The Staff Behind the Scenes](chat-settings-ai-services.md) — The settings that engage a model or keep the books
- [Taboo](taboo.md) — Phrases no character may utter (which is not the same thing as correcting your own typing)
- [Appearance Settings](appearance-settings.md) — How the Salon looks, as opposed to how it behaves
