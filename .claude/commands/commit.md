# Commit to Git

1. Last chance to verify that, if the commit contains changes to a data model that shows up in backup/restore or import/export, we have covered that possibility in backup/restore and import/export
2. Verify that changes to the database schemas are covered by migrations if necessary, and all changes to the DDL or schemas in the databases must be reported in [DDL.md](../../docs/developer/DDL.md).
3. If this commit adds or modifies migrations in `migrations/scripts/`, **block the commit** unless both of these hold:
   a. Every new migration ID has a matching pretty-label entry in [`lib/startup/prettify.ts`](../../lib/startup/prettify.ts). Without one, the loading screen would display the raw migration ID to users.
   b. Every iteration over a collection inside a migration's `run()` calls `reportProgress(...)` from `../lib/progress`. Grep the migration file for `for (`, `for await`, `.forEach(`, and `.map(` over arrays of records — each should have a `reportProgress` call inside, OR live inside a synchronous `db.transaction(...)` (where mid-transaction progress can't reach the UI anyway). Surface the rule rather than waive it silently.
4. Last chance to verify that, if the commit contains changes to a front-end user interface component, that we have not introduced more direct usage of Tailwind classes as opposed to creating or using appropriate `qt-*` theme utility classes
5. If help files in `help/*.md` were created or modified, verify that each has a correct `url` in its frontmatter and an "In-Chat Navigation" section with the matching `help_navigate(url: "...")` tool call
6. You must update the [changelog](../../docs/CHANGELOG.md) for **every** git commit; no exceptions. If this is in the "bugfix" column, then it belongs in the next release section (if the last release was 3.1.2 then your changes probably belong in a 3.1.3 section), otherwise put it in the next dev section (if the last release was 3.1.2, then your changes probably belong in a 3.2-dev section). **Changelog entries are an exception to the Quilltap writing style.** Write them concisely, in straightforward American English words and spellings — the steampunk / Roaring Twenties / Wodehouse / Lemony Snicket voice we use for user-facing docs and UI does **not** apply to the changelog. Keep it terse and direct.
7. If you have not already done so, it is worth running the following commands before the commit just to be sure it won't trip you up:

    - `npm run lint`
    - `npx tsc`
    - `npm run test:unit`

8. If (and only if) either the Electron source or the Next.js source has changed in any way, run `scripts/update_version.sh` to update the version number of the application.
9. Please don't credit yourself in the commit message.
10. After this, you can commit.
