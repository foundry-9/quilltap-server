# Release Checklist 13 — UI, Look-and-Feel & WCAG Compliance

If you have not already done so, read [CLAUDE.md](../../CLAUDE.md) for how to work in this repository.

**Goal (checklist item 13 of 14):** Take a fresh look at the whole UI — not just this cycle's diff — under every bundled theme in every mode it supports, and make sure it looks deliberate and meets **WCAG 2.2 Level AA**. Item 7 checks that components *use* `qt-*` classes; this item checks what those classes, and the themes behind them, actually *render*.

## Scope

- **Themes:** the default theme plus every bundle in `themes/bundled/` (Art Deco, Earl Grey, Great Estate, Madman's Box, Old School, Rains), each in light **and** dark where `theme.json` has `"supportsDarkMode": true`. A theme with `false` (Madman's Box) still needs a check with the OS set to dark, to confirm it holds its own palette rather than half-switching.
- **Surfaces:** first-run/unlock (`/setup`, `/unlock`), dashboard, the Salon (`/salon/[id]`: composer, message list, whispers, Staff bubbles, Concierge danger styling, Terminal Mode pane, Document Mode), `/salon/new`, Aurora (`/aurora` list + character editor + wardrobe/inventory dialogs), Prospero, the Scriptorium, Pascal's Workbench (`/custom-tools`), Brahma's Console, `/workspace` (split panes, sticky toolbar), every `/settings?tab=…` tab, the help dialog, toasts, and `/about`.
- **This cycle first:** start with what changed since the last tag, then sweep the rest:
  ```bash
  LAST_TAG=$(git describe --tags --abbrev=0 --match '[0-9]*.[0-9]*.[0-9]*' 2>/dev/null)
  git diff --name-only "${LAST_TAG}"..HEAD -- 'app/**/*.tsx' 'components/**/*.tsx' 'app/styles/**' 'themes/bundled/**' | grep -vE '__tests__|\.test\.|\.stories\.' | sort -u
  ```

## Steps

