// Standalone-server bootstrap shim. Shared by the standalone tarball, the
// local Dockerfile, and the CI release workflow as `.next/standalone/server.js`.
//
// Why a shim: our custom server.ts (compiled to server-impl.js) calls into
// `next` to handle requests. Without `__NEXT_PRIVATE_STANDALONE_CONFIG` set,
// Next's loadWebpackHook throws because next/dist/compiled/webpack isn't traced
// into the standalone output. We populate it from the same
// .next/required-server-files.json that Next's own auto-generated server.js
// would have used, then hand off to server-impl.js.
//
// NODE_ENV=production keeps next() out of dev mode (which would try to load
// router-utils/setup-dev-bundler — also not traced into standalone).
'use strict';
process.env.NODE_ENV = 'production';
const fs = require('fs');
const path = require('path');

// node-pty (Ariel terminals) needs a `spawn-helper` executable sitting beside
// the pty.node it loads, or pty.spawn() dies with `posix_spawnp failed`. Two
// things break this in the standalone/Electron path and neither goes through
// bin/quilltap.js (so fix-node-pty-permissions.js never runs):
//   (a) tar/extract can drop the exec bit on the shipped prebuilds/*/spawn-helper.
//   (b) The launcher rebuilds node-pty for the runtime's Node ABI, which lands a
//       fresh build/Release/pty.node (node-pty's loader PREFERS build/Release over
//       prebuilds) but emits only the addon — not node-pty's separate spawn-helper
//       target. The helper then resolves to build/Release/spawn-helper, which is
//       absent. spawn-helper is a plain executable (no Node linkage), so the
//       prebuilt copy is ABI-independent and safe to reuse next to any pty.node.
// Best-effort and synchronous — must never block server startup.
function ensureSpawnHelper() {
  if (process.platform === 'win32') return; // conpty has no spawn-helper
  try {
    const nodePtyDir = path.join(__dirname, 'node_modules', 'node-pty');
    const prebuildsDir = path.join(nodePtyDir, 'prebuilds');
    const prebuiltHelper = path.join(prebuildsDir, `${process.platform}-${process.arch}`, 'spawn-helper');

    // (a) Restore the exec bit on every shipped prebuild helper.
    if (fs.existsSync(prebuildsDir)) {
      for (const entry of fs.readdirSync(prebuildsDir)) {
        const helper = path.join(prebuildsDir, entry, 'spawn-helper');
        if (fs.existsSync(helper)) {
          try { fs.chmodSync(helper, 0o755); } catch { /* best-effort */ }
        }
      }
    }

    // (b) Backfill build/Release|Debug with the prebuilt helper when an ABI
    // rebuild left a pty.node there without its spawn-helper sibling.
    for (const buildType of ['Release', 'Debug']) {
      const buildDir = path.join(nodePtyDir, 'build', buildType);
      const builtAddon = path.join(buildDir, 'pty.node');
      const builtHelper = path.join(buildDir, 'spawn-helper');
      if (fs.existsSync(builtHelper)) {
        try { fs.chmodSync(builtHelper, 0o755); } catch { /* best-effort */ }
      } else if (fs.existsSync(builtAddon) && fs.existsSync(prebuiltHelper)) {
        fs.copyFileSync(prebuiltHelper, builtHelper);
        fs.chmodSync(builtHelper, 0o755);
        console.log('[quilltap] node-pty: backfilled build/' + buildType + '/spawn-helper from prebuilds');
      }
    }
  } catch (err) {
    console.error('[quilltap] node-pty spawn-helper reconciliation skipped:', (err && err.message) || err);
  }
}
ensureSpawnHelper();

try {
  const cfgPath = path.join(__dirname, '.next', 'required-server-files.json');
  const requiredFiles = JSON.parse(fs.readFileSync(cfgPath, 'utf-8'));
  process.env.__NEXT_PRIVATE_STANDALONE_CONFIG = JSON.stringify(requiredFiles.config);
} catch (err) {
  console.error('[quilltap] Failed to load .next/required-server-files.json:', (err && err.message) || err);
  process.exit(1);
}
require('./server-impl.js');
