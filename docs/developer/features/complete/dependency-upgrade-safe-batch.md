# Dependency Upgrade — Safe Batch

**Status:** Implemented 2026-10-15
**Scope:** quilltap-server root `package.json` + lockfile; no `packages/`, `plugins/` or shell impact
**Companion:** [lexical-0.52-upgrade.md](lexical-0.52-upgrade.md) (separate, riskier; do this batch first)
**Research date:** 2026-10-14 (release notes and published tarballs read; nothing was installed or run)

## Summary

Bring every outdated dependency that carries no code-change risk to its latest version in one commit: the in-range `npm update` set, KaTeX 0.19, two lagging `@types/*` packages, and the removal of an unused dev dependency. Everything here was verified against release notes or a tarball diff; the only runtime library whose major changes we read closely is KaTeX, and none of its changes reach our code.

**Expected effort: 1–2 hours**, most of it the full test run.

## Goals

- Land every "free" upgrade so the next `npm outdated` shows only the deliberate holds listed below.
- Leave `npx tsc`, `npm run lint`, `npm run test:unit` and `npm run test:integration` green.
- Record the holds and their reasons so nobody re-researches them next month.

## Non-goals

- `better-sqlite3-multiple-ciphers` 13 (packaging rework, separate spec if pursued — see "Holds").
- Lexical 0.52 (companion spec).
- TypeScript 7, ESLint 10, `@types/node` 26, `pdfjs-dist` 6, `jest-fetch-mock` 4 (see "Holds").
- Unifying the two KaTeX copies via `overrides` (see "KaTeX" — offered as an optional step, off by default).

## Known state (verified 2026-10-14)

`npm outdated` on `main` at 7458ff94e:

| Package | Current | Latest | Action |
|---|---|---|---|
| `next`, `eslint-config-next` | 16.4.0 | 16.4.1 | in-range |
| `react`, `react-dom` | 19.3.0 | 19.3.1 | in-range |
| `@tanstack/react-query`, `-devtools`, `eslint-plugin-query` | 5.104.1 | 5.104.2 | in-range |
| `@tanstack/react-virtual` | 3.14.13 | 3.14.19 | in-range |
| `@playwright/test` | 1.63.0 | 1.64.1 | in-range |
| `@testing-library/user-event` | 14.6.7 | 14.6.8 | in-range |
| `openai` | 7.30.0 | 7.34.0 | in-range |
| `zod` | 4.6.5 | 4.6.7 | in-range |
| `postcss` | 8.5.29 | 8.5.30 | in-range |
| `react-syntax-highlighter` | 16.1.1 | 16.1.2 | in-range |
| `@types/node` | 24.19.1 | 24.19.2 (26.6.5 latest) | in-range only; **hold** on 26 |
| `katex` | 0.18.10 | 0.19.0 | **range edit** — `^0.18.9` can never reach 0.19 |
| `@types/better-sqlite3` | 7.6.13 | 9.6.0 | **range edit** — `index.d.ts` is byte-identical |
| `@types/yauzl` | 2.10.3 | 3.4.0 | **range edit** — `yauzl` itself is already `^3.4.0` |
| `@testing-library/jest-dom` | 6.9.1 | 7.0.1 | **range edit** — see notes |
| `dotenv` | 17.4.2 | 18.0.8 | **range edit** — see notes |
| `@vitest/mocker` | 4.1.11 | 5.0.4 | **remove** — unused |

## Steps

### 1. In-range updates

```bash
npm update
```

Confirm `package-lock.json` moved for every in-range row above and that `package.json` ranges are untouched. `npm update` honours the `overrides` block; `pdfjs-dist` must stay at its overridden `$pdfjs-dist` value (see Holds).

### 2. KaTeX 0.19

`package.json:88` → `"katex": "^0.19.0"`.

