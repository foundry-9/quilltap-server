'use strict';

/**
 * Where an instance lives when nothing says otherwise.
 *
 * The CLI's mirror of the server's platform default (lib/paths.ts). Inside the
 * Docker image the instance is always the bind mount at /app/quilltap, and the
 * `nextjs` user has no home directory, so falling through to `~/.quilltap`
 * sent `docker exec quilltap quilltap db …` to a database that does not exist
 * and reported "no instance lock" while the server held one.
 *
 * Docker detection matches the server's lock-environment check
 * (DOCKER_CONTAINER or /.dockerenv), deliberately without the server's
 * "/app exists" heuristic, which misfires on hosts that happen to have /app.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const DOCKER_BASE_DIR = '/app/quilltap';

function isDockerContainer() {
  if (process.env.DOCKER_CONTAINER === 'true') return true;
  try {
    return fs.existsSync('/.dockerenv');
  } catch {
    return false;
  }
}

/** The instance root used when no flag, env var or registered instance names one. */
function getDefaultBaseDir() {
  if (isDockerContainer()) return DOCKER_BASE_DIR;
  const home = os.homedir();
  if (process.platform === 'darwin') return path.join(home, 'Library', 'Application Support', 'Quilltap');
  if (process.platform === 'win32') return path.join(process.env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'Quilltap');
  return path.join(home, '.quilltap');
}

module.exports = {
  DOCKER_BASE_DIR,
  isDockerContainer,
  getDefaultBaseDir,
};
