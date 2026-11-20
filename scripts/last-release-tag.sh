#!/usr/bin/env bash
# Prints the tag of the last production release that HEAD's code descends from,
# for "what changed since the last release" ranges: git diff/log "$(scripts/last-release-tag.sh)"..HEAD
#
# Why not `git describe --match '[0-9]*.[0-9]*.[0-9]*'`: that glob also matches dev tags
# (4.14.0-dev.67), so the "range since the last release" silently becomes "since the last dev build".
#
# How releases are tagged (see .claude/commands/tag-for-release.md):
#   X.Y.Z      the official tag, on the tree-copied (squashed) `release` branch
#   rel/X.Y.Z  an anchor on the commit that merged that release back into main
#
# On main, or any branch cut from main (worktrees, cloud sessions), the answer is the
# newest rel/* anchor on the first-parent line: `git log rel/X.Y.Z..HEAD` is then exactly
# the work done since the release. (`git log X.Y.Z..HEAD` would list main's whole history,
# because the squashed release commit doesn't contain main's commits.)
#
# On bugfix (or a branch cut from it) the rel/* anchors aren't reachable — they live on
# main — but the bare X.Y.Z tag is, through the "merge: X.Y.Z into bugfix" commit. The tag
# itself is no good as a range base for `git log` (same squash problem: `git log 4.13.0..bugfix`
# listed ~3,000 commits), so the script prints that merge commit's sha instead. Its tree is
# the release's tree exactly, so it serves `git diff` and `git log` alike, just as rel/* does.
#
# So: take the newest reachable rel/* anchor and the newest reachable bare X.Y.Z tag
# (pre-release suffixes excluded) and use whichever is the higher version, preferring the
# rel/* anchor on a tie.
#
# Usage:
#   scripts/last-release-tag.sh          a ref for ranges (rel/X.Y.Z, or a sha on bugfix)
#   scripts/last-release-tag.sh --name   the release version, X.Y.Z
#
# Cloud and CI checkouts are often shallow or tagless; this fetches what it needs first.
# Prints nothing and exits 1 if no release can be found.
set -uo pipefail

if [ "$(git rev-parse --is-shallow-repository 2>/dev/null)" = "true" ]; then
  echo "last-release-tag: shallow clone, fetching full history and tags..." >&2
  git fetch --quiet --unshallow --tags 2>/dev/null || git fetch --quiet --tags 2>/dev/null || true
elif ! git tag --list 'rel/*' | grep -q .; then
  git fetch --quiet --tags 2>/dev/null || true
fi

anchor=$(git describe --tags --abbrev=0 --first-parent --match 'rel/[0-9]*.[0-9]*.[0-9]*' --exclude 'rel/*-*' HEAD 2>/dev/null || true)
bare=$(git describe --tags --abbrev=0 --match '[0-9]*.[0-9]*.[0-9]*' --exclude '*-*' HEAD 2>/dev/null || true)

if [ -z "$anchor" ] && [ -z "$bare" ]; then
  echo "last-release-tag: no rel/X.Y.Z or X.Y.Z tag reachable from HEAD" >&2
  exit 1
fi
want_name=false
[ "${1:-}" = "--name" ] && want_name=true

use_anchor=false
if [ -n "$anchor" ]; then
  if [ -z "$bare" ]; then
    use_anchor=true
  else
    anchor_ver=${anchor#rel/}
    newest=$(printf '%s\n%s\n' "$anchor_ver" "$bare" | sort -V | tail -n1)
    [ "$newest" = "$anchor_ver" ] && use_anchor=true
  fi
fi

if $use_anchor; then
  if $want_name; then echo "${anchor#rel/}"; else echo "$anchor"; fi
  exit 0
fi

if $want_name; then echo "$bare"; exit 0; fi

# Walk HEAD's first-parent line back to the oldest commit that already contains the release:
# the commit where the release entered this line (the "merge: X.Y.Z into bugfix" commit).
entry=""
for c in $(git rev-list --first-parent HEAD); do
  if git merge-base --is-ancestor "$bare" "$c"; then entry=$c; else break; fi
done
echo "last-release-tag: release $bare entered this branch at ${entry:0:12}" >&2
echo "${entry:-$bare}"
