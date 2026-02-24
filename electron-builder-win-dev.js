// Unsigned Windows dev build config
// Loads the base electron-builder.yml and removes code signing options
const { readFileSync } = require('fs');
const { join } = require('path');
const yaml = require('js-yaml'); // available via electron-builder's dependencies

const base = yaml.load(readFileSync(join(__dirname, 'electron-builder.yml'), 'utf8'));

// Remove code signing for local dev builds
delete base.win.azureSignOptions;
delete base.afterSign;

module.exports = base;
