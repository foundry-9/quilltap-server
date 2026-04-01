# Tag for Production Release

This command uses a linear git strategy. After creating the release commit on `release`, main stays perfectly linear (no merge-back). Use `git log <tag>..main` to see commits since a release. The squash onto release uses a tree-copy approach immune to stale merge bases.

## If current branch is `main`

This is how we tag a commit in main for release.

The following commands need to be run, one at a time. Modify as needed to deal with possibility that you're not running these in the same shell, so environment variables you set might not persist (the way they would if I were just running these in a terminal window). You may have to be the one to keep track of the version strings, in other words.

### merge from main to release

#### Commands run to set up the release branch

```bash
# Don't just run this script; run the commands one at a time.
git checkout release
# Tree-copy: make release's working tree identical to main's
git rm -rf .
git checkout main -- .
git add -A
# Remove the detritus after the release
sed -i '' -E 's/("version": "[^"]*)-[^"]*"/\1"/' package.json
# Update package-lock.json to be up-to-date
npm install
# Get new release version for tags
NEWRELEASE=$(sed -n -E 's/.*"version": "([^"]*)".*/\1/p' package.json)
echo "New release is $NEWRELEASE"
# Change the badge to release version standards
sed -i '' -E 's/(badge\/version-)[^)]+\.svg/\1'"$NEWRELEASE"'-green.svg/' README.md
```

#### Fix changelog for release branch

The changelog has a certain format. In release and bugfix branches, changes for the current version should be listed under a new heading for that version, like this:

```markdown
### 3.2.1

- fix: This is the record of the most recent change
- feat: This is the second-most recent change, a feature implemented

### 3.2.0

- chore: This is the third-most recent change and the last change recorded for the previous version
- fix: This is the fourth-most recent change and the second-to-last change recorded for the previous version
```

This may involve changing an existing header for `x.y-dev` to `x.y.0`. That's appropriate here because this is a release, not a change for the dev branch.

If you have to update the [changelog](/docs/CHANGELOG.md) to conform, then add that to the commit.

```bash
# Presumably we ran tests and bumped prerelease versions when we committed last time
git add package.json package-lock.json README.md
git commit --no-verify -m "release: $NEWRELEASE"
# We'll tag it so we can handle the release
git tag -s -m "$NEWRELEASE" $NEWRELEASE
```

From the commands above you will know what the new release is called (the semver version).

### establish beginning of new dev history

Next we need to start the new dev line in branch `main`.

### Now we'll start the new dev branch

```bash
NEWDEVVERSION=$(echo "$NEWRELEASE" | awk -F. '{print $1"."$2+1".0"}')
echo "New dev release is $NEWDEVVERSION"
git checkout main
# No merge-back — main stays linear
# Make this the new first dev version
sed -i '' -E 's/("version": ")[^"]*"/\1'"$NEWDEVVERSION"'-dev.0"/' package.json
# Update package-lock.json again
npm install
# Let's fix that badge in the README file too
sed -i '' -E 's/(badge\/version-)[^-]*-[a-z]+/\1'"$NEWDEVVERSION"'--dev.0-yellow/' README.md
```

#### Fix changelog for main branch

The changelog has a certain format. In the main branch, changes for the current version should be listed under a new heading for that version, like this:

```markdown
### 3.3-dev

- fix: This is the record of the most recent change
- feat: This is the second-most recent change, a feature implemented

### 3.2.1

- chore: This is the third-most recent change and the last change recorded for the previous release version
- fix: This is the fourth-most recent change and the second-to-last change recorded for the previous released version
```

This may involve adding a new header for `x.y-dev`. That's appropriate here because this is the dev branch (`main`), not a change for the release branch.

If you have to update the [changelog](/docs/CHANGELOG.md) to conform, then add that to the commit.

From the commands above you will know what the new release is called (the semver version).

#### Commands run to finish resetting the main branch

```bash
# Again, we haven't changed anything substantial, so no pre-commits
git add package.json package-lock.json README.md
git commit --no-verify -m "dev: started $NEWDEVVERSION development"
# We'll tag this one too
git tag -s -m "$NEWDEVVERSION-dev" $NEWDEVVERSION-dev
```

### Now we set up the new bugfix history

```bash
# Let's set up the bugfix version too
git checkout bugfix
echo "New bugfix release is $NEWRELEASE-bugfix.0"
# Tree-copy: make bugfix's working tree identical to release's
git rm -rf .
git checkout release -- .
git add -A
# make this the new first bugfix version
sed -i '' -E 's/("version": ")[^"]*"/\1'"$NEWRELEASE"'-bugfix.0"/' package.json
# Update package-lock.json again
npm install
# Let's fix that badge in the README file too
sed -i '' -E 's/(badge\/version-)[^-]*-[a-z]+/\1'"$NEWRELEASE"'--bugfix.0-yellow/' README.md
# Again, we haven't changed anything substantial, so no pre-commits
git add package.json package-lock.json README.md
git commit --no-verify -m "bugfix: started $NEWRELEASE bug branch"
```

### Time to push the changes to Github

```bash
# Finally, the pushes to Github
git push
git checkout main
git push
git checkout release
git push
git push --tags
```

## If current branch is `bugfix`

### Merge bugfix changes into release

```bash
# Don't just run this script; run the commands one at a time.
git checkout release
# Tree-copy: make release's working tree identical to bugfix's
git rm -rf .
git checkout bugfix -- .
git add -A
# Remove the detritus after the release
node -e "const p=require('./package.json');const v=p.version.split('-')[0].split('.');v[2]++;p.version=v.join('.');require('fs').writeFileSync('package.json',JSON.stringify(p,null,2)+'\n')"
# Update package-lock.json to be up-to-date
npm install
# Get new release version for tags
NEWRELEASE=$(sed -n -E 's/.*"version": "([^"]*)".*/\1/p' package.json)
echo "New release is $NEWRELEASE"
# Change the badge to release version standards
sed -i '' -E 's/(badge\/version-)[^)]+\.svg/\1'"$NEWRELEASE"'-green.svg/' README.md
# Presumably we ran tests and bumped prerelease versions when we committed last time
git add package.json package-lock.json README.md
git commit --no-verify -m "release: $NEWRELEASE"
# We'll tag it so we can handle the release
git tag -s -m "$NEWRELEASE" $NEWRELEASE
```

### Now we restart bugfix from the new release

```bash
# Let's set up the bugfix version again
git checkout bugfix
# Tree-copy: make bugfix's working tree identical to release's
git rm -rf .
git checkout release -- .
git add -A
# make this the new first bugfix version
sed -i '' -E 's/("version": ")[^"]*"/\1'"$NEWRELEASE"'-bugfix.0"/' package.json
echo "New bugfix release is $NEWRELEASE-bugfix.0"
# Update package-lock.json again
npm install
# Let's fix that badge in the README file too
sed -i '' -E 's/(badge\/version-)[^-]*-[a-z]+/\1'"$NEWRELEASE"'--bugfix.0-yellow/' README.md
# Again, we haven't changed anything substantial, so no pre-commits
git add package.json package-lock.json README.md
git commit --no-verify -m "bugfix: started $NEWRELEASE bug branch"
```

### Now we need to pull the changes from release into dev

No merge needed — main stays linear. The bugfix code is already on `release` and will be picked up in the next main-to-release squash. If the bugfix is urgent and needed on `main` immediately, cherry-pick the specific commits from `bugfix` onto `main`.
