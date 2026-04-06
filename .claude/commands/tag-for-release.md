# Tag for Production Release

This command uses a linear git strategy. After creating the release commit on `release`, main stays perfectly linear (no merge-back). Use `git log <tag>..main` to see commits since a release. The squash onto release uses a tree-copy approach immune to stale merge bases.

**Important:** Do not use sed commands with regexp group backreferences (like `\1`) in Bash tool calls — they get mangled. Instead, use the Edit tool to modify `package.json`, `README.md`, and other files directly. The instructions below describe *what* to change in each file, with examples.

## Release notes

Every tagged release **must** have a release notes file at `docs/releases/<version>.md`.

### Bugfix releases (patch version bump from `bugfix` branch)

Write release notes yourself in the standard Quilltap prose style ("steampunk + roaring 20s + Great Gatsby + Wodehouse + Lemony Snicket"). Bugfix release notes should be brief — a paragraph or two describing what was fixed and why. Use this frontmatter format:

```markdown
---
title: "Version X.Y.Z released"
version: "X.Y.Z"
pubDate: YYYY-MM-DD
description: "Brief one-line description of the fix"
draft: false
---

# Quilltap X.Y.Z Release Notes

[Prose description of the fix in the standard Quilltap style]
```

Then include the standard installation section (copy from the most recent release notes file).

### Major or minor releases (from `main` branch)

Ask the developer: "Would you like to write the release notes yourself, or shall I draft them in the Quilltap style?" If they want you to write them, review all commits since the last release (`git log <last-tag>..HEAD`) and write substantial release notes in the standard prose style, following the pattern in `docs/releases/4.0.0.md`. Include the standard installation section.

## If current branch is `main`

This is how we tag a commit in main for release.

### Step 1: Set up the release branch

```bash
git checkout release
# Tree-copy: make release's working tree identical to main's
git rm -rf .
git checkout main -- .
git add -A
```

Now determine the release version. The version in `package.json` will look like `X.Y.0-dev.N`. The release version is `X.Y.0` (strip the `-dev.N` suffix).

**Edit `package.json`:** Change `"version": "X.Y.0-dev.N"` to `"version": "X.Y.0"`

**Example:** `"version": "4.1.0-dev.3"` becomes `"version": "4.1.0"`

```bash
npm install
```

Note the release version (e.g., `4.1.0`) — you'll need it for all remaining steps. Call it NEWRELEASE.

**Edit `README.md`:** Change the "This Version" badge to show the release version in green.

**Example:** `badge/version-4.1.0--dev.3-yellow.svg` becomes `badge/version-4.1.0-green.svg`

### Step 2: Fix changelog for release branch

The changelog should list changes under the release version heading. If there's an `x.y-dev` heading, rename it to `x.y.0`. Ensure the format matches:

```markdown
### 4.1.0

- feat: Description of feature
- fix: Description of fix

### 4.0.0

- (previous release entries)
```

### Step 3: Write release notes

Create `docs/releases/NEWRELEASE.md` following the release notes instructions above. This file must be committed as part of the release commit.

### Step 4: Commit and tag the release

```bash
git add package.json package-lock.json README.md docs/releases/NEWRELEASE.md
git commit --no-verify -m "release: NEWRELEASE"
git tag -s -m "NEWRELEASE" NEWRELEASE
```

(Replace NEWRELEASE with the actual version string, e.g., `4.1.0`)

### Step 6: Start the new dev branch on main

Calculate the next minor version: increment the middle number and reset patch to 0. For example, `4.1.0` becomes `4.2.0`.

```bash
git checkout main
```

**Edit `package.json`:** Set the version to the new dev version.

**Example:** `"version": "4.1.0"` (or whatever it was) becomes `"version": "4.2.0-dev.0"`

```bash
npm install
```

**Edit `README.md`:** Update the badge to show the new dev version in yellow.

**Example:** `badge/version-4.1.0-green.svg` becomes `badge/version-4.2.0--dev.0-yellow.svg`

(Note: the `--` in the badge URL is how shields.io escapes a literal hyphen.)

### Step 7: Fix changelog for main branch

Add a new dev heading above the release heading:

```markdown
### 4.2-dev

(empty — new development starts here)

### 4.1.0

- (entries from the release)
```

### Step 8: Commit and tag main

