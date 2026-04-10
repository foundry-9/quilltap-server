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
   - **Default mode (no argument):** If there are zero or one matching tags, there is nothing to clean up. Report that and stop. Otherwise, find the latest one — the tag with the largest integer after `-{label}`. For example, given `3.3.0-dev.21`, `3.3.0-dev.45`, and `3.3.0-dev.73`, the latest is `3.3.0-dev.73`.
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
7. Remove the images from Docker (you'll have to construct the right regexes):
   - **Default mode:** `regctl tag ls foundry9/quilltap | grep '3.3.0-dev' | grep -v '3.3.0-dev\.129' | xargs -I{} regctl tag rm foundry9/quilltap:{}` is the command if you determine that the latest version is "3.3.0-dev.129"
   - **`all` mode:** `regctl tag ls foundry9/quilltap | grep '3.3.0-dev' | xargs -I{} regctl tag rm foundry9/quilltap:{}` — no exclusion, remove all matching Docker tags.

## Rules

You must not delete any tags that are bare semver tags without the `-{label}.{number}` suffix. You would **NOT** delete `3.3.0` or `3.2.1`, but you would delete `3.3.0-dev.21`. Only tags for the current release candidate's label are in scope — do not touch tags from older release series.
