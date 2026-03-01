# Commit to Git

1. You must update the [changelog](../../docs/CHANGELOG.md) for **every** git commit; no exceptions. If this is in the "bugfix" column, then it belongs in the next release section (if the last release was 3.1.2 then your changes probably belong in a 3.1.3 section), otherwise put it in the next dev section (if the last release was 3.1.2, then your changes probably belong in a 3.2-dev section).
2. If you have not already done so, it is worth running the following commands before the commit just to be sure it won't trip you up:

- `npm run lint`
- `npx tsc`
- `npm run test:unit`

3. After this, you can commit. It will take a while, because it is also running the commands above plus a complete Next.js production build to be sure things will work.
