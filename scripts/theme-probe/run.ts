/**
 * Theme probe — the driver (Calliope Live, Spec C 0.1, 0.2).
 *
 * Loads a fixed set of pages for each theme and colour mode in a headless
 * Chromium, runs ./probe.js on each, and writes one JSON file and one
 * screenshot per page:
 *
 *   npx tsx scripts/theme-probe/run.ts run --base http://localhost:3005 \
 *     --chat <chatId>[,<chatId>…] --character <characterId> --out .theme-probe/<label>
 *   npx tsx scripts/theme-probe/run.ts compare .theme-probe/<before> .theme-probe/<after>
 *
 * See ./README.md for what it needs (Playwright is not a dependency of the
 * repo) and how the pages are chosen. The driver switches the instance's theme
 * preference through the API and puts the original back when it finishes, so
 * point it only at a scratch instance.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { HOOKS } from '../../lib/themes/hooks';

type ProbeHook = { className: string; variants?: Array<{ attribute: string; values: readonly string[] | 'open' }>; states?: unknown[] };

interface ProbeResult {
  url: string;
  theme: string | null;
  mode: string | null;
  counts: Record<string, number>;
  elements: Record<string, Record<string, Record<string, string>>>;
}

interface PageSpec {
  name: string;
  path: string;
  /** Open the active theme's preview dialog from the Appearance card after load. */
  openPreviewDialog?: boolean;
}

const ALL_THEMES = ['default', 'art-deco', 'earl-grey', 'great-estate', 'madmans-box', 'old-school', 'rains'];
const MODES = ['light', 'dark'] as const;
const VIEWPORT = { width: 1440, height: 900 };
const SETTLE_MS = 2500;

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

/** `chats` is comma-separated: one Salon page each (`salon`, `salon-2`, …), for when no one chat shows every kind of row. */
function pagesFor(chats: string, character: string): PageSpec[] {
  return [
    { name: 'home', path: '/' },
    ...chats.split(',').map((id, i) => ({ name: i === 0 ? 'salon' : `salon-${i + 1}`, path: `/salon/${id}` })),
    { name: 'character', path: `/aurora/${character}` },
    { name: 'settings', path: '/settings?section=connection-profiles' },
    { name: 'dialog', path: '/settings?section=appearance', openPreviewDialog: true },
    { name: 'appearance', path: '/settings?section=appearance' },
  ];
}

/** Playwright is not a repo dependency: resolve it from PLAYWRIGHT_CORE (a directory) or normally. */
function loadPlaywright(): typeof import('playwright-core') {
  const from = process.env.PLAYWRIGHT_CORE;
  try {
    if (from) return createRequire(path.join(path.resolve(from), 'package.json'))('playwright-core');
    return createRequire(__filename)('playwright-core');
  } catch {
    console.error('playwright-core is not installed. Install it outside the repo and point PLAYWRIGHT_CORE at its node_modules parent (see scripts/theme-probe/README.md).');
    process.exit(2);
  }
}

