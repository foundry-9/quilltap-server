# Theme probe

The computed-style half of Calliope Live Spec C's proof (the other halves are
the resolved-variable snapshot, `scripts/theme-snapshot.ts`, and screenshots).
The snapshot sees only custom properties on `<html>`; the probe records what
rules do to elements.

- `probe.js` — the page-side function. Plain JavaScript, no dependencies.
  Injected into a page it defines `window.__qtThemeProbe({ hooks })`, which
  measures `html`, `body`, the first visible element of every catalogued hook
  (and of each variant value and state), and bare `h1`–`h3`, including
  `::before`, `::after` and `::selection`. It records how many visible
  elements each selector matched, so an element missing from a page reads as
  a count change, never as "unchanged".
- `run.ts` — the driver. Runs the probe over seven pages (home, two Salon
  chats, a character, Settings with a card open, the Appearance card's theme
  preview dialog, the Appearance card) for every theme in light and dark,
  writing `<theme>.<mode>.<page>.json` and a 1440×900 screenshot of each.
  Its `compare` command diffs two result directories.

## Running it

Playwright is not a dependency of this repo. Install `playwright-core`
somewhere outside it and point `PLAYWRIGHT_CORE` at that directory (it needs a
Chromium that version can launch, e.g. from `npx playwright install chromium`):

```bash
mkdir -p ~/tmp/probe-driver && cd ~/tmp/probe-driver && npm init -y && npm install playwright-core
```

Start a **scratch** instance's dev server (the driver changes the theme
preference through the API, putting the original back when it finishes):

```bash
QUILLTAP_DATA_DIR=~/iCloud/Quilltap/V4test PORT=3005 npm run dev
```

Then, from the repo root:

```bash
PLAYWRIGHT_CORE=~/tmp/probe-driver npx tsx scripts/theme-probe/run.ts run --base http://localhost:3005 --chat <chatId>,<chatId> --character <characterId> --out .theme-probe/<label>
```

```bash
npx tsx scripts/theme-probe/run.ts compare .theme-probe/<before> .theme-probe/<after>
```

`--themes a,b` and `--modes light` narrow a run or a comparison;
`--no-screens` skips screenshots. Results go under `.theme-probe/`, which is
git-ignored.

Choose chats whose last screenful between them shows user, assistant, Staff,
whisper and tool-call rows (the Salon renders only the rows near the end).
For Spec C on V4test: chats `4be1471d-7f04-4661-bd68-4083a90cc8e1` and
`35403e38-10f7-419d-b1da-dfb1eb848e8a`, character
`026d6d31-dcc0-4e9c-abe1-b78a02cc4998`.
