# Remove old development release tags

We need to remove all previous development-branch-only release tags for the current release candidate and only leave the latest one.

1. Checkout the main branch if we aren't already on it.
2. Fetch all tags from the remote so our local state is current: `git fetch --tags`
3. Figure out what the current development release pattern is:
   - Read the `version` field from `package.json`. It will be in the form `{base}-{label}.{number}`, e.g. `3.3.0-dev.71`.
   - Split on `-` to extract the base semver (e.g. `3.3.0`) and the prerelease portion (e.g. `dev.71`).
   - Split the prerelease portion on `.` to get the label (e.g. `dev`) and the number (e.g. `71`).
   - The grep pattern is `{base}-{label}.` — e.g. `3.3.0-dev.`.
4. Find all tags matching that pattern: `git tag | grep '{base}-{label}.'`
   - If there are zero or one matching tags, there is nothing to clean up. Report that and stop.
   - Otherwise, find the latest one — the tag with the largest integer after `-{label}.`. For example, given `3.3.0-dev.21`, `3.3.0-dev.45`, and `3.3.0-dev.73`, the latest is `3.3.0-dev.73`.
5. Delete all the old development release tags (everything that is **NOT** the latest):
   - First, delete them from GitHub: `git push origin --delete 3.3.0-dev.21 3.3.0-dev.45` (etc.)
   - Then, delete them locally: `git tag --delete 3.3.0-dev.21 3.3.0-dev.45` (etc.)

You must not delete any tags that are bare semver tags without the `-{label}.{number}` suffix. You would **NOT** delete `3.3.0` or `3.2.1`, but you would delete `3.3.0-dev.21` if it isn't the latest one matching the `dev` label. Only tags for the current release candidate's label are in scope — do not touch tags from older release series.
