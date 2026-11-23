/**
 * @jest-environment node
 *
 * The theme snapshot: what every custom property resolves to on <html> for
 * the default theme and each bundled theme, light and dark, compared with the
 * committed fixtures. This is the "no visual change" guard for Calliope Live
 * Spec A — a refactor of the theme CSS that moves any resolved value fails
 * here. "Moves" means renders differently: the same text with the same
 * colours (8-bit RGBA) is unchanged, so a literal re-expressed as an equal
 * formula passes. New names fail until recorded with
 * `npx tsx scripts/theme-snapshot.ts --add`; a change meant to alter values is
 * rewritten with `npx tsx scripts/theme-snapshot.ts` — read the diff.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { resolveRootVariables } from '@/lib/themes/snapshot/cascade';
import { THEME_TOKENS } from '@/lib/themes/registry';
import {
  rootStateFor,
  SNAPSHOT_FIXTURES_DIR,
  SNAPSHOT_MODES,
  THEME_TOKENS_CSS,
  appThemeNames,
  compareSnapshots,
  loadSnapshotThemes,
  snapshotFileName,
  snapshotTheme,
  type SnapshotTheme,
} from '@/lib/themes/snapshot/themes';

const REPO_ROOT = path.resolve(__dirname, '../../../..');

/** `@tailwindcss/node` registers module hooks Jest refuses, so compile in a plain Node child. */
function compileAppCss(): string {
  return execFileSync(process.execPath, [path.join(REPO_ROOT, 'scripts/lib/compile-app-css.mjs')], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
}

describe('theme snapshot', () => {
  let appCss: string;
  let themes: SnapshotTheme[];
  let appThemeVariables: Set<string>;

  beforeAll(async () => {
    appCss = compileAppCss();
    themes = await loadSnapshotThemes(REPO_ROOT);
    appThemeVariables = appThemeNames(readFileSync(path.join(REPO_ROOT, THEME_TOKENS_CSS), 'utf8'));
  }, 60_000);

  it('covers the default theme and the six bundled themes', () => {
    expect(themes.map((t) => t.id)).toEqual([
      'default',
      'art-deco',
      'earl-grey',
      'great-estate',
      'madmans-box',
      'old-school',
      'rains',
    ]);
  });

  it.each(
    ['default', 'art-deco', 'earl-grey', 'great-estate', 'madmans-box', 'old-school', 'rains'].flatMap((id) =>
      SNAPSHOT_MODES.map((mode) => [id, mode] as const)
    )
  )('%s (%s) resolves exactly as the fixture records', (id, mode) => {
    const theme = themes.find((t) => t.id === id);
    expect(theme).toBeDefined();
    const snapshot = snapshotTheme(appCss, theme!, mode, appThemeVariables);
    const fixture = JSON.parse(readFileSync(path.join(REPO_ROOT, SNAPSHOT_FIXTURES_DIR, snapshotFileName(id, mode)), 'utf8'));
    expect(snapshot.errors).toEqual(fixture.errors);
    expect(compareSnapshots(fixture.variables, snapshot.variables)).toEqual({ changed: [], added: [], removed: [] });
  });

  it.each(SNAPSHOT_MODES)('switches every density token with data-qt-density="comfortable" (default theme, %s)', (mode) => {
    const theme = themes.find((t) => t.id === 'default')!;
    const root = rootStateFor('default', mode);
    root.attributes['data-qt-density'] = 'comfortable';
    const { values } = resolveRootVariables([{ origin: 'app', css: appCss }, ...theme.sheets], root);
    const tokens = THEME_TOKENS.filter((t) => t.byChoice?.density?.comfortable !== undefined);
    expect(tokens.length).toBeGreaterThan(0);
    for (const token of tokens) expect([token.name, values[token.name]]).toEqual([token.name, token.byChoice!.density.comfortable]);
  });
});
