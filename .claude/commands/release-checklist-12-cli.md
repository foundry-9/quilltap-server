# Release Checklist 12 — Quilltap CLI Docs, Completions & Tooling

If you have not already done so, read [CLAUDE.md](../../CLAUDE.md) for how to work in this repository.

**Goal (checklist item 12 of 14):** Verify that documentation, shell completions, and tooling for the [Quilltap CLI](../../packages/quilltap/) are up to date.

## Steps

1. See what changed in the CLI since the last release:
   ```bash
   LAST_TAG=$(scripts/last-release-tag.sh)  # rel/X.Y.Z on main-line branches, X.Y.Z on bugfix; never a dev tag
   git diff --name-only "${LAST_TAG}"..HEAD -- 'packages/quilltap/**' | sort -u
   ```
2. Enumerate the CLI's current commands/subcommands and options (read `packages/quilltap/`'s command definitions, or run the help):
   ```bash
   node packages/quilltap/bin/quilltap.js --help
   ```
3. Confirm each new/changed command, flag, or subcommand is reflected in:
   - [packages/quilltap/README.md](../../packages/quilltap/README.md) — **the full reference**, and the one that ships to npm users. Every new subcommand/flag documented, examples current.
   - **Shell completions** shipped with the CLI (look for completion scripts under `packages/quilltap/`). New commands/flags must appear there.
   - [CLI.md](../../docs/developer/CLI.md) — developer-only notes: the Docker startup script, the bind planner, the sync module map, completion-template internals. Not a command reference; only update it when one of those changes.
   - Any other CLI tooling (man pages, `--help` text).
4. Sanity-check the CLI still runs against a real instance (read-only by default; `--write` gates changes):
   ```bash
   node packages/quilltap/bin/quilltap.js --data-dir <instance-root> --help
   ```
5. Update the package README / completions / help text for anything that drifted.

## Report

List CLI changes this cycle and, for each, confirm **DOCS / COMPLETIONS / HELP** are current or note what you updated. Leave the commit to [/commit](commit.md) — see "Commits and branches" in [CLAUDE.md](../../CLAUDE.md): on `main` nothing is committed without an explicit `/commit`; on any other branch (a worktree, a cloud session) commit the fixes to that branch.