async function run() {
  const base = arg('base') ?? 'http://localhost:3005';
  const chat = arg('chat');
  const character = arg('character');
  const out = arg('out');
  if (!chat || !character || !out) {
    console.error('run needs --chat <chatId> --character <characterId> --out <dir>');
    process.exit(2);
  }
  const themes = arg('themes')?.split(',') ?? ALL_THEMES;
  const modes = (arg('modes')?.split(',') as Array<(typeof MODES)[number]>) ?? MODES;
  const screens = !process.argv.includes('--no-screens');
  const probeSource = readFileSync(path.join(__dirname, 'probe.js'), 'utf8');
  const hooks: ProbeHook[] = HOOKS.map((h) => ({ className: h.className, variants: h.variants, states: h.states }));
  const pages = pagesFor(chat, character);
  mkdirSync(out, { recursive: true });

  const { chromium } = loadPlaywright();
  const browser = await chromium.launch();
  const api = async (method: 'GET' | 'PUT', body?: unknown) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(`${base}/api/health`);
    const result = await page.evaluate(
      async ([m, b]) => {
        const r = await fetch('/api/v1/user/profile?action=theme-preference', {
          method: m as string,
          headers: { 'Content-Type': 'application/json' },
          body: b === undefined ? undefined : JSON.stringify(b),
        });
        return { status: r.status, json: await r.json() };
      },
      [method, body] as const
    );
    await context.close();
    if (result.status >= 300) throw new Error(`theme-preference ${method} failed: ${result.status} ${JSON.stringify(result.json)}`);
    return result.json;
  };

  const themeOrder = await (async () => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(`${base}/api/v1/themes`);
    const json = JSON.parse(await page.innerText('body')) as { themes: Array<{ id: string; isDefault?: boolean }> };
    await context.close();
    return ['default', ...json.themes.filter((t) => !t.isDefault && t.id !== 'default').map((t) => t.id)];
  })();
  const original = (await api('GET')).data as { activeThemeId: string | null; colorMode: string };
  console.log(`original preference: ${original.activeThemeId ?? 'default'} / ${original.colorMode}`);
  try {
    for (const theme of themes) {
      for (const mode of modes) {
        await api('PUT', { activeThemeId: theme === 'default' ? null : theme, colorMode: mode });
        const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1, colorScheme: mode });
        const page = await context.newPage();
        for (const spec of pages) {
          const label = `${theme}.${mode}.${spec.name}`;
          // A dev server can still be compiling, or the provider still
          // fetching the preference: try a page up to three times.
          let result: ProbeResult | null = null;
          for (let attempt = 1; attempt <= 3 && !result; attempt++) {
            try {
              await page.goto(`${base}${spec.path}`, { waitUntil: 'load' });
              await page.waitForSelector(`html[data-theme="${theme}"][data-color-mode="${mode}"]`, { timeout: 30_000 });
              await page.evaluate(() => document.fonts.ready.then(() => undefined));
              await page.waitForTimeout(SETTLE_MS);
              if (spec.openPreviewDialog) {
                // Cards are in /api/v1/themes order, the default theme first.
                const index = Math.max(0, themeOrder.indexOf(theme));
                await page.getByRole('button', { name: 'Preview', exact: true }).nth(index).click();
                await page.waitForSelector('[role="dialog"], [role="alertdialog"]', { timeout: 10_000 });
                await page.waitForTimeout(800);
              }
              await page.addScriptTag({ content: probeSource });
              const probed = (await page.evaluate((h) => (window as unknown as { __qtThemeProbe: (o: unknown) => unknown }).__qtThemeProbe({ hooks: h }), hooks)) as ProbeResult;
              if (probed.theme === theme && probed.mode === mode && Object.keys(probed.elements).length > 10) result = probed;
              else console.log(`  ${label}: attempt ${attempt} saw ${probed.theme} / ${probed.mode}, ${Object.keys(probed.elements).length} elements; retrying`);
            } catch (error) {
              console.log(`  ${label}: attempt ${attempt} failed (${(error as Error).message.split('\n')[0]})`);
            }
          }
          if (!result) throw new Error(`${label}: no good probe after three attempts`);
          writeFileSync(path.join(out, `${label}.json`), `${JSON.stringify(result, null, 1)}\n`);
          if (screens) await page.screenshot({ path: path.join(out, `${label}.png`) });
          const matched = Object.values(result.counts).filter((n) => n > 0).length;
          console.log(`${label}: ${Object.keys(result.elements).length} elements measured, ${matched} selectors matched`);
        }
        await context.close();
      }
    }
  } finally {
    await api('PUT', { activeThemeId: original.activeThemeId, colorMode: original.colorMode });
    console.log('original preference restored');
    await browser.close();
  }
}

/** Compare two probe directories file by file. Exit 1 on any difference. */
function compare() {
  const [a, b] = process.argv.slice(3).filter((s) => !s.startsWith('--'));
  if (!a || !b) {
    console.error('compare needs two directories');
    process.exit(2);
  }
  const only = arg('themes')?.split(',');
  const files = readdirSync(a).filter((f) => f.endsWith('.json') && (!only || only.includes(f.split('.')[0])));
  let differing = 0;
  for (const file of files.sort()) {
    const other = path.join(b, file);
    if (!existsSync(other)) {
      console.log(`MISSING ${file} in ${b}`);
      differing++;
      continue;
    }
    const before = JSON.parse(readFileSync(path.join(a, file), 'utf8')) as ProbeResult;
    const after = JSON.parse(readFileSync(other, 'utf8')) as ProbeResult;
    const lines: string[] = [];
    for (const key of new Set([...Object.keys(before.counts), ...Object.keys(after.counts)])) {
      if ((before.counts[key] ?? 0) !== (after.counts[key] ?? 0)) lines.push(`  count ${key}: ${before.counts[key] ?? 0} -> ${after.counts[key] ?? 0}`);
    }
    for (const key of new Set([...Object.keys(before.elements), ...Object.keys(after.elements)])) {
      const x = before.elements[key];
      const y = after.elements[key];
      if (!x || !y) continue; // reported as a count change
      for (const part of new Set([...Object.keys(x), ...Object.keys(y)])) {
        const px = x[part] ?? {};
        const py = y[part] ?? {};
        for (const prop of new Set([...Object.keys(px), ...Object.keys(py)])) {
          if (px[prop] !== py[prop]) lines.push(`  ${key}${part === 'self' ? '' : `::${part}`} ${prop}: ${px[prop] ?? '(none)'} -> ${py[prop] ?? '(none)'}`);
        }
      }
    }
    if (lines.length > 0) {
      differing++;
      console.log(`DIFF ${file} (${lines.length})`);
      for (const line of lines) console.log(line);
    }
  }
  console.log(`\n${files.length} pages compared, ${differing} differ`);
  if (differing > 0) process.exit(1);
}

const command = process.argv[2];
if (command === 'run') {
  run().catch((error) => {
    console.error(error);
    process.exit(1);
  });
} else if (command === 'compare') {
  compare();
} else {
  console.error('usage: run.ts run --chat <id> --character <id> --out <dir> [--base <url>] [--themes a,b] [--modes light,dark] [--no-screens]\n       run.ts compare <dirA> <dirB> [--themes a,b]');
  process.exit(2);
}
