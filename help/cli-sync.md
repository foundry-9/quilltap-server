---
url: /scriptorium
---

# Keeping a Store and a Directory in Step

There comes a moment in the life of every archivist when the arrangement that
seemed so elegant — one's documents tucked safely inside Quilltap's own
encrypted cabinetry, retrievable by any character who asks nicely — collides
with the stubborn fact that one's favourite text editor lives out on the
ordinary filesystem and has never heard of a database.

`quilltap sync` is the negotiated settlement. It takes a **database-backed**
document store and a directory on disk, and it keeps the two of them saying
the same thing.

```text
quilltap sync Lore ~/Documents/lore --dry-run   # what would happen
quilltap sync Lore ~/Documents/lore             # let it happen
```

Edit a chapter in your editor; the next run carries it into the store, where
your characters can read it. Edit it in the Scriptorium instead; the next run
carries it out to your editor. Edit it in *both* places between runs, and the
verb declines to choose — it says so and leaves both sides exactly as it found
them, which is a great deal more polite than the alternative.

## What It Compares, and in What Order

Two questions, asked in this order:

1. **Are the bytes the same?** Every file on both sides is fingerprinted by
   SHA-256. Identical fingerprints mean identical files, full stop.
2. **Whose clock is newer?** Only when the fingerprints disagree does the
   modification time get a vote, and then only to decide which side is the
   author of the change.

The consequence worth noticing is that **equal bytes with unequal clocks are
re-stamped, not re-copied**. If a file wandered out of step only in its
timestamps, the verb corrects the timestamps and carries no bytes anywhere.

Once a run is finished, both sides carry the same modification time and the
*older* of the two creation dates — a document's birthday does not move later
merely because somebody made a copy of it.

## The Directory Is Created; the Store Is Not

Point the verb at a directory that does not exist and it will be made for you.
Point it at a store that does not exist and it will tell you so and stop. This
is deliberate: a mistyped directory name costs you an empty folder, while a
mistyped store name, if indulged, would cost you a mystery.

Only **database-backed** stores can be synced. A filesystem or Obsidian store
already *is* a directory, so the verb declines and points you at its own base
path. An archived character's vault is refused outright — an archived
character is a tombstone, and the sync will not write one back into the world.

## What the Verb Does Not See

**Anything beginning with a dot is invisible to the sync, in both
directions.** A file or folder whose name starts with `.` — or that sits
anywhere beneath one — is never read, never copied, and never deleted, on
either side. Your `.git` directory, your editor's scratch files, the
`.DS_Store` that macOS scatters behind it like breadcrumbs: none of it will
find its way into your store, and nothing in your store with such a name will
find its way onto disk.

There is exactly one exception, and it belongs to the verb itself:
`.quilltap-sync.json`, a small record kept in the directory of what the last
run left on both sides. It is what allows the sync to tell "this file is new
here" from "this file was deleted there" — without it, every run would be a
first run. It never enters the store, and `--no-manifest` makes the verb
ignore it entirely.

The store's own exclusion patterns are honoured on the directory side as well,
on the grounds that they are the store's own opinions about what it does not
want.

## Descriptions Travel in a Sidecar

An image, a PDF, or any other binary in a document store may carry a
description — typed in the Scriptorium, or written for you by the image
auto-captioner. On disk, that description lives in a small Markdown file
beside the thing it describes:

```text
lore/harbour.png
lore/harbour.png.description.md     ← the caption
```

Edit the sidecar and the next run carries the new caption into the store.
Delete the sidecar and the caption is cleared. Delete the image and its
sidecar goes with it.

Text documents' descriptions are *not* synced — a Markdown file's own contents
are its description, as far as a directory is concerned — and the verb says so
once, in a `skip` line, rather than quietly losing one.

A word of warning about a name: a file in your store already called something
like `notes.md.description.md` is ambiguous, and the sync declines to touch it
in either direction rather than guess whose caption it is.

## Deletions, and Why They Need Proof

