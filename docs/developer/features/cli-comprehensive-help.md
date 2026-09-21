# Consolidating the CLI reference into packages/quilltap/README.md

**Status:** Proposal / Not Implemented — analysis and recommendation only, no docs changed yet
**Scope:** Documentation only. No code, no behavior change.
**Trigger:** User asked for "a comprehensive help file... detailing how to use the Quilltap CLI," to live in the package's `README.md` if one already exists somewhere.

## Summary

A comprehensive CLI reference already exists, but its content is split across two files that grew independently:

- **[`packages/quilltap/README.md`](../../../packages/quilltap/README.md)** (450 lines) — the npm package README. This is what a `npm install -g quilltap` user, or anyone viewing the package on npmjs.com or browsing `packages/quilltap/` on GitHub, actually sees. Reasonably thorough already: install, data dirs, named instances, `db`, `docs`, `sync`, `memories`, `logs`, `migrations`, `maintenance`, `file-verify`, `themes`, shell completion.
- **[`docs/developer/CLI.md`](../CLI.md)** (278 lines) — extracted out of `CLAUDE.md` in a past release cycle (see `docs/CHANGELOG_V4.md`, "CLAUDE.md slimmed; CLI reference extracted to docs/developer/CLI.md") specifically to be *the* full reference. `CLAUDE.md`'s standing rules still point here (`**Full command reference: [CLI.md](docs/developer/CLI.md).**`), and [`release-checklist-12-cli.md`](../../../.claude/commands/release-checklist-12-cli.md) names it "the full reference" with the package README listed as a secondary thing to also keep updated.

So today there isn't one comprehensive file — there are two, overlapping but not identical, and the project's own tooling (the release checklist) currently treats the *developer* doc as canonical rather than the *package* doc, which is backwards from what an npm-installed user can actually reach.

There is also a third, unrelated layer that should **not** be folded into this: `help/cli-*.md` (`cli-completion.md`, `cli-docs.md`, `cli-file-verify.md`, `cli-instances.md`, `cli-logs.md`, `cli-memories.md`, `cli-migrations.md`, `cli-sync.md`). Those are the in-app "Almanack" help pages, written in Quilltap's steampunk/Wodehouse voice per `CLAUDE.md`'s writing-voice rule, served to users inside the running app via `help_navigate`. Different audience, different voice, different delivery mechanism. Leave them alone.

## Gap analysis: what CLI.md has that README.md doesn't

Diffed section by section. Line numbers are against `docs/developer/CLI.md` as of this writing.

