# Release Checklist 6 — Prune Leftover Debug Logging

If you have not already done so, read [CLAUDE.md](../../CLAUDE.md) for how to work in this repository.

**Goal (checklist item 6 of 14):** We always add debug logging to new backend work. Before release, remove the noisy scaffolding logging we no longer need — while keeping the deliberate, appropriately-leveled logs the logging convention calls for.

## Scope

```bash
LAST_TAG=$(scripts/last-release-tag.sh)  # rel/X.Y.Z on main-line branches, X.Y.Z on bugfix; never a dev tag
git diff --name-only "${LAST_TAG}"..HEAD -- '*.ts' '*.tsx' | grep -vE '__tests__|\.test\.' | sort -u
```

## Steps

1. Find logging added since the last release:
   ```bash
   git diff "${LAST_TAG}"..HEAD -- '*.ts' '*.tsx' | grep -nE '^\+.*(console\.(log|debug)|logger\.(debug|trace)|\.debug\()'
   ```
2. Classify each:
   - **Remove:** stray `console.log`, one-off "got here"/dump-the-variable traces, temporary correlation prints — the debugging detritus.
   - **Keep:** structured logs through the built-in logging system at the right level. CLAUDE.md requires every new/touched backend path to fire debug logs, so **don't strip the intentional debug logging** — only the throwaway scaffolding and any `console.*` that should be a real logger call.
3. Convert any surviving `console.*` in backend paths to the built-in logging system at an appropriate level. Remove the throwaway lines.
4. Verify nothing broke: `npx tsc`.

## Report

List removed lines and converted lines (`file:line`), plus intentional debug logs you kept. Confirm `npx tsc` passes. Leave the commit to [/commit](commit.md) — see "Commits and branches" in [CLAUDE.md](../../CLAUDE.md): on `main` nothing is committed without an explicit `/commit`; on any other branch (a worktree, a cloud session) commit the fixes to that branch.
