# Theme probe

The computed-style half of Calliope Live Spec C's proof (the other halves are
the resolved-variable snapshot, `scripts/theme-snapshot.ts`, and screenshots).
The snapshot sees only custom properties on `<html>`; the probe records what
rules do to elements.

- `probe.js` — the page-side function. Plain JavaScript, no dependencies.
  Injected into a page it defines `window.__qtThemeProbe(options)`, which
  records computed styles, including `::before`, `::after` and `::selection`.
  It has two modes:
  - **gallery** (`{ gallery }`), for Calliope's specimen gallery
    (`/calliope/specimens`). The gallery draws every catalogued hook in every
    variant value and state, each on a stage addressable as
    `[data-specimen-for="<class>"] [data-specimen-instance="<key>"]
    [data-specimen-stage]`. The probe makes every article visible (they are
    `content-visibility: auto`), reads each instance there and measures the
    element matching its selector. Anything it cannot find is listed in
    `missing`, which should always be empty.
  - **live page** (`{ hooks }`): `html`, `body`, the first visible element of
    every catalogued hook (and of each variant value and state) and bare
    `h1`–`h3`. It records how many visible elements each selector matched,
    so an element missing from a page reads as a count change, never as
    "unchanged".
- `run.ts` — the driver. For every theme in light and dark it probes four
  pages: the **gallery**, for how every hook looks, and three live pages for
  what a stage cannot show — **home** (the shell's layout), a **Salon** chat,
  and **dialog** (the Appearance card's theme preview dialog open). A stage
  contains layout and paint and caps its height, so position and viewport
  measurements still need a live page. It writes
  `<theme>.<mode>.<page>.json` and a 1440×900 screenshot of each. Its
  `compare` command diffs two result directories; in a gallery file an
  instance present on one side and not the other is reported as `MISSING`.

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
PLAYWRIGHT_CORE=~/tmp/probe-driver npx tsx scripts/theme-probe/run.ts run --base http://localhost:3005 --chat <chatId> --out .theme-probe/<label>
```

```bash
npx tsx scripts/theme-probe/run.ts compare .theme-probe/<before> .theme-probe/<after>
```

`--themes a,b` and `--modes light` narrow a run or a comparison;
`--no-screens` skips screenshots. Results go under `.theme-probe/`, which is
git-ignored.

The gallery covers every kind of message row, so the Salon page is there for
the chat's layout and any chat will do. On V4test:
`4be1471d-7f04-4661-bd68-4083a90cc8e1`.

A run made before Spec I (seven live pages, `--chat a,b --character <id>`)
has no gallery files and different page names; compare it with a new run
only page by page, and expect `MISSING` for the pages that were dropped.
