---
url: /calliope
---

# Calliope's Atelier — the Theme Editor

> **[Open the Atelier](/calliope)**

There comes a moment in every household when the wallpaper, however splendid, is simply not *quite* the shade one had in mind. Until now the remedy was a text editor, a zip archive and a certain fortitude. **Calliope's Atelier** is the civilised alternative: a workroom where you cut a theme of your own, watch the whole of Quilltap put it on while you work, and hang it in the wardrobe when it is ready to be worn in public.

Find it by pressing **Design a theme** on the Theme card in **Settings → Appearance**, or by asking a help-enabled character to take you there. It opens as a tab in the workspace, like any other room of the house.

## Drafts

A theme in the Atelier is a **draft** — a work in progress, kept quite apart from the themes you have installed. Nothing you do to a draft touches a theme you are wearing until you choose to install it.

The Atelier opens on the list of your drafts. Press **New theme** to commission one: give it a name, and say where to begin —

- **A blank canvas (the house default)** — every token at Quilltap's own setting, waiting for your hand;
- **A copy of** any theme in your wardrobe — the bundled themes included — so you may begin from a design you admire and make it your own. The copy is yours outright; it keeps no tie to the original, and the original is never altered.

Or press **Open a theme file** and choose a `.qtap-theme` bundle — one a friend sent, or one you exported from the Appearance card — to make a new draft of it. The file goes through every check an install would, so a bundle that would not install is turned away with its reasons, and a theme made for an earlier Quilltap is refused outright. The draft keeps the bundle's name and version. Should its id already be taken (as it will be if you open a theme you have installed), the draft is given the next free one — `rains-2`, say — and the Atelier tells you so; nothing you already have is ever replaced.

Each draft lives as an ordinary folder in your **Quilltap General** document store, under `Themes/<its id>/`, holding exactly the files a `.qtap-theme` bundle would. You may open those files in the Scriptorium or Document Mode and edit them by hand — `tokens.json` and `theme.json` arrive in Document Mode with their syntax coloured — and a character with document tools may do the same; the Atelier reads them afresh. The stylesheet is the exception: Quilltap General keeps it as a stored file rather than a written page, so Document Mode shows it for reading only, and it is written in the **Custom CSS** section. Should a hand edit leave a file that will not read, the draft still appears in the list, with a note saying which file wants mending.

Drafts are kept in your backups, but they do not travel in a `.qtap` export; to share a finished theme, install it and export it from the Appearance card as a `.qtap-theme` bundle.

To be rid of a draft, use the bin beside it in the list. The Atelier asks first, because a deleted draft is gone; a theme you already installed from it stays installed.

## Editing a draft

Open a draft and the Atelier lays out every token a theme may set — some six hundred and sixty of them — arranged as Quilltap's registry arranges them, group by group.

- **Name and Description** sit at the top. They are what the theme will be called on the Appearance card. The theme's other particulars — author, licence, tags, dark mode — are under **Subsystems and details**.
- **Light and Dark** switch which mode is on show while you work, so you see what you are changing.

### Finding your way

Six hundred tokens is a great many to wade through, so the Atelier keeps them in three tiers:

- **Essentials** — the theme's broad strokes: its colours, fonts, radii and the like, which the rest of the house takes its lead from. This is where the Atelier opens, and for most themes it is all one needs.
- **Components** — one component at a time: a card's padding, a bubble's background, a scrollbar's thumb. Use these when one surface ought to differ from the rest.
- **Advanced** — the rarely set, tucked behind a disclosure at the foot of each component section.

Beside the rows is the list of **sections**; choose one and the Atelier takes you to it, and each says how many of its tokens your theme has changed. **Open all** and **Close all** do as they say.

The **search** box finds a token at any tier by its label, its name or its description, opening whatever section or disclosure it was hiding in. Tick **Changed only** to see nothing but what this theme sets — tokens and primitives alike.

### Each token

Every row is one token. It says what the token is, its name, and **where its value comes from**: the house default, a choice (such as density), this theme, or — for one of the ten optional tokens — left unset, so each place keeps its own manner. When a value **follows** a primitive or another token, the row says which, and shows what it comes to.

The value is edited with a control that suits its kind:

