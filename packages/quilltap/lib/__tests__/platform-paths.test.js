/**
 * Platform default instance root, including the Docker case.
 *
 * The bug this guards: inside the Docker image `quilltap db --lock-status`
 * fell through to `~/.quilltap` (a home directory the image never creates),
 * reported "No instance lock found" while the server held one, and
 * `db --tables` reported a missing database.
 *
 * @jest-environment node
 */

'use strict';

const os = require('os');
const path = require('path');

const { getDefaultBaseDir, isDockerContainer, DOCKER_BASE_DIR } = require('../platform-paths');
const { resolveDataDir } = require('../db-helpers');

const savedEnv = { ...process.env };

afterEach(() => {
  process.env = { ...savedEnv };
});

describe('platform default instance root', () => {
  it('is /app/quilltap inside the Docker image', () => {
    process.env.DOCKER_CONTAINER = 'true';
    expect(isDockerContainer()).toBe(true);
    expect(getDefaultBaseDir()).toBe(DOCKER_BASE_DIR);
  });

  it('is the per-OS location outside a container', () => {
    delete process.env.DOCKER_CONTAINER;
    if (isDockerContainer()) return; // the suite itself is running in a container
    const expected = process.platform === 'darwin'
      ? path.join(os.homedir(), 'Library', 'Application Support', 'Quilltap')
      : process.platform === 'win32'
        ? path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'Quilltap')
        : path.join(os.homedir(), '.quilltap');
    expect(getDefaultBaseDir()).toBe(expected);
  });
});

describe('resolveDataDir', () => {
  it('defaults to the Docker data directory inside the image', () => {
    process.env.DOCKER_CONTAINER = 'true';
    delete process.env.QUILLTAP_DATA_DIR;
    expect(resolveDataDir()).toBe('/app/quilltap/data');
  });

  it('still lets QUILLTAP_DATA_DIR win inside the image', () => {
    process.env.DOCKER_CONTAINER = 'true';
    process.env.QUILLTAP_DATA_DIR = '/elsewhere';
    expect(resolveDataDir()).toBe(path.join('/elsewhere', 'data'));
  });

  it('still lets an explicit override win', () => {
    process.env.DOCKER_CONTAINER = 'true';
    expect(resolveDataDir('/explicit')).toBe(path.join('/explicit', 'data'));
  });
});
