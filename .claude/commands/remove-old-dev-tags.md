# Remove old prerelease tags

$ARGUMENTS

This skill cleans up prerelease tags, GitHub releases and Docker Hub images for one **label**:

- **`dev`** (the default): `X.Y.Z-dev.N` tags, cut from `main`.
- **`bugfix`**: `X.Y.Z-bugfix.N` tags, cut from `bugfix`.

It also accepts **`all`**. Without it, the newest tag of the label is kept if its version hasn't been released yet, and everything older goes. With it, every tag of the label goes and nothing is kept. Arguments combine in any order, e.g. `bugfix`, `bugfix all`, `all`. If the arguments name neither label, use `dev`. If they say something like "just the bugfix ones", that means `bugfix`.

**Where this runs:** only in the human's local checkout, and only when they ask for it. It deletes remote tags, GitHub releases and Docker Hub manifests, none of which can be undone. Never run it from a cloud session or a worktree; if you are in one, stop and say so. In step 1, if the working tree has uncommitted changes, stop and ask rather than switching branches over them.

## Steps

1. Checkout the main branch if we aren't already on it. (Tags are global, so this works for `bugfix` too; nothing reads the bugfix branch.)
2. Fetch all tags from the remote so our local state is current: `git fetch --tags`
3. List every tag of the label, across **all** bases and minor versions:

   ```bash
   git tag | grep -E "^[0-9]+\.[0-9]+\.[0-9]+-${LABEL}\.[0-9]+$" | sort -V
   ```

   If there are none, report that and stop.
4. Decide what to keep:
   - **`all` mode:** keep nothing.
   - **Default mode:** the candidate is the last tag in the `sort -V` list (highest base, then highest number). Keep it **only if its base hasn't been released**, i.e. there is no bare `X.Y.Z` tag for it (`git tag -l "$BASE"` prints nothing). If the base has shipped, the candidate is stale too and nothing is kept. Example: given `4.14.1-bugfix.9` and `4.14.2-bugfix.1`, with `4.14.1` released and `4.14.2` not, keep `4.14.2-bugfix.1` and delete `4.14.1-bugfix.9`.
   - The delete set is every listed tag except the kept one. If it's empty, report that and stop.
   - State the delete set and the kept tag (if any) before deleting.
5. Delete the GitHub releases for the delete set. Check which ones exist with `gh release list --limit 200 --json tagName,isPrerelease,isDraft --jq '.[] | select(.isPrerelease or .isDraft) | .tagName'`, then `gh release delete --yes <tag>` for each one in the delete set. A tag with no release is fine; skip it.
6. Delete the tags, first from GitHub with `git push origin --delete <tag> <tag> …`, then locally with `git tag --delete <tag> <tag> …`.
7. Remove the images from Docker Hub **by digest, not by tag** (see below).

## Docker Hub

On Docker Hub, `regctl tag rm` only removes the tag: the manifests and their layers stay behind untagged and keep counting against the repository's storage (that is how `foundry9/quilltap` grew past 200 GB). Deleting the manifest by digest is what frees it.

### What one version is

`release.yml` builds each arch with buildx, then joins them with `docker buildx imagetools create`. So each version `X` (dev or bugfix alike) is **seven manifests under three tags**:

- `X-amd64` → an **index** of two: the `linux/amd64` image and its attestation manifest (SBOM + provenance).
- `X-arm64` → the same for `linux/arm64`.
- `X` → a multi-arch **index** of four: both images and both attestations (the same leaf manifests, not copies).

The two per-arch tags are indexes of their own, not the images. Docker Hub refuses to delete a manifest that any index still lists, with `403 DENIED … cannot be deleted as it is referenced by other images`. So **delete all three indexes first, then the four leaves.** Deleting `X`'s index alone isn't enough.

The same workflow points the floating tags at new indexes: `latest` for a bare `X.Y.Z` tag, `dev` for **every** prerelease, bugfix included. So `dev` may point at a bugfix version.

### The keep set

Before deleting anything, resolve the digests that must survive: the kept version from step 4 (if any), `latest`, and `dev`, plus everything each of those indexes lists. Exception: in `all` mode, if `dev` resolves to the same index as a version in the delete set, leave `dev` out of the keep set. It goes with that version, which is expected. In default mode `dev` always stays in the keep set; a digest of a doomed version that `dev` still needs is skipped and reported, not deleted.

### The delete

Run it as one script so the keep set and the order are applied the same way every time. Set `DOOMED` to the delete set from step 4, and `KEEP_TAGS` to the kept version (if any) plus `latest`, plus `dev` unless the `all`-mode exception applies:

```bash
R=foundry9/quilltap
DOOMED="4.14.1-bugfix.9 4.14.2-bugfix.1"      # the delete set
KEEP_TAGS="latest dev"                         # + the kept version, if any

children() { regctl manifest get "$R@$1" --format '{{range .Manifests}}{{println .Digest}}{{end}}' 2>/dev/null; }
KEEP=""
for k in $KEEP_TAGS; do for t in "$k" "$k-amd64" "$k-arm64"; do   # a kept version keeps its per-arch indexes too
  d=$(regctl image digest "$R:$t" 2>/dev/null) || continue; KEEP="$KEEP $d $(children "$d")"
done; done
KEEP=$(echo $KEEP)   # one space-separated line, so the match below sees every digest
del() { case " $KEEP " in *" $1 "*) echo "KEPT (still referenced by a kept tag): $1";; *) regctl manifest rm --ignore-missing "$R@$1" && echo "removed $1";; esac; }

for X in $DOOMED; do
  echo "== $X"
  INDEXES=""; LEAVES=""
  for t in "$X" "$X-amd64" "$X-arm64"; do
    d=$(regctl image digest "$R:$t" 2>/dev/null) || { echo "no tag $t"; continue; }
    INDEXES="$INDEXES $d"; LEAVES="$LEAVES $(children "$d")"
  done
  for d in $INDEXES; do del "$d"; done                                     # indexes first
  for d in $(echo $LEAVES | tr ' ' '\n' | sort -u); do del "$d"; done      # then images and attestations
done

echo "== left behind:"; regctl tag ls "$R" | grep -E "$(echo $DOOMED | sed 's/\./\\./g; s/ /|/g')" || echo "(nothing)"
```

- A version may be missing one of its three tags (a build whose arch or manifest job failed). The script deletes whichever ones exist.
- If a tag is still listed at the end, find out why before reaching for `regctl tag rm`. It is usually a leaf that a kept tag still references (the script says `KEPT`), and that is correct.
- If Docker Hub refuses with `401`, `405`, or a `403` that does **not** say "referenced by other images", stop and tell the user: the token regctl is logged in with needs the **Delete** scope. Do not fall back to `regctl tag rm` without saying so, because that leaves the storage behind. A `403` that does say "referenced by other images" means an index pointing at that manifest is still there, so find it and delete it first.

This frees only what this run removes. Untagged images left by earlier tag-only cleanups can't be listed through the registry API; the user has to clear them from Docker Hub's web UI.

## Rules

- Never delete a bare semver tag (`4.14.1`, `4.15.0`), and never `latest`. Only `X.Y.Z-{label}.N` tags of the chosen label are in scope: a `bugfix` run never touches dev tags, and a `dev` run never touches bugfix tags.
- Older bases of the same label are in scope (a `dev` run sweeps `4.14.0-dev.*` as well as `4.15.0-dev.*`). Tags of other labels are not.
- Report at the end: the tags and releases deleted, the tag kept (if any), how many manifests were removed, and anything the keep set protected.