| Kind | The control |
|---|---|
| Colour | a picker and a text field, with a swatch |
| Length, radius | a number and a unit; keywords such as `auto` where they are allowed. A radius may have **each corner its own** |
| Shadow | a list of layers, each with its offsets, blur, spread, colour and an **Inset** box; add, remove and reorder them, or choose **No shadow** |
| Font family | an ordered list of fonts — the draft's own fonts and a few well-mannered system stacks — with a sample line set in the result |
| Font weight | a list of the weights; those the theme's font actually carries are marked |
| Font style, and the keyword tokens | a choice of the words allowed |
| Duration | a number in milliseconds or seconds |
| Transition | a list of property, duration, easing and delay |
| Opacity | a number from 0 to 1, or a percentage, with a slider beside it |
| Blur | an amount, or **No blur** |
| Image | **None**, or one of the images already in the draft, with a thumbnail |
| Layer (z-index) | a whole number, or **Auto** |

Every control has an **edit as text** button, which turns it into a plain field where you may write any CSS the token accepts. A value the controls cannot represent — a gradient, an image written into the file itself, a `calc()` — opens as text with a note saying so, and the Atelier leaves it precisely as written until you change it.

A value that follows a primitive opens its controls on what the primitive comes to. Change it and the token takes a value of its own; to follow the primitive again, choose it under **Follows**. **Follows** points any token at a primitive of its own kind, or back to a value of its own.

**Dark apart** gives a token a dark value of its own, for any kind of token; **Same as light** joins it again. **Reset** drops the theme's value in both modes and puts the house default back in force. If the value in force does not suit the token's kind, the row says so — in the very words the server would use on saving.

**Contrast.** A token that colours text, or a focus ring, is measured against the background it sits on. Each row shows its pairs with their ratio — at least 4.5 to 1 for text, 3 to 1 for a focus ring — and says plainly when one falls short. A pair the Atelier cannot measure (a gradient, say, or an image) is marked **Unchecked** rather than waved through. Falling short never stops you saving or installing; it is a warning, offered in the interest of everyone's eyesight.

### Choices

At the head of the tokens sits **Choices**, where the theme's broad switches live. **Density** is the one so far: *compact* (the house manner) or *comfortable* (what every bundled theme wears), which gives padding, avatars, controls, the sidebar and the header more room to breathe, some two dozen tokens at once. Change it and the house repaints directly; the rows it governs say so.

### Primitives

**Primitives** are the theme's own named values — its palette, its radii, its favourite shadow — which tokens may follow, so that one change ripples through every token that follows it. The Primitives panel lets you:

- **Add a primitive** — a name in lower case with hyphens (`brass-ink`, say), a kind, and a starting value;
- edit its value, and give it a dark value with **Dark apart**;
- **rename** it, which rewrites every reference to it throughout the theme;
- change its kind;
- see what **follows** it;
- **Remove** it. If anything follows it, the Atelier first lists every value that will take the primitive's value in its place — so the theme looks just as it did, only with one fewer name — and asks you to confirm.

### Undo

**Undo** and **Redo** step back and forth through your changes since the draft was opened, as do **Ctrl+Z** and **Ctrl+Shift+Z** (⌘ on a Mac) while you are not in the middle of a text field, which keeps its own. A run of quick changes to one value undoes as one. Undo is a new save, not a rewinding of the server; the history is forgotten when you leave the draft or reload.

### Saving

Every change is saved as you go; the Atelier says **All changes saved** when it has caught up. Beneath the header it keeps count of the draft's errors and warnings from the last save, and of the contrast pairs that fall short in the mode on show.

If the same draft is open in two tabs and you edit it in both, the second save notices that the draft has moved on beneath it, fetches the newer version and tells you so — nothing is silently overwritten. The same holds when the draft's files are changed elsewhere, in Document Mode or by a character with a pen, while you add a font or a picture.

## Fonts, pictures, icons and the theme's particulars

Below the tokens, in the same list of sections, sit six more: **Fonts**, **Images**, **Icons**, **Custom CSS**, **Subsystems and details** and **Files**. They change the files the draft carries rather than its tokens, and each change is saved the moment it is made.

### Fonts

Press **Add font** and choose one file or several — WOFF2, WOFF, TrueType or OpenType; a family's weights are best added together. The Atelier reads each file and fills in its family, weight and style from what the font says of itself, marking anything it had to guess; correct whatever is amiss. Then name the **licence** the fonts come under — the font's own tables often say, and the Atelier offers what they say — and, if you have it, attach the licence text (`.txt` or `.md`) to keep beside them.

