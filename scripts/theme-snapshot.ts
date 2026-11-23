/**
 * Theme snapshot — what every custom property resolves to on <html>, for
 * each theme (default + the bundles in themes/bundled) in light and dark.
 *
 *   npx tsx scripts/theme-snapshot.ts            # rewrite the fixtures from scratch
 *   npx tsx scripts/theme-snapshot.ts --check    # compare, exit 1 on a difference
 *   npx tsx scripts/theme-snapshot.ts --add      # add new names, keep every recorded value;
 *                                                # refuses if a recorded value now renders differently
 *
 * Fixtures: __tests__/unit/lib/themes/fixtures/snapshots/<theme>.<mode>.json.
 * The Jest test (__tests__/unit/lib/themes/theme-snapshot.test.ts) recomputes
 * and compares them; it is the "no visual change" guard for Calliope Live
 * Spec A. A value is unchanged when it renders alike — the same text with the
 * same colours (8-bit RGBA), so a literal re-expressed as an equal formula
 * passes. Rewrite only when a change is meant to alter values, and read the
 * diff.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import {
  SNAPSHOT_FIXTURES_DIR,
  SNAPSHOT_MODES,
  THEME_TOKENS_CSS,
  appThemeNames,
  compareSnapshots,
  loadSnapshotThemes,
  mergeAddedVariables,
  serialiseSnapshot,
  snapshotFileName,
  snapshotTheme,
  type ThemeSnapshot,
} from '../lib/themes/snapshot/themes';

const ROOT = path.resolve(__dirname, '..');

function compileAppCss(): string {
  return execFileSync(process.execPath, [path.join(ROOT, 'scripts/lib/compile-app-css.mjs')], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
}

async function main() {
  const mode = process.argv.includes('--check') ? 'check' : process.argv.includes('--add') ? 'add' : 'write';
  const appCss = compileAppCss();
  const themes = await loadSnapshotThemes(ROOT);
  const appThemeVariables = appThemeNames(readFileSync(path.join(ROOT, THEME_TOKENS_CSS), 'utf8'));
  const dir = path.join(ROOT, SNAPSHOT_FIXTURES_DIR);
  mkdirSync(dir, { recursive: true });

  let failing = 0;
  const writes: Array<[string, string]> = [];
  for (const theme of themes) {
    for (const colorMode of SNAPSHOT_MODES) {
      const snapshot = snapshotTheme(appCss, theme, colorMode, appThemeVariables);
      const file = path.join(dir, snapshotFileName(theme.id, colorMode));
      const label = `${theme.id}.${colorMode}`;
      const count = Object.keys(snapshot.variables).length;
      if (mode === 'write') {
        writes.push([file, serialiseSnapshot(snapshot)]);
        console.log(`write ${label}: ${count} variables, ${snapshot.errors.length} errors`);
      } else {
        const recorded: ThemeSnapshot | null = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null;
        const cmp = compareSnapshots(recorded?.variables ?? {}, snapshot.variables);
        const errorsChanged = JSON.stringify(recorded?.errors ?? []) !== JSON.stringify(snapshot.errors);
        const bad = cmp.changed.length > 0 || cmp.removed.length > 0 || errorsChanged || (mode === 'check' && cmp.added.length > 0);
        if (bad) failing++;
        console.log(
          `${bad ? 'DIFF' : 'ok  '} ${label}: ${count} variables, changed ${cmp.changed.length}, removed ${cmp.removed.length}, added ${cmp.added.length}${errorsChanged ? ', errors differ' : ''}`
        );
        for (const c of cmp.changed) console.log(`  changed ${c}`);
        for (const r of cmp.removed) console.log(`  removed ${r}`);
        if (mode === 'check') for (const a of cmp.added) console.log(`  added ${a}`);
        if (mode === 'add' && recorded && !bad) {
          writes.push([file, serialiseSnapshot({ ...snapshot, variables: mergeAddedVariables(recorded.variables, snapshot.variables) })]);
        }
      }
      for (const e of snapshot.errors) console.log(`  error ${e}`);
    }
  }
  if (failing > 0) {
    console.error(`\n${failing} snapshot(s) differ${mode === 'add' ? '; nothing written' : ''}.`);
    process.exit(1);
  }
  for (const [file, text] of writes) writeFileSync(file, text);
  if (mode === 'add') console.log(`\nadded new names to ${writes.length} fixture(s); recorded values kept`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
