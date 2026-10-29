# Release Checklist 14 — Documentation Freshness

If you have not already done so, read [CLAUDE.md](../../CLAUDE.md) for how to work in this repository.

**Goal (checklist item 14 of 14):** Verify these Markdown/doc files are up to date for the release:

- [README](../../README.md)
- [Changelog](../../docs/CHANGELOG.md)
- [API Documentation](../../docs/developer/API.md)
- [Developer Documentation](../../docs/developer/DEVELOPMENT.md)
- [Claude instructions](../../CLAUDE.md)
- [About Page](../../app/about/AboutView.tsx)
- [Release notes for this release](../../docs/releases/) — **MUST EXIST for a production release** and must match the `version` in `package.json` exactly (or the version being released).

## Steps

1. Get the release version and the change surface:
   ```bash
   node -e "console.log(require('./package.json').version)"
   LAST_TAG=$(git describe --tags --abbrev=0 --match '[0-9]*.[0-9]*.[0-9]*' 2>/dev/null)
   git log --oneline "${LAST_TAG}"..HEAD
   ```
2. Walk each file:
   - **README** — features list, version badge, anything user-facing that changed. **This is not a CHANGELOG, this is an indicator of how to use the Github repo, how to install and run the software, and how to develop it, with some attempt to market Quilltap as a potential application for people who want to keep secure roleplayed LLM-based characters and do a variety of real and simulated things with them.** Include direct links to JSON schemas (see below).
   - **CHANGELOG** — every notable change recorded. **Plain American English, no steampunk voice** (CLAUDE.md override). Don't duplicate section headers — append under the existing one.
   - **API.md** — matches the actual `/api/v1/` routes (ties to checklist item 4).
   - **DEVELOPMENT.md** — dev workflow still accurate. Everything necessary to make changes in this repo and propose them. Links to PRs and Issues in Github.
   - **CLAUDE.md** — any new conventions/chokepoints/glossary entries introduced this cycle.
   - **about/AboutView.tsx** (content; `page.tsx` is a wrapper) — version, credits, feature blurbs. Must be kept up-to-date for version numbers and libraries on which we rely.
   - **docs/releases/{version}.md** — exists and matches `package.json` version exactly. For a minor or major release, draft it if missing, or bring an existing draft up to date, with the [release-notes procedure](#drafting-release-notes-minor-or-major-release) below; for a patch release, follow the bugfix format in [tag-for-release](tag-for-release.md).
   - All schemas that are publicly available and accessible, either from the repository or from inside the application, and when you would use them. This includes a schema for `.qtap` files in general, Pascal's custom tools, and so forth.
3. Also confirm the broader doc set from [update-documentation](update-documentation.md) is current — user-visible changes need `help/*.md` updates (with `url` frontmatter + matching `help_navigate(...)`), and the docs listed there stay in sync. Consider running `/update-documentation` if a lot changed.
4. Fix anything stale.

## Drafting release notes (minor or major release)

When `package.json` reads `X.Y.0-dev.N`, check `docs/releases/X.Y.0.md` first.

- **It doesn't exist:** draft it from scratch with the steps below.
- **It already exists:** it's a draft from earlier in the cycle, and it may hold the human's own edits. **Revise it in place; never rewrite or regenerate it.** Find when it was last touched (`git log -1 --format='%h %ad' --date=short -- docs/releases/X.Y.0.md`; if it's uncommitted, ask, or treat the whole cycle as the range). Then gather the change surface below *from that point*, and compare the full cycle against what the notes already say. Add what's missing in the sections where it belongs, and fix claims that later commits made untrue (a feature renamed, reverted or changed). Update `Upgrading`, `Repairs` bug counts and version strings. Keep existing wording, structure and section order unless they are now wrong. Afterward, tell the human what you added, changed and removed, section by section. The release notes are for **users**, so they are written in the **house voice** (steampunk + Roaring 20s + Great Gatsby + Wodehouse + Lemony Snicket) — the opposite of the CHANGELOG, which is plain developer English. Don't copy CHANGELOG bullets across; translate what they mean for someone using Quilltap.

### Gather the change surface

1. Release version: strip `-dev.N` from `package.json` (`4.11.0-dev.106` → `4.11.0`). The previous minor is `X.(Y-1).0`.
2. Commits on main since the previous minor shipped — the `rel/` tag marks the merge of that release back into main:
   ```bash
   git log --no-merges --format='%h %ad %s' --date=short "rel/X.(Y-1).0"..main
   ```
   Read bodies (`git show --stat <sha>`) for anything whose subject is ambiguous.
3. The `### X.Y-dev` section of [docs/CHANGELOG.md](../../docs/CHANGELOG.md) — the most complete account of what changed. Also skim feature specs moved into `docs/developer/features/complete/` this cycle, `help/*.md` changes (`git diff --stat "rel/X.(Y-1).0"..main -- help/`), and bugs closed this cycle (catalogue entries in `docs/developer/bugs/fixed/` plus `gh issue list --state closed --label bug --search "closed:>=<previous release date>"`).
4. Anything in the patch releases `X.(Y-1).1`, `X.(Y-1).2`, … was already announced in their own notes — don't re-announce it as new.
5. Migrations added this cycle (`git diff --name-only "rel/X.(Y-1).0"..main -- migrations/scripts/`) — these feed the **Upgrading** section.

### Read the precedent

Read the previous two minor releases' notes in full (`docs/releases/X.(Y-1).0.md`, `X.(Y-2).0.md`). They set the structure, length and voice; match them rather than inventing a new shape.

### Structure

1. **Frontmatter:**
   ```markdown
   ---
   title: "Quilltap X.Y.0"
   version: "X.Y.0"
   pubDate: YYYY-MM-DD
   description: "<one long paragraph in the house voice summarising the whole release>"
   draft: false
   ---
   ```
2. **Italic prologue** (two short paragraphs): what the previous release made possible and what it still couldn't do; then "*X.Y is the release in which the house …*" — one image that names the theme of the cycle.
3. `---`, then the **overview**: the headline body of work, then "N further bodies of work define the cycle", then "N more earned their places", then anything that leaves or changes in a way worth reading before upgrading (pointing to **Upgrading**). Close with "The thesis is simple: *…*" contrasting this release with the last.
4. **Themed sections** (`##`), each with `###` subsections, grouped by what the user experiences — not by code area or commit order. Section titles are evocative but still say what they are about ("A Clothing System, Not a Closet", "The Concierge, Rebuilt"). Name features by their house names (the Salon, Aurora, the Commonplace Book, the Concierge, the Lantern, Pascal, the Host, …) and bold the first mention of each new feature.
5. **Under the Floorboards** — internal work a user would still notice (speed, disk, reliability, API behaviour), kept short.
6. **Repairs** — a paragraph on how many bugs were filed and closed (catalogue bug numbers and/or GitHub `#N` issues), then a representative handful told as small stories (what you saw, why), not a list of ids. Big fixes get their own subsection above instead.
7. **Upgrading** — one bold lead sentence per item, then plain detail: slow or irreversible migrations, settings that move or are renamed, changed defaults, renamed tools or API actions without aliases, anything the user should check. This section may be plainer than the rest; accuracy beats flourish. End with the Node.js requirement.
8. **Installation** — copy from the previous release's notes and update every version string (Docker tag especially).
9. `---`, then an **italic epilogue** of several short paragraphs revisiting the release's themes as images, ending "*X.(Y-1) made the house …. X.Y …*" and the signature line "*— Ariadne, for the Bureau, <Month D, YYYY>*".

### Voice

- Second person to the reader ("you"); the house, its staff and residents as characters.
- Wit carries information — every flourish must still tell the reader what changed and why they would care. If a sentence would be just as true of any release, cut it.
- Concrete over grand: name the button, the tab, the setting, the command (`quilltap sync`, `?action=…`) where a user would look for it.
- No dev-speak in the prose sections (no "refactor", "chokepoint", "repository", file paths) except under **Under the Floorboards** and **Upgrading**, and even there explain the effect, not the code.
- Never invent a feature, a number or a bug count — every claim must trace to a commit, the CHANGELOG or a spec. If something's status is unclear (reverted, behind a flag, unfinished), ask rather than announce it.
- Spell it "Quilltap" — quill + tap, never quilt + tap.

### Deliver

Write the draft to `docs/releases/X.Y.0.md`, or edit it there if it already exists. Set `pubDate` and the signature date to the expected release date (ask if unknown), and tell the human it's a draft for their review. Don't commit — [tag-for-release](tag-for-release.md) commits it with the release.

## Report

Per file: **CURRENT** or **UPDATED** (with a one-line note). Explicitly confirm the `docs/releases/{version}.md` file exists and matches `package.json`, or flag that it's missing. Do not commit.