- Fonts are listed by family, each face with its weight, style, licence and file, and a line set in the face itself (the sample needs the live preview on).
- A family no font-family token names yet is marked, with a button to the **Font stacks**: the family appears there under *This theme's fonts*, and the font-weight lists mark the weights it carries.
- A font whose own tables forbid embedding says so. A font marked **Proprietary** carries a note: whoever shares the theme answers for the right to share it.
- **Edit** corrects a face's family, weight, style or licence; **Remove** takes the face away, and its file with it unless something else uses the file.
- TrueType and OpenType files become WOFF2 when the theme is installed (a WOFF, already compressed, travels as it is); the draft keeps the file you gave it.

### Images

**Add images** takes PNG, JPEG, GIF, WebP, AVIF or SVG pictures. Each shows its size and what uses it — a page background token, a subsystem, the preview card — or is marked **Unused**. Choose an image for a token with that token's own image control. **Make it the preview** sets the picture the theme list shows. An image something still uses cannot be removed until it is let go.

### Icons

Every icon in Quilltap, as this theme draws it, with a search by name; those the theme redraws are marked. Choose one to see it at a few sizes and to **upload a replacement**: an **SVG** is drawn in the colour of the text around it, as Quilltap's own icons are, so draw it in one colour on a clear ground; a **WebP** is drawn exactly as it is. **Remove the override** puts Quilltap's own icon back.

### Custom CSS

Tokens dress most of a theme. What they cannot say — a textured panel, a heading with its letters spaced just so, a lamp that flickers — is written as CSS of your own. A draft has no stylesheet until you press **Begin a stylesheet**.

The stylesheet is edited as highlighted text. **Tab** indents and **Shift+Tab** outdents; **Enter** after an opening brace obligingly indents the line that follows, and a closing brace typed upon a line of mere indentation steps back out of its own accord. To leave the editor by keyboard, press **Escape** and then **Tab**. Your writing is saved after a short pause, and the preview takes it up as each save returns. The rules, stated once above the editor:

- every rule is fitted to this theme alone, automatically;
- keyframe names are made unique, so an animation never collides with the house's own;
- `@import` and `@font-face` are not admitted — fonts go in the **Fonts** section;
- a `url()` must name one of the draft's images.

A rule that will not read is marked on its line and listed below the editor, where **Line N** takes you to it. While the stylesheet has an error the preview goes on wearing the last stylesheet that worked, and **Install** waits until it is mended.

Beside the editor (or below it, in a narrow pane) the **Reference** lists what you may write against, each entry set down at the caret when chosen:

- **Hooks** — the elements of Quilltap a theme may style, grouped by where they appear, each with its variants and states;
- **Tokens** — every token and the draft's primitives, with the value in force, inserted as `var(--name)`;
- **Images** — the draft's pictures, inserted as `url('images/…')`.

Undo inside the editor undoes your typing there; the editor's **Undo** button above looks after the tokens alone. **Remove the stylesheet** stops the theme wearing it, and throws the file away too unless you untick that.

### Subsystems and details

- **The theme's details** — author (with an optional email and web address), the theme's licence, up to twenty tags, and whether the theme **has a dark mode**. That last is a label, not a lock: unticked, the Appearance settings show the theme in light only, but a reader who prefers the dark still sees it dark, from this theme's dark values where it sets them and the house defaults where it does not. Press **Save the details**.
- **Subsystems** — each of Quilltap's rooms (the Salon, the Foundry, the Lantern and the rest) may be renamed and given a description, a thumbnail for the Foundry and a picture for its own page. A field left empty keeps Quilltap's own; **None** means no picture at all.

### Files

Every file in the draft, its size, and what uses it, with the totals against a bundle's limits. A file marked **Unused** stays in the draft but is left out of the install, and may be removed here. A link opens Quilltap General in the Scriptorium, where the draft's folder lives.

## The live preview

While a draft is open, **the whole of Quilltap wears it** — sidebar, Salon, settings, everything — so you judge your colours where they will actually live. The Atelier's own editing panel keeps the house default throughout, so that a truly regrettable experiment never leaves you unable to read the controls that would undo it.

