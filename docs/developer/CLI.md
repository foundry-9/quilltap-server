# Quilltap CLI — developer notes

**The full command reference lives in [`packages/quilltap/README.md`](../../packages/quilltap/README.md).** That is the file an
`npm install -g quilltap` user actually gets, and it is the single comprehensive reference: every
namespace (`db`, `docs`, `sync`, `memories`, `logs`, `migrations`, `maintenance`, `file-verify`,
`memory-diff`, `recall-replay`, `themes`, `instances`, `completion`), instance resolution, the
`qtap://` addressing scheme, locking, and shell-completion installation. Add new commands and flags
there.

This file keeps only what will never belong in a published package README: repo scripts, module
maps, and the internals of the completion templates.

> **Reminder for anyone at a shell here:** databases are SQLCipher-encrypted, so the standard
> `sqlite3` binary **cannot** open them. Use `npx quilltap`, prefer the high-level subcommands over
> raw SQL, and never reach for `--lock-override`.

## Docker startup (`scripts/start-quilltap-docker.ts`)

`npm run start:docker` builds and runs the container. Beyond the data-directory bind it also passes through every filesystem/Obsidian document store, so their `basePath` values resolve inside the container.

| Flag | Effect |
|---|---|
| `-i, --instance NAME` | Resolve the data dir from the instance registry, and let the CLI unlock an encrypted instance when enumerating stores |
| `--recreate` | `docker rm -f` the existing container and build a new one (the only way to change binds) |
| `--no-store-mounts` | Skip store enumeration entirely |
| `--dry-run` | Print the `docker run` argv without executing |

Store enumeration shells out to `quilltap docs docker-mounts --format json`. **A failure there is non-fatal** — it warns and starts without store binds, because an unreadable store list is a poor reason to refuse to start Quilltap. The usual cause is an encrypted instance reached by `--data-dir`; pass `--instance` instead.

Because binds are fixed at container creation, a store added later is invisible to a running container. When the container already exists, the script diffs its `.Mounts` against the current plan and names the stores that are unreachable, pointing at `--recreate`.

### The bind planner

`packages/quilltap/lib/docker-mounts.js` is pure and unit-tested. Binds are path-identical
(`-v /host/vault:/host/vault`) so the `basePath` in the database resolves the same inside and out.
The planner collapses stores sharing a path to one bind, drops paths nested inside another bind,
**skips** non-existent paths rather than letting Docker fabricate an empty source, warns for macOS
paths outside Docker Desktop's default shares and for Linux uid mismatch, and refuses on Windows (no
path-identical binds). `--format args` puts only flags on stdout and all advice on stderr.

## Sync: why the engine is server-side

`npx quilltap sync` is a **thin client**. The engine is
`POST /api/v1/mount-points/[id]?action=sync` (`lib/mount-index/sync/`); the CLI resolves the store
name against the local mount index — read-only, the one thing it opens the database for — and prints
the report. The route's Zod schema is the single source of truth for the flags; the CLI does not
re-validate them.

The engine lives in the server because the sync writes through `linkDocumentContent` /
`linkBlobContent`, `ensureFolderPath`, the hard-link fan-out, and the post-write re-chunk — all
TypeScript in `lib/`, unreachable from this plain-JS package, and a lock-gated direct-SQLite writer
could not re-chunk at all. `docs write` on a database store already requires the server for the same
reason.

Modules: `lib/mount-index/sync/{index,walk-store,walk-disk,manifest,planner,apply-store,apply-disk,sidecar,types}.ts`;
CLI `packages/quilltap/lib/{sync-command,sync-report}.js`. The planner is pure and table-tested;
`sync-report.js` is pure and unit-tested.

## Shell-completion internals

User-facing install instructions are in the package README. What follows is for whoever edits the
templates under `packages/quilltap/lib/completion/`.

- **Completions parse the line, they never count words.** A flag may sit anywhere the CLI itself accepts one, so `quilltap docs --instance Friday <TAB>` still offers the `docs` verbs. zsh gets this from `_arguments` positional specs — `(-)` on the top-level `'(-): :->subcommand'` / `'(-)*::arg:->args'` pair is what stops the outer `_arguments` swallowing a flag typed *after* the subcommand — and bash from a scanner that knows which flags take a value. Two traps to respect when editing the templates: `-o` is the valueless global `--open` but themes' valued `--output`, and `memories` reserves `-i` for `--ignore-case` rather than `--instance`.
- **Store names complete from the addressed instance.** Wherever a verb takes a `<mount>` (`docs ls`, `docs read`, both ends of `docs move`/`copy`/`link`, and `--mount`), bash and zsh offer live store names, re-using the `-i`/`-d`/`--passphrase` already on the line so the lookup reads the instance being addressed rather than the default one. fish completes `--mount` but not the positionals, and always reads the default instance. Dynamic completions shell out to hidden `--names-only` flags (`quilltap instances list --names-only` and the mount/character equivalents).
- `packages/quilltap/lib/__tests__/completion-behavior.test.js` drives the bash script for real (sourcing it and reading `COMPREPLY` back) and checks the zsh template structurally. `completion-coverage.test.js` guards the surface on three levels: every subcommand in `SUBCOMMANDS` reaches `--help` and all three templates, every subcommand has its own completion arm, and **every long flag a subcommand's `--help` advertises is offered by all three templates** — the help text is the contract, so adding a flag to it without teaching the templates fails the build. It also checks bash's `vf_*` value-flag lists against zsh's `:value:` specs, since bash alone cannot infer which flags swallow the next word.

## See also

- [`packages/quilltap/README.md`](../../packages/quilltap/README.md) — the full command reference.
- [DDL.md](DDL.md) — full database schema and how to query it.
- [DATABASE_ENCRYPTION.md](DATABASE_ENCRYPTION.md) — SQLCipher key handling.
- [bug 126](bugs/fixed/bug-126-hostname-flap-kills-server.md) — why lock freshness, not a PID check, is the fallback everywhere.
- [bug 144](bugs/fixed/bug-144-lock-clean-claims-dead-holder-is-alive.md) — why `--lock-clean` talks about heartbeat age rather than liveness.