1. **Character archive commands** (CLI.md lines 30–37) — `db characters archives|archive|rehydrate|export`. Entirely absent from README.md. This is a real, user-reachable feature (archiving/rehydrating a character, exporting an archived bundle's plaintext `.qtap` offline) and belongs in a comprehensive reference.
2. **`qtap://` URI addressing** (CLI.md lines 61–75) — the `qtap://mount/path` shorthand accepted by most `docs` verbs, its name-first/UUID-fallback resolution, the `--uri` output flag, and the explicit CLI limitation that `qtap://self/…` and `qtap://project/…` aren't addressable from the shell. Absent from README.md's Document Stores section.
3. **camelCase columns gotcha** (CLI.md line 15) — a one-line but genuinely useful note that `db schema` output is camelCase (`createdAt`, not `created_at`), matching the TS/Zod types. Absent from README.md.
4. **`memories validate`** (CLI.md line 157) — a read-only dangling-edge health check with `--list`. README.md's Memories section lists `ls`, `find`, `grep`, `show`, `tree`, `status` but not `validate`.
5. **Lock heartbeat window / `--lock-clean` vs `--lock-override`** (CLI.md lines 233–257) — the "five-minute heartbeat window" explanation (a lock counts as held until its heartbeat is 5 minutes stale, *even if the holding process is dead*, per bug 126), what `--lock-clean` actually checks before it will act, and why `--lock-override` should never be reached for casually. README.md mentions `--write` is lock-gated but has none of this operational detail — someone hitting the refusal in the wild has no way to know it's expected behavior, not a stale lock, without this section.
6. **Sync refusal list is incomplete in README.md.** CLI.md (line 124, "a second concurrent run") lists a refusal case README.md's sync section doesn't mention. CLI.md also documents that a character vault's keystone files are never deleted by sync — a `conflict` is reported instead (lines 125–127) — which README.md omits.
7. **`instances restore-key` doesn't re-encrypt archive bundles** (CLI.md line 217) — a caveat ("Bundles made under a passphrase you have just replaced still want the old one") missing from README.md's otherwise-decent restore-key paragraph.
8. **Docker startup script** (CLI.md lines 140–153, `scripts/start-quilltap-docker.ts` / `npm run start:docker`) — on reflection this one probably should **stay** developer-only. It documents a *repo* script for running the server from source under Docker, not a `quilltap` CLI subcommand; an npm-installed user of the package has no access to `scripts/` at all. Flagging it here so it isn't accidentally copied over along with everything else.
9. **Completion internals** (CLI.md lines 271–273 — the `-o` valueless-global-vs-valued-`--output` trap, `memories` reserving `-i` for `--ignore-case`, references to `completion-behavior.test.js` / `completion-coverage.test.js`) — this is maintainer-of-the-completion-templates detail, not end-user reference. Recommend leaving in developer docs, not the package README, same reasoning as #8.

## Recommendation

Make `packages/quilltap/README.md` the single comprehensive, user-facing CLI reference — since it's the only one of the two that actually ships to and reaches everyone who runs `npx quilltap` or `npm install -g quilltap`. Concretely:

1. **Merge gap items 1–7 above into README.md**, in the sections they naturally extend (character archive under "Database Tool", `qtap://` URIs under "Document Stores (Scriptorium)", camelCase note under the schema subcommands, `validate` under "Memories", the lock section as a new subsection near "Database Tool" or its own "Locking" section, restore-key caveat inline, sync refusal list merged).
2. **Do not port items 8–9** — they're about developing/running the server from source and about maintaining the shell-completion templates, not about using the published CLI. They stay wherever they currently live.
3. **Decide the fate of `docs/developer/CLI.md` itself.** Two reasonable options, both compatible with "move everything to README.md":
   - **(a) Slim it to a pointer + dev-only appendix.** Replace the bulk of CLI.md with "See `packages/quilltap/README.md` for the full command reference," and keep only the items that are genuinely developer/internal (the Docker startup script section, the completion-template internals, the sync module file map, links to `DDL.md`/`DATABASE_ENCRYPTION.md`/bug files). This preserves the historical value of CLI.md as an implementation-notes file without duplicating the user reference.
   - **(b) Delete `docs/developer/CLI.md` outright** and fold its dev-only remainder (Docker startup, completion internals, module map) into `docs/developer/DEVELOPMENT.md` or a new small dev-notes file, updating every inbound link.
   
   Recommend **(a)** — it's a smaller, lower-risk change (no link rewrites needed anywhere that currently points at `CLI.md`, since the file still exists at the same path) and keeps a natural home for content that will never belong in an npm package README (things like `packages/quilltap/lib/__tests__/completion-coverage.test.js` references).
4. **Update the files that currently name CLI.md as canonical**, once (3) is decided:
   - `CLAUDE.md:183` — `**Full command reference: [CLI.md](docs/developer/CLI.md).**` → repoint at `packages/quilltap/README.md`.
   - `.claude/commands/release-checklist-12-cli.md:19,26` — currently calls CLI.md "the full reference." Repoint the primary-reference language at the README; keep CLI.md in the "shell completions / other tooling" bullet if (3a) is chosen.
   - `.claude/commands/update-documentation.md:53,104` — the two existing catalogue entries (one per file) need their descriptions rewritten to reflect the new split: README.md's entry becomes "the full CLI reference," CLI.md's entry (if kept per option a) becomes "developer-only implementation notes: Docker startup script, completion-template internals, sync module map."
   - `docs/developer/DEVELOPMENT.md:203` — points to CLI.md "for the planner's rules (collapsed duplicates, nested-path…" — check whether that content is part of the dev-only remainder kept under option (a); if so the link stays valid as-is.
5. **Leave historical records untouched.** `docs/CHANGELOG_V4.md`, `docs/releases/*.md`, `docs/developer/bugs/fixed/*.md`, and the `docs/developer/features/complete/*.md` design-of-record specs (`qtap-uri.md`, `character-archive-spec.md`, `cli-document-store-sync.md`, `db-size-reduction-spec.md`) all reference `CLI.md` as part of describing what happened *at the time*. Rewriting those would falsify the historical record; they should keep citing `CLI.md` by name regardless of what CLI.md becomes.

## Open questions for whoever executes this

- Option (a) vs (b) above for CLI.md's fate — this write-up recommends (a) but it's a judgment call worth confirming.
- Whether the new "Locking" content (gap item 5) becomes its own top-level section in the README or folds into "Database Tool" — it currently applies to `db --write`, `maintenance run`, `optimize`, and `instances restore-key` all at once, so a shared section may read better than repeating the explanation four times.
