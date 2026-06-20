# Madman's Box

> *Bigger on the inside, and dressed for the occasion.*

A Quilltap theme: a mad inventor's time-machine cabin in dark walnut and brass.
Bakelite knobs, vacuum tubes aglow with amber, and a Jacob's ladder crackling
phosphor-cyan between two posts. The room is warm and lamplit; the screens and
the energy run cool.

**Dark by decree.** This theme sets `supportsDarkMode: false` and ships the same
warm walnut palette in both color slots, so the doors only ever open onto the
lamplit dusk of the cabin — no light mode, regardless of the host's toggle.

## Palette

- **Walnut** (`hsl(28–32)`) — the cabin walls, panelling, and surfaces
- **Brass** (`hsl(40)`) — fittings, trim, roundels, primary actions, card edges
- **Tube amber** (`hsl(33)`) — Nixie / vacuum-tube glow; highlights and accents
- **Phosphor cyan** (`hsl(184)`) — screens & energy: links, focus rings, active state
- **Banker's-lamp green** (`hsl(140)`) — success / enabled states

## Type

- **Raleway** — geometric Deco-era sans for signage, headings, and UI
- **Mulish** — rounded sans with real drawn italics, for user messages
- **Lora** — readable text serif for assistant prose (comfortable at message size)
- **Fira Code** — the console readout (mono / OOC / terminal)

## Icons

A handful of the app's icons are swapped for hand-cut Deco glyphs via the
`icons` map in `theme.json`: a brass quill for the brand mark (drawn in full
color), and theme-tinted line variants for **settings** (a cog), **themes** (a
brush), **wardrobe** (an armoire), and **help** (an octagon mark). The rest of
the icons fall back to Quilltap's built-in set.

## Structure

```
madmans-box/
├── theme.json      # Manifest + font + icon declarations
├── tokens.json     # Colors, typography, spacing, effects
├── styles.css      # qt-* overrides + decorative treatments
├── fonts/          # Self-hosted woff2 files
├── icons/          # Deco icon overrides (svg)
└── README.md       # This file
```

## Installing

```bash
# Pack as .qtap-theme
cd madmans-box && zip -r ../madmans-box.qtap-theme .

# Validate, then install
quilltap themes validate ../madmans-box.qtap-theme
quilltap themes install ../madmans-box.qtap-theme
```

Or upload the `.qtap-theme` file in **Settings → Appearance → Install Theme**.
