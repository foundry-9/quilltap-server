# Remove old development release tags

$ARGUMENTS

This skill accepts an optional argument: `all`. When no argument is provided, it keeps the latest dev tag and removes older ones. When `all` is provided, it removes **every** dev tag, release, and Docker image for the current release candidate — nothing is kept.

## Steps

1. Checkout the main branch if we aren't already on it.
2. Fetch all tags from the remote so our local state is current: `git fetch --tags`
3. Figure out what the current development release pattern is:
   - Read the `version` field from `package.json`. It will be in the form `{base}-{label}.{number}`, e.g. `3.3.0-dev.71`.
   - Split on `-` to extract the base semver (e.g. `3.3.0`) and the prerelease portion (e.g. `dev.71`).
   - Split the prerelease portion on `.` to get the label (e.g. `dev`) and the number (e.g. `71`).
   - The grep pattern is `{base}-{label}` — e.g. `3.3.0-dev`.
4. Find all tags matching that pattern: `git tag | grep '{base}-{label}'`
   - **Default mode (no argument):** If there are zero or one matching tags, there is nothing to clean up. Report that and stop. Otherwise, find the latest one — the tag with the largest integer after `-{label}`. For example, given `3.3.0-dev.21`, `3.3.0-dev.45`, and `3.3.0-dev.73`, the latest is `3.3.0-dev.73`. Previous bases - for example, if the base was `3.2.0-dev.222` - should also be included in the sweep; consider those a dev version to delete as well.
   - **`all` mode:** If there are zero matching tags, there is nothing to clean up. Report that and stop. There is no "latest" to keep — all matching tags will be removed.
5. Clean up dev GitHub releases:
   - List the existing pre-release and draft releases with this: `gh release list --json name,tagName,createdAt,isPrerelease,isDraft --jq '[.[] | select(.isPrerelease or .isDraft)]'`
   - **Default mode:** Remove the old releases from GitHub (all except the latest tag's release), like this: `gh release delete --yes 4.0.0-dev.1`
   - **`all` mode:** Remove **all** matching releases from GitHub, including the latest one.
6. Delete the development release tags:
   - **Default mode:** Delete all matching tags that are **NOT** the latest.
   - **`all` mode:** Delete **all** matching tags.
   - First, delete them from GitHub: `git push origin --delete 3.3.0-dev.21 3.3.0-dev.45` (etc.)
   - Then, delete them locally: `git tag --delete 3.3.0-dev.21 3.3.0-dev.45` (etc.)
7. Remove the images from Docker Hub **by digest, not by tag.** On Docker Hub, `regctl tag rm` only removes the tag: the manifests and their layers stay behind untagged and keep counting against the repository's storage (that is how `foundry9/quilltap` grew past 200 GB). Deleting the manifest by digest is what frees it.

   Each dev version `X` (e.g. `3.3.0-dev.21`) on Docker Hub is five manifests under three tags:
   - `X` → a multi-arch index, whose children are the `linux/amd64` image, the `linux/arm64` image, and one attestation manifest (SBOM + provenance) for each.
   - `X-amd64` and `X-arm64` → the same two image manifests the index lists (not separate copies).

   The floating `dev` tag points at the latest dev version's index, so `all` mode removes `dev` along with it. That is expected.

   Work out the versions to remove (the same set as step 6; construct the regex like this):
   - **Default mode:** `regctl tag ls foundry9/quilltap | grep -E '^3\.3\.0-dev\.[0-9]+$' | grep -v '^3\.3\.0-dev\.129$'` if the latest is `3.3.0-dev.129` (also include older dev bases, as in step 4).
   - **`all` mode:** the same without the `grep -v`.

   First record the digests to keep, so nothing still tagged is deleted: `regctl image digest` of the kept dev version (default mode) and of `foundry9/quilltap:latest`, plus every child digest of each of those indexes. Then, for each version `X` to remove:

   ```bash
   IDX=$(regctl image digest foundry9/quilltap:X)
   CHILDREN=$(regctl manifest get foundry9/quilltap@$IDX --format '{{range .Manifests}}{{println .Digest}}{{end}}')
   regctl manifest rm foundry9/quilltap@$IDX            # index first, so no child is still referenced
   for d in $CHILDREN; do regctl manifest rm --ignore-missing foundry9/quilltap@$d; done
   ```

   - Skip any digest that is in the keep set.
   - If a version has no `X` index (only `X-amd64` / `X-arm64`, e.g. a build whose manifest job failed), delete the digests those tags resolve to instead.
   - Deleting a manifest by digest removes every tag that points at it, so `X`, `X-amd64` and `X-arm64` all disappear. Afterwards run `regctl tag ls foundry9/quilltap | grep 'X'` to confirm, and delete any straggler with `regctl tag rm`.
   - If Docker Hub refuses the digest delete (`401`/`403`/`405`), stop and tell the user: the token regctl is logged in with needs the **Delete** scope. Do not fall back to `regctl tag rm` without saying so, because that leaves the storage behind.

   This frees only what this run removes. Untagged images left by earlier tag-only cleanups can't be listed through the registry API; the user has to clear them from Docker Hub's web UI.

## Rules

You must not delete any tags that are bare semver tags without the `-{label}.{number}` suffix. You would **NOT** delete `3.3.0` or `3.2.1`, but you would delete `3.3.0-dev.21`. Only tags for the current release candidate's label are in scope — do not touch tags from older release series.