A file that has vanished from one side is either *new on the other* or
*deleted here*, and nothing about the present state of the two sides
distinguishes those cases. The manifest does: if the file was there at the end
of the last run and is gone now, it was deleted.

So on a **first** run — or with `--no-manifest` — a file present on only one
side is **created** on the other, never deleted. Deletions propagate only once
there is a record to prove them. `--no-delete` suppresses the propagation
altogether, for the cautious.

Should the record show that a file was *edited* on one side and *deleted* on
the other, that is a conflict and neither happens.

## Conflicts

When both sides have changed since the last agreement, the verb reports a
`conflict`, changes nothing, and finishes with exit code 2. Look at the two
versions, decide which you want, and say so:

```text
quilltap sync Lore ~/Documents/lore --prefer disk    # my editor is right
quilltap sync Lore ~/Documents/lore --prefer store   # the Scriptorium is right
```

`--prefer` is absolute: it resolves every difference in that direction without
consulting a single clock.

## Reading the Report

One line per thing done, in the order it was done:

```text
mkdir    disk   lore/maps/
create   disk   lore/maps/harbour.png    (sha 3f9a…, 412.0 KB)
describe disk   lore/maps/harbour.png.description.md
modify   store  chapters/03.md           (disk newer by 2h 14m)
touch    disk   chapters/01.md           (mtime 2026-09-19T14:02:11.000Z)
delete   store  drafts/old.md            (deleted on disk since last sync)
conflict —      notes/ideas.md           (both sides changed; --prefer to resolve)
```

The first column is what happened. **The second column is the side that
changed** — `modify store` means the store was rewritten from what was on
disk, which is worth reading twice the first time.

The lines go to standard output; warnings and the closing tally go to standard
error, so a pipeline may help itself to the former without wading through the
latter. `--json` emits the whole report as a machine-readable object instead.

Exit codes: `0` for a clean run, `1` for an error or an action that failed,
`2` for an unresolved conflict. `--dry-run` uses the same codes, so a script
may insist on a clean plan before it permits a real one.

## The Options, in Full

```text
quilltap sync <store|qtap://store/> <path> [options]

  --dry-run             Plan and print; change nothing on either side
  --direction <which>   both (default), to-disk, or to-store
  --prefer <which>      newer (default), store, or disk
  --no-delete           Never propagate a deletion
  --no-manifest         Ignore .quilltap-sync.json (first-run rules every time)
  --json                Machine-readable plan and results
  -p, --port <number>   Server port (default: 3000)
  -d, --data-dir <path> Override data directory
  -i, --instance <name> Use a registered instance
  --passphrase <pass>   Decrypt .dbkey if peppered
```

## The Server Must Be Awake

Writing to a database-backed store means writing through the machinery that
keeps it searchable — the chunker, the embedding scheduler, the hard-link
bookkeeping — and that machinery lives in the running server. So does
`quilltap docs write`, for the same reason. Start Quilltap, or pass `--port`
if it is listening somewhere unusual.

One consequence follows from this that catches people out: **the directory is
resolved on the server, not where you typed the command.** Ordinarily these
are the same machine and nobody notices. Running Quilltap in Docker, they are
not, and the directory must sit inside a bind mount — `quilltap docs
docker-mounts` will tell you which binds your stores want.

## What It Will Not Do

The sync never reads, writes, exports, or imports a chunk or an embedding
vector. It writes through the store's ordinary front door, and the store's
ordinary machinery re-indexes what changed, exactly as it would for a file
saved in the Scriptorium.

It is also scrupulously byte-preserving. A `.png` pushed in from disk is
stored as a `.png` with the same fingerprint — unlike an upload through the
Scriptorium, which would helpfully convert it to WebP. Helpfulness of that
kind would mean the two sides never agreed and the verb copied the same file
back and forth until the heat death of the universe.

## Related

- [The Command Line and the Document Stores](/help/cli-docs) — the wider
  `quilltap docs` family
- [The Scriptorium](/help/scriptorium) — the same stores, through a browser

## In-Chat Navigation

Characters with help tools enabled can navigate directly to this page:

`help_navigate(url: "/scriptorium")`
