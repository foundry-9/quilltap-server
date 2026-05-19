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
try {
  const cfgPath = path.join(__dirname, '.next', 'required-server-files.json');
  const requiredFiles = JSON.parse(fs.readFileSync(cfgPath, 'utf-8'));
  process.env.__NEXT_PRIVATE_STANDALONE_CONFIG = JSON.stringify(requiredFiles.config);
} catch (err) {
  console.error('[quilltap] Failed to load .next/required-server-files.json:', (err && err.message) || err);
  process.exit(1);
}
require('./server-impl.js');