```bash
git add package.json package-lock.json README.md
git commit --no-verify -m "dev: started NEWDEVVERSION development"
git tag -s -m "NEWDEVVERSION-dev" NEWDEVVERSION-dev
```

(Replace NEWDEVVERSION with the actual version, e.g., `4.2.0`)

### Step 9: Set up the new bugfix branch

The bugfix branch version should be one patch ahead of the release. For example, if the release was `4.1.0`, the bugfix branch starts at `4.1.1-bugfix.0`.

```bash
git checkout bugfix
# Tree-copy: make bugfix's working tree identical to release's
git rm -rf .
git checkout release -- .
git add -A
```

**Edit `package.json`:** Set the version to the next patch with bugfix suffix.

**Example:** `"version": "4.1.0"` becomes `"version": "4.1.1-bugfix.0"`

```bash
npm install
```

**Edit `README.md`:** Update the badge to show the bugfix version in yellow.

**Example:** `badge/version-4.1.0-green.svg` becomes `badge/version-4.1.1--bugfix.0-yellow.svg`

```bash
git add package.json package-lock.json README.md
git commit --no-verify -m "bugfix: started NEWRELEASE bug branch"
```

(Where the commit message uses the *release* version, e.g., "bugfix: started 4.1.0 bug branch")

### Step 10: Push everything

```bash
git push
git checkout main
git push
git checkout release
git push
git push --tags
```

---

## If current branch is `bugfix`

### Step 1: Merge bugfix changes into release

```bash
git checkout release
# Tree-copy: make release's working tree identical to bugfix's
git rm -rf .
git checkout bugfix -- .
git add -A
```

Now determine the release version. The version in `package.json` will look like `X.Y.Z-bugfix.N`. The release version is `X.Y.Z` (strip the `-bugfix.N` suffix).

**Edit `package.json`:** Remove the `-bugfix.N` suffix from the version.

**Example:** `"version": "4.0.2-bugfix.0"` becomes `"version": "4.0.2"`

```bash
npm install
```

Note the release version (e.g., `4.0.2`) — you'll need it for all remaining steps. Call it NEWRELEASE.

**Edit `README.md`:** Change the badge to show the release version in green.

**Example:** `badge/version-4.0.2--bugfix.0-yellow.svg` becomes `badge/version-4.0.2-green.svg`

### Step 2: Fix changelog for release branch

Ensure the changelog has changes listed under the release version heading (e.g., `### 4.0.2`). This should already be correct from the bugfix branch.

### Step 3: Write release notes

Create `docs/releases/NEWRELEASE.md` following the release notes instructions above (bugfix style — brief prose about what was fixed). This file must be committed as part of the release commit.

### Step 4: Commit and tag the release

```bash
git add package.json package-lock.json README.md docs/releases/NEWRELEASE.md
git commit --no-verify -m "release: NEWRELEASE"
git tag -s -m "NEWRELEASE" NEWRELEASE
```

(Replace NEWRELEASE with the actual version, e.g., `4.0.2`)

If `git tag -s` fails due to signing issues, fall back to `git tag -a -m "NEWRELEASE" NEWRELEASE`.

### Step 5: Restart bugfix from the new release

The bugfix branch version should be one patch ahead of the release. For example, if the release was `4.0.2`, the bugfix branch starts at `4.0.3-bugfix.0`.

```bash
git checkout bugfix
# Tree-copy: make bugfix's working tree identical to release's
git rm -rf .
git checkout release -- .
git add -A
```

**Edit `package.json`:** Set the version to the next patch with bugfix suffix.

**Example:** `"version": "4.0.2"` becomes `"version": "4.0.3-bugfix.0"`

```bash
npm install
```

**Edit `README.md`:** Update the badge to show the new bugfix version in yellow.

**Example:** `badge/version-4.0.2-green.svg` becomes `badge/version-4.0.3--bugfix.0-yellow.svg`

```bash
git add package.json package-lock.json README.md
git commit --no-verify -m "bugfix: started NEWRELEASE bug branch"
```

(Where the commit message uses the *release* version, not the bugfix version — e.g., "bugfix: started 4.0.2 bug branch")

### Step 6: Push everything

```bash
git push
git checkout release
git push
git push --tags
```

### Pulling bugfix changes into main

No merge needed — main stays linear. The bugfix code is already on `release` and will be picked up in the next main-to-release squash. If the bugfix is urgent and needed on `main` immediately, cherry-pick the specific commits from `bugfix` onto `main`.