Press **Stop preview** to put the usual theme back on while you think; **Resume preview** to try the draft on again. Go back to the list, open another draft or close the tab, and the preview comes off by itself — with anything unsaved saved first. The preview is confined to the window you are working in and changes nothing about which theme you have chosen.

## The specimen gallery

The live preview shows you whatever Quilltap happens to have on the table, which is all very well until you wonder how a destructive button, an alert or a dialog will look and none of them is obliging enough to appear. For that there is **Calliope's Specimens**: press **Open the gallery** — at the top of an open draft, or on the list of drafts — and it opens as a tab of its own beside the Atelier, splitting the workspace if need be. You may also reach it at `/calliope/specimens`.

The gallery lays out every element a theme may dress — the app's shell, the workspace and its tabs, the home page, the left rail, the Salon's messages and composer, the character page, dialogs, settings and the shared buttons, badges, alerts and headings — each in every variant and state it can take: a user's bubble and a character's, a whisper, a page-width dialog, the current page in a list of links, and so on. Every specimen carries its label and its class name, so you know what to write in your **Custom CSS**.

- **What it wears.** While the Atelier is previewing a draft, the specimens wear the draft and repaint as you edit; with no draft open, they wear the theme you have on, so the gallery is useful on its own. The gallery's own headings and controls stay in the house default, like the Atelier's panel.
- **Light, dark or both.** **As the window** follows your color mode; **Light** and **Dark** show one or the other whatever the window wears; **Side by side** draws every specimen in both at once.
- **Finding things.** The list of surfaces takes you to each section; the search narrows the gallery by label or class name.
- **Hover and focus** cannot be shown standing still: point at a specimen, or Tab to it, to see them.

The specimens are invented for the purpose — no real character, chat or file is read — and pressing anything in them does nothing at all.

## Inspecting what you see

When you would rather point at a thing than hunt for it, press **Inspect** — at the top of an open draft, or in the gallery's toolbar. Until you press it again, or press Escape, Quilltap stops answering clicks: point at anything and it is outlined and named; click and the inspector opens instead of whatever you clicked doing its usual business.

The inspector tells you which hook the element wears (or, when it wears none, the nearest one above it), every token that colours, borders, rounds or spaces it with the value in force and what that value follows, what changes on hover, focus and press, and any rules of your own Custom CSS that reach it. **Row** takes you to a token's row in the draft; **Write CSS for this** sets an empty rule for the hook in your Custom CSS, beginning a stylesheet if the draft has none; **Show in the gallery** finds its specimen. The inspector keeps to the side away from the draft, and the arrow at its top moves it across. It reads the shape of things, never their words.

Without a mouse: every specimen in the gallery has **Inspect this** and **Show on this page**, and every hook in the Custom CSS reference has **Inspect this**, which says so plainly when nothing on the page is wearing it just now.

## Installing

When the draft pleases you, press **Install**. The Atelier packs it into a proper bundle and installs it exactly as though you had uploaded a `.qtap-theme` file, with every check that implies — so an install that succeeds is one that will load. Quilltap puts it on at once (*Worn with pride.*).

A few things happen on the way:

- **Pictures are tailored for travel.** PNG, JPEG and GIF images become WebP in the installed copy; animated pictures and SVG are left as they are. The draft keeps your originals, so nothing is lost by installing.
- **Fonts are packed tight.** TrueType and OpenType fonts become WOFF2 in the installed copy (WOFF and WOFF2 travel as they are); again the draft keeps the files you gave it.
- **Nothing unused travels.** A file nothing in the theme uses is left out of the install and named in the Atelier's report.
- **The draft's version moves on.** After each install the draft's version number goes up by one patch, so the installed theme and the draft carrying on in the Atelier never get muddled.
- **Installing again replaces the earlier install** of the same theme. A draft may not take the name of a theme that ships with Quilltap.

If the draft has errors, **Install** waits until they are mended and lists them; if the install itself is refused, the Atelier shows why.

## In-Chat Navigation

Characters with help tools enabled can navigate directly to this page:

`help_navigate(url: "/calliope")`

## Related Help

- [Themes](themes.md) — themes, bundles and color modes
- [Appearance Settings](appearance-settings.md) — choosing the theme you wear
- [The Scriptorium](scriptorium.md) — where Quilltap General and its `Themes/` folder live