1. **Static token contrast (every theme × mode).** Write a throwaway Node script in your scratchpad (not the repo) that reads each `themes/bundled/*/tokens.json` (plus the default theme's `--color-*` values in `app/globals.css`), converts the HSL values, and computes WCAG contrast ratios for:
   - every `X` / `XForeground` pair (`primary`, `secondary`, `muted`, `accent`, `destructive`, `card`, `popover`, `success`, `warning`, `info`, `chatUser`, …) — **≥ 4.5:1** (SC 1.4.3);
   - `foreground` and `mutedForeground` on `background`, `card`, `muted` and `popover` — `mutedForeground` is the usual offender;
   - `border` / `input` against `background` and `card`, and `ring` against everything a focused control can sit on — **≥ 3:1** (SC 1.4.11, 2.4.7);
   - status colours used as text (`destructive`, `success`, `warning`, `info` on `background`).

   A theme's `styles.css` can override tokens or hard-code colours (dialogue text, textures, sidebars) — grep it for literal colours and check those too. Tabulate results per theme/mode; anything under threshold is a finding.
2. **Live pass in the browser.** Use the V4test instance (`preview_start` with `quilltap-v4test`, port 3005) — never Friday, and never kill the user's own dev server. Switch themes via the Appearance tab or the theme quick switcher; toggle light/dark with `resize_window`'s `colorScheme`. For each theme × mode, visit the surfaces above and:
   - screenshot the Salon, an Aurora character page, a settings tab and the workspace, and look at them as a designer would: misaligned spacing, clipped or overflowing text, illegible text over textures/backgrounds, unstyled (browser-default) controls, icons that vanished or lost contrast (the themeable `<Icon>` system draws with CSS masks — check every icon is visible), inconsistent radii/shadows, a theme's fonts failing to load;
   - spot-check rendered contrast with `javascript_tool` (`getComputedStyle` on text and its effective background) where textures, gradients, opacity or theme CSS make the token table unreliable.
3. **Keyboard and focus (theme-independent, check once, then confirm focus rings in each theme).**
   - Every interactive element is reachable and operable by keyboard (SC 2.1.1); modals, popovers, the Lexical composer and the terminal pane don't trap focus without an escape (2.1.2); tab order follows the visual order (2.4.3).
   - A visible focus indicator on everything focusable, in every theme (2.4.7), and not hidden under the workspace's sticky toolbar or other sticky chrome (2.4.11).
   - Dialogs move focus in on open and return it on close; `Esc` closes them.
4. **Semantics and assistive tech.** Grep and inspect (`read_page` gives the accessibility tree):
   - icon-only buttons and links have an accessible name (`aria-label`/`title`/visually-hidden text) — SC 4.1.2; names should say plainly what the control does (a little period flavour is fine; obscurity is not);
   - `<img>` has meaningful `alt` (or `alt=""` when decorative) — SC 1.1.1. Don't swap `<img>` for `<Image>` (deliberate, per CLAUDE.md);
   - form fields have associated labels and errors are announced (1.3.1, 3.3.1, 3.3.2);
   - one `h1` per page, sane heading order, landmarks (`main`, `nav`) present (1.3.1, 2.4.6);
   - toasts, streaming status and "saved" notices are in an `aria-live` region (4.1.3);
   - nothing is conveyed by colour alone — Concierge Unmoderated/danger styling, whisper vs public, error/success states need an icon, label or text too (1.4.1).
5. **Layout resilience.** At 320 CSS px wide (`resize_window` 320×800) content reflows without two-dimensional scrolling (1.4.10); at 200% text zoom nothing is clipped (1.4.4); pointer targets are at least 24×24 px or adequately spaced (2.5.8).
6. **Motion and modes.** Animations and transitions respect `prefers-reduced-motion` (2.3.3 is AAA, but honour it — the app already does in places; check new animation does too); auto-moving content (story backgrounds, spinners that never stop) can be paused or is brief (2.2.2). Note behaviour under `forced-colors: active` (Windows High Contrast) — mask-based icons and custom-drawn controls tend to disappear there; flag rather than fix unless trivial.
7. **Fix what you can, in the right layer.**
   - A token that fails contrast → fix it in that theme's `tokens.json` (both modes as needed), and bump the theme's `version` in its `theme.json`.
   - A rule in `app/styles/qt-components/*` → fix it there **and mirror it into [theme-storybook](../../packages/theme-storybook/src/css/qt-components.css)**, bump that package's patch version, then **stop and ask the human to `npm publish`** (per CLAUDE.md — the publish gates the commit). Consider [create-quilltap-theme](../../packages/create-quilltap-theme)'s template too, so new themes don't inherit the defect.
   - A component problem (missing label, focus trap, colour-only state) → fix the component; new styling goes through a `qt-*` utility, never raw Tailwind. `npm run lint` catches undefined or variant-prefixed `qt-*` classes.
   - Anything large or design-heavy (a palette rework, a new focus-ring treatment across the app) → flag it for the human rather than redesigning a theme on your own.
   - User-visible changes get a `help/*.md` update (likely `help/themes.md` or `help/appearance-settings.md`) and a CHANGELOG entry (plain voice).
8. **Verify:** `npx tsc`, `npm run lint`, and re-screenshot every surface you changed in the affected theme(s) and mode(s). Reset the viewport with `resize_window` preset `desktop` when done.

## Report

1. **Contrast table** — per theme × mode, the failing pairs with their ratio and the required ratio, marked **FIXED** (new value) or **FLAGGED**.
2. **Findings list** — one line each: severity (blocker / serious / minor / polish), WCAG success criterion (or "look-and-feel"), theme/mode if specific, surface, `file:line`, and **FIXED** or **FLAGGED**.
3. **Look-and-feel notes** per theme — a few sentences on how each one reads overall, with screenshots of anything notable (send them with `SendUserFile`).
4. Packages or themes whose versions you bumped, and whether a `theme-storybook` publish is waiting on the human.

Do not commit.