What 0.19.0 changes ([release notes](https://github.com/KaTeX/KaTeX/releases/tag/v0.19.0); both items first shipped in 0.18.11):

1. Missing character metrics now report through `strict` with code `symbolNotInFont` — a new warning, and a throw under `strict: "error"`.
2. A `strict` callback returning `undefined`/`null` now warns instead of being ignored (and no longer typechecks).

Why neither reaches us: **nothing in the codebase passes KaTeX options.** Every render site is a bare `rehypeKatex`:

- `lib/services/markdown-renderer.service.ts:110`
- `components/chat/MessageContent.tsx:544`
- `components/help-chat/HelpTopicReader.tsx:246`
- `components/files/FilePreview/FilePreviewText.tsx:572`

Packaging is unchanged: `exports`, `main`, `contrib/*` subpaths, `dist/katex.min.css` (version string aside) and the font file names are identical between 0.18.10 and 0.19.0 (tarball diff). `src/symbols.ts`, which `scripts/generate-unicode-index.ts:47` imports from `../node_modules/katex/src/symbols`, is byte-identical, so the generated Unicode index does not change. No test imports `katex`; `MessageContent.test.tsx:11-12` mocks `remark-math` and `rehype-katex`. `jest.config.ts` needs no `transformIgnorePatterns` / `moduleNameMapper` change. No `packages/`, `plugins/` or theme declares katex.

**Already true today, worth knowing:** our top-level `katex` renders nothing. `rehype-katex@7.0.1` (latest) and `remark-math` (via `micromark-extension-math`) both depend on `katex ^0.16.0`, so `npm ls katex` shows a nested `katex@0.16.47` doing the actual HTML. The top-level copy only supplies `app/layout.tsx:6`'s CSS import and the symbol table above. The upgrade widens an existing CSS-vs-HTML version gap (0.19 CSS on 0.16 HTML) without changing anything the CSS depends on.

**Optional, off by default:** add an `overrides` entry to collapse onto one copy. It must use the `"$katex"` form (see [[project_npm_overrides_dollar_name]] — a literal version wedges `npm install` with `EOVERRIDE`). This exposes rendering to the two `strict` changes above (only `symbolNotInFont` warnings are plausible, since rehype-katex passes no callback) and is untested against rehype-katex's `^0.16.0` range. Skip unless a rendering bug motivates it; if done, give it its own commit so it can be reverted alone.

### 3. `@types/*` and `@testing-library/jest-dom`

- `package.json:75` → `"@types/yauzl": "^3.4.0"` (matches the runtime `yauzl` range at line 116).
- `@types/better-sqlite3` → `^9.6.0`. The published `index.d.ts` is byte-identical to 7.6.13's; this is a version-number-only alignment with better-sqlite3 9.x upstream. Note for a future `better-sqlite3-multiple-ciphers` 13 attempt: 13.0.3's own `index.d.ts` is **not** picked up (its `exports` map has no `types` entry); 13.0.4-beta adds one, after which the bundled types would win over `@types/`.
- `@testing-library/jest-dom` → `^7.0.1`. Engines `node >=22`; peers `@testing-library/dom >=10 <11` (we satisfy) and `vitest >=0.32` **marked optional**. Our single import is `jest.setup.ts:1` (`import '@testing-library/jest-dom'`). If the 7.0 changelog turns out to drop a matcher we use, revert this one line and note it under Holds — do not spend time porting.

### 4. `dotenv` 18

`package.json:140` → `"dotenv": "^18.0.8"`. Engines `node >=12`. Three callers only: `playwright.config.ts`, `scripts/migrate-to-single-user.ts`, `scripts/fix-api-keys.ts`. Run `npx playwright test --list` after installing to prove the config still loads; the two scripts are one-off migration tools and need only `npx tsc` to pass.

### 5. Remove `@vitest/mocker`

- `package.json:137` — delete the line.
- `knip.json` `ignoreDependencies` — delete the `"@vitest/mocker"` entry (it is there precisely because nothing imports it; the ignore was added in 2.8.0, the dependency in 2.6.0).

Verification: `grep -rn "vitest" --include=*.ts --include=*.tsx --include=*.js --include=*.mjs . | grep -v node_modules` must return nothing outside `package-lock.json`, and `npm ls @vitest/mocker` must report it as a top-level dep with no dependents before removal. Both were true on 2026-10-14. If `npx knip` is part of your check, it should now be quieter, not noisier.

### 6. Install and verify

```bash
npm install
npx tsc
npm run lint
npm run test:unit
npm run test:integration
npx playwright test --list
```

Then a visual check of one Salon message containing `$\sqrt{x}$` and a display block on the V4test instance (`~/iCloud/Quilltap/V4test`, dev on :3005 — never Friday) to confirm the KaTeX CSS still lays out.

### 7. Record

- `docs/CHANGELOG.md` under `### 4.11-dev`, plain voice: one bullet listing the bumps and the `@vitest/mocker` removal.
- No `help/*.md` change — nothing user-visible.

## Holds (do not upgrade; reasons recorded so they are not re-researched)

| Package | Latest | Why held |
|---|---|---|
| `typescript` 5.9.3 | 7.0.2 | `typescript-eslint` 8.71.x peer is `>=4.8.4 <6.1.0`; it arrives via `eslint-config-next`, so we wait for Next. |
| `eslint` 9.39.5 | 10.12.0 | `eslint-plugin-import`, `-react`, `-jsx-a11y` (pulled in by `eslint-config-next`) peer on `^9` at most. `@tanstack/eslint-plugin-query`, `eslint-plugin-react-hooks` and `typescript-eslint` are already `^10`-ready; the three above are the blockers. |
| `@types/node` 24.x | 26.6.5 | Runtime is Node 24 (`engines.node >=24`); keep types matched to the runtime major. |
| `pdfjs-dist` 5.7.284 | 6.4.299 | `pdf-parse@2.4.5` pins `pdfjs-dist 5.4.296`; we already `override` it to `$pdfjs-dist` (5.7). A 6.x jump needs `pdf-parse` to move first, plus a `scripts/sync-pdf-worker.js` / `__tests__/unit/pdf-worker-version.test.ts` check. |
| `jest-fetch-mock` 3.2.0 | 4.2.0 | Not researched; six test files use it. Cheap to try later as its own change. |
| `better-sqlite3-multiple-ciphers` 12.11.1 | 13.0.3 | **Data is safe** (cipher defaults byte-identical; API additions only) but **packaging breaks**: v13 ships Node-API prebuilds at `prebuilds/<platform>-<arch>.node`, drops `prebuild-install`, and builds nothing on install. Every `build/Release/better_sqlite3.node` assumption fails: `packages/quilltap/lib/native-modules.js:30` and `:103-139` (the ABI heal would run and fail on every CLI start), `jest.global-setup.js:48-68`, `__tests__/unit/packages/quilltap/native-rebuild.test.js`, and quilltap-shell's `scripts/rebuild-native-modules.ts:142-216` (Electron release breaks). Linux prebuilds need glibc ≥ 2.35 with no source fallback — Ubuntu 20.04 / Debian 11 / RHEL 8 / Amazon Linux 2 users would be unable to open their database. ~7–10 h. Needs its own spec and a shell-repo change in lockstep. |

## Acceptance

- `npm outdated` lists only the Holds rows.
- `npx tsc`, `npm run lint`, `npm run test:unit`, `npm run test:integration` pass.
- `npm ls katex` still shows the nested 0.16.47 under `rehype-katex` (unless the optional override was taken, in which case it shows one copy).
- KaTeX renders in a Salon message on V4test.
- `package.json` has no `@vitest/mocker`; `knip.json` has no ignore for it.

## As built (2026-10-15)

- Done as specified; the optional KaTeX `overrides` was **not** taken. `npm ls katex` shows top-level 0.19.0 with 0.16.47 nested under `rehype-katex` and `micromark-extension-math`.
- In-range versions had moved a little since research: `next` / `eslint-config-next` 16.4.2, TanStack Query 5.104.3, `@tanstack/react-virtual` 3.14.20.
- `npm outdated` now lists only the Holds rows plus Lexical (companion spec).
- `npx tsc`, `npm run lint`, `npm run test:unit` (1112 suites, 16285 tests), `npm run test:integration` (24 suites, 267 tests) and `npx playwright test --list` (26 tests) all pass. `@testing-library/jest-dom` 7 needed no revert.
- Visual check on V4test (:3005): no LLM call was made; instead the exact HTML `rehype-katex`'s KaTeX 0.16.47 produces for a display-mode `\sum_{i=1}^{n} \frac{a_i}{b^2}` was injected into the live app page under its bundled 0.19 CSS. It laid out correctly and `KaTeX_Main` / `KaTeX_Math` / `KaTeX_Size2` loaded.
