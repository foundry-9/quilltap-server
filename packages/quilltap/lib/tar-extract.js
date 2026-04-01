'use strict';

/**
 * Tar.gz extractor using the battle-tested `tar` package (npm's own).
 * Streams extraction directly from the .tar.gz file to disk.
 */

const tar = require('tar');

/**
 * Extract a .tar.gz file to the given directory.
 * @param {string} tarGzPath - Path to the .tar.gz file
 * @param {string} destDir - Directory to extract into
 * @returns {Promise<void>}
 */
function extractTarGz(tarGzPath, destDir) {
  return tar.x({
    file: tarGzPath,
    cwd: destDir,
    strip: 0,
  });
}

module.exports = { extractTarGz };
