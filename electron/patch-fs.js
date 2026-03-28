/**
 * Preload script that patches Node.js's fs module with graceful-fs.
 *
 * graceful-fs intercepts EMFILE ("too many open files") errors and queues
 * retries automatically. Used via NODE_OPTIONS="-r ./electron/patch-fs.js"
 * when running electron-builder on macOS, where codesigning walks thousands
 * of files in the .app bundle simultaneously.
 */
const realFs = require('fs');
const gracefulFs = require('graceful-fs');
gracefulFs.gracefulify(realFs);
