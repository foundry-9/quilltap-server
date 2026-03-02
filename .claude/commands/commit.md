# Commit to Git

1. Last chance to verify that, if the commit contains changes to a data model that shows up in backup/restore or import/export, we have covered that possibility in backup/restore and import/export
2. Last chance to verify that, if the commit contains changes to a front-end user interface component, that we have not introduced more direct usage of Tailwind classes as opposed to creating or using appropriate `qt-*` theme utility classes
3. You must update the [changelog](../../docs/CHANGELOG.md) for **every** git commit; no exceptions. If this is in the "bugfix" column, then it belongs in the next release section (if the last release was 3.1.2 then your changes probably belong in a 3.1.3 section), otherwise put it in the next dev section (if the last release was 3.1.2, then your changes probably belong in a 3.2-dev section).
4. If you have not already done so, it is worth running the following commands before the commit just to be sure it won't trip you up:

- `npm run lint`
- `npx tsc`
- `npm run test:unit`

5. After this, you can commit. It will take a while, because it is also running the commands above plus a complete Next.js production build to be sure things will work.
