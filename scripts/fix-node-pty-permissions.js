#!/usr/bin/env node
// node-pty's macOS prebuilds ship spawn-helper without the executable bit on
// some installs (notably when extracted from npm cache via certain tools),
// which makes pty.spawn() fail with `posix_spawnp failed`. This walks the
// prebuild dirs and chmods anything that needs to be executable.
//
// Safe to run on Linux/Windows (no-op if path doesn't exist or chmod is
// meaningless on Windows).

const fs = require('node:fs');
const path = require('node:path');

const prebuildsDir = path.join(__dirname, '..', 'node_modules', 'node-pty', 'prebuilds');

if (!fs.existsSync(prebuildsDir)) {
  process.exit(0);
}

let entries;
try {
  entries = fs.readdirSync(prebuildsDir, { withFileTypes: true });
} catch {
  process.exit(0);
}

let fixed = 0;
for (const entry of entries) {
  if (!entry.isDirectory()) continue;
  const helper = path.join(prebuildsDir, entry.name, 'spawn-helper');
  if (!fs.existsSync(helper)) continue;
  try {
    fs.chmodSync(helper, 0o755);
    fixed++;
  } catch {
    // ignore — best-effort
  }
}

if (fixed > 0) {
  console.log(`[node-pty] ensured exec bit on ${fixed} spawn-helper binary(ies)`);
}
