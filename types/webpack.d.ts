/**
 * Webpack/Turbopack bundler globals for dynamic module loading
 *
 * __non_webpack_require__ is a magic global provided by webpack that gives
 * access to Node.js native require, bypassing bundler static analysis.
 * This is used for dynamic plugin loading where modules are loaded at runtime.
 */

declare const __non_webpack_require__: NodeRequire | undefined;
