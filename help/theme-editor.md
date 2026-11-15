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

Each draft lives as an ordinary folder in your **Quilltap General** document store, under `Themes/<its id>/`, holding exactly the files a `.qtap-theme` bundle would. You may open those files in the Scriptorium or Document Mode and edit them by hand, and a character with document tools may do the same — the Atelier reads them afresh. Should a hand edit leave a file that will not read, the draft still appears in the list, with a note saying which file wants mending.

Drafts are kept in your backups, but they do not travel in a `.qtap` export; to share a finished theme, install it and export it from the Appearance card as a `.qtap-theme` bundle.

To be rid of a draft, use the bin beside it in the list. The Atelier asks first, because a deleted draft is gone; a theme you already installed from it stays installed.

## Editing a draft

Open a draft and the Atelier lays out its colour tokens, group by group. Above them sit the draft's **Primitives** — the foundational colours a theme may declare in its files for other tokens to refer to. The Atelier shows them for reference (a blank canvas defines none); they are edited in the files themselves.

- **Name and Description** sit at the top. They are what the theme will be called on the Appearance card.
- **Light and Dark** switch which mode is on show while you work, so you see what you are changing.
- **Each row** is one token, with a colour picker and a text field for light and another pair for dark. Pick a colour, or type one in any form CSS understands. **Reset** drops the draft's own value for that token in both modes, and the house default is in force again.
- **Contrast.** A token that colours text, or a focus ring, is measured against the background it sits on. Each row shows its pairs with their ratio — at least 4.5 to 1 for text, 3 to 1 for a focus ring — and says plainly when one falls short. A pair the Atelier cannot measure (a gradient, say, or an image) is marked **Unchecked** rather than waved through. Falling short never stops you saving or installing; it is a warning, offered in the interest of everyone's eyesight.

Every change is saved as you go; the Atelier says **All changes saved** when it has caught up. Beneath the header it keeps count of the draft's errors and warnings from the last save, and of the contrast pairs that fall short in the mode on show.

If the same draft is open in two tabs and you edit it in both, the second save notices that the draft has moved on beneath it, fetches the newer version and tells you so — nothing is silently overwritten.

## The live preview

While a draft is open, **the whole of Quilltap wears it** — sidebar, Salon, settings, everything — so you judge your colours where they will actually live. The Atelier's own editing panel keeps the house default throughout, so that a truly regrettable experiment never leaves you unable to read the controls that would undo it.

Press **Stop preview** to put the usual theme back on while you think; **Resume preview** to try the draft on again. Go back to the list, open another draft or close the tab, and the preview comes off by itself — with anything unsaved saved first. The preview is confined to the window you are working in and changes nothing about which theme you have chosen.

## Installing

When the draft pleases you, press **Install**. The Atelier packs it into a proper bundle and installs it exactly as though you had uploaded a `.qtap-theme` file, with every check that implies — so an install that succeeds is one that will load. Quilltap puts it on at once (*Worn with pride.*).

A few things happen on the way:

- **Pictures are tailored for travel.** PNG, JPEG and GIF images become WebP in the installed copy; animated pictures and SVG are left as they are. The draft keeps your originals, so nothing is lost by installing.
- **The draft's version moves on.** After each install the draft's version number goes up by one patch, so the installed theme and the draft carrying on in the Atelier never get muddled.
- **Installing again replaces the earlier install** of the same theme. A draft may not take the name of a theme that ships with Quilltap.

If the draft has errors, **Install** waits until they are mended and lists them; if the install itself is refused, the Atelier shows why.

## What the Atelier does not yet do

Colours are the first room to be furnished. Fonts, sizes and spacing, icons and custom CSS are edited in the draft's files for now — see [Themes](themes.md) for the bundle format — and the Atelier will learn them in time.

## In-Chat Navigation

Characters with help tools enabled can navigate directly to this page:

`help_navigate(url: "/calliope")`

## Related Help

- [Themes](themes.md) — themes, bundles and color modes
- [Appearance Settings](appearance-settings.md) — choosing the theme you wear
- [The Scriptorium](scriptorium.md) — where Quilltap General and its `Themes/` folder live
