#!/usr/bin/env python3
"""
Cluster extracted signatures and emit candidate duplicate groups.

Strategies:
  1. Exact-name clusters: same function name across >=2 different files.
  2. Name-stem clusters: normalize names (strip For/By/From/With/Async/Sync/V2 etc.)
  3. Within each cluster, rank by "promise" using:
       - number of files
       - similarity of param signatures
       - similarity of first param types
       - similarity of return types
"""
import json
import collections
import os
import re
import sys

INPUT = sys.argv[1] if len(sys.argv) > 1 else "/tmp/qt-analysis/signatures.jsonl"
AREA = sys.argv[2] if len(sys.argv) > 2 else "api"  # "api" or "frontend"

rows = [json.loads(l) for l in open(INPUT)]
rows = [r for r in rows if r["area"] == AREA]


# Names that are *expected* to appear many times and are not interesting duplicate candidates
BORING = {
    # React component lifecycle / hooks helpers
    "use", "default", "Page", "Layout", "Loading", "Error", "NotFound",
    # Common HTTP route handler names
    "GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS",
    # Iteration helpers commonly shadowed
    "map", "filter", "forEach", "reduce", "find", "some", "every", "sort",
    # React/JSX helpers
    "render", "Component", "Wrapper",
    # Common one-off names
    "handle", "process", "run", "execute", "main", "init", "setup",
    "_", "fn", "cb", "callback",
}

# Words to strip when computing a stem
STEM_STRIP_SUFFIX = re.compile(
    r"(?:For[A-Z]\w*|From[A-Z]\w*|By[A-Z]\w*|With[A-Z]\w*|Of[A-Z]\w*|To[A-Z]\w*|"
    r"Async|Sync|V2|V3|Legacy|Helper|Util|Utility|Internal|Impl|Maybe|Once|Lazy)$"
)
# Common prefixes that mark variants
STEM_STRIP_PREFIX = re.compile(
    r"^(?:async|sync|maybe|safe|try|do|just|raw|inner)(?=[A-Z])"
)


def stem(name: str) -> str:
    s = name
    # Repeat stripping until stable
    for _ in range(3):
        new = STEM_STRIP_PREFIX.sub("", s)
        new = STEM_STRIP_SUFFIX.sub("", new)
        if new == s:
            break
        s = new
    return s


# Exact-name clusters
by_name = collections.defaultdict(list)
for r in rows:
    by_name[r["name"]].append(r)


def cluster_kind_distinct(rs):
    """How many distinct files? Distinct param signatures?"""
    files = {r["file"] for r in rs}
    sigs = {(r["param_count"], r["first_param_type"]) for r in rs}
    return len(files), len(sigs)


def sig_string(r):
    return f"{r['file']}:{r['line']}  {'async ' if r['async'] else ''}{r['name']}({r['params']}){' : ' + r['returns'] if r['returns'] else ''}"


# Score clusters for the report
def score_cluster(rs):
    n_files = len({r["file"] for r in rs})
    n = len(rs)
    # Penalize trivially small clusters
    if n_files < 2:
        return 0
    # Param-shape agreement -> good unification candidates
    param_counts = collections.Counter(r["param_count"] for r in rs)
    most_common_arity = param_counts.most_common(1)[0][1]
    arity_agreement = most_common_arity / n
    # First-param-type agreement
    fpt = collections.Counter((r["first_param_type"] or "?").split("|")[0].strip() for r in rs)
    fpt_top = fpt.most_common(1)[0][1] / n
    # Return-type agreement (loose)
    ret = collections.Counter((r["returns"] or "?")[:40] for r in rs)
    ret_top = ret.most_common(1)[0][1] / n

    # Bonus: spread across multiple directories
    dirs = {r["file"].rsplit("/", 1)[0] for r in rs}
    spread = min(len(dirs), 5) / 5.0

    return n_files * 2 + arity_agreement * 3 + fpt_top * 2 + ret_top * 1 + spread * 2


clusters_exact = []
for name, rs in by_name.items():
    if name in BORING:
        continue
    # Skip if all hits in one file (likely overload-ish or recursion, not duplication)
    files = {r["file"] for r in rs}
    if len(files) < 2:
        continue
    # Skip clearly non-interesting common names
    if len(name) < 3:
        continue
    clusters_exact.append((score_cluster(rs), name, rs))

clusters_exact.sort(key=lambda x: -x[0])


# Stem clusters (group by name stem, exclude clusters already perfectly captured by exact-name)
by_stem = collections.defaultdict(list)
for r in rows:
    by_stem[stem(r["name"])].append(r)

clusters_stem = []
for s, rs in by_stem.items():
    if s in BORING:
        continue
    if len(s) < 3:
        continue
    names = {r["name"] for r in rs}
    if len(names) < 2:
        continue  # all same name -> already in exact
    files = {r["file"] for r in rs}
    if len(files) < 2:
        continue
    clusters_stem.append((score_cluster(rs), s, names, rs))

clusters_stem.sort(key=lambda x: -x[0])

# Output
print(f"=== AREA: {AREA} ===")
print(f"Total signatures: {len(rows)}")
print(f"Unique names: {len(by_name)}")
print(f"Names appearing in >=2 files: {sum(1 for n, rs in by_name.items() if len({r['file'] for r in rs}) >= 2)}")
print()

print("=" * 70)
print("TOP EXACT-NAME CLUSTERS (same function name across files)")
print("=" * 70)
shown = 0
for score, name, rs in clusters_exact:
    if shown >= 60:
        break
    n_files = len({r["file"] for r in rs})
    if n_files < 2:
        continue
    print(f"\n## {name}  [score={score:.2f}, {n_files} files, {len(rs)} defs]")
    # Show up to 8 instances, sorted by file
    for r in sorted(rs, key=lambda x: (x["file"], x["line"]))[:10]:
        print(f"   {sig_string(r)}")
    if len(rs) > 10:
        print(f"   ... and {len(rs) - 10} more")
    shown += 1

print()
print("=" * 70)
print("TOP STEM CLUSTERS (similar name variants across files)")
print("=" * 70)
shown = 0
for score, s, names, rs in clusters_stem:
    if shown >= 40:
        break
    n_files = len({r["file"] for r in rs})
    if n_files < 2:
        continue
    print(f"\n## stem={s!r}  variants={sorted(names)[:6]}  [score={score:.2f}, {n_files} files, {len(rs)} defs]")
    for r in sorted(rs, key=lambda x: (x["file"], x["line"]))[:8]:
        print(f"   {sig_string(r)}")
    if len(rs) > 8:
        print(f"   ... and {len(rs) - 8} more")
    shown += 1
