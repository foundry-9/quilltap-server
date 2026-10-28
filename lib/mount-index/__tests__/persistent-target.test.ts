/**
 * @jest-environment node
 *
 * Persistent target — the check that stops deconvert and sync from writing a
 * store into the container's own layer.
 *
 * The bug this guards: under Docker, deconvert to `/tmp/qt-deconvert-test`
 * succeeded, deleted the database copy, and left the store's only copy in the
 * container's overlay, where the next `--recreate` destroyed it.
 */

import { promises as realFs } from 'fs';
import os from 'os';
import path from 'path';
import {
  parseMountInfo,
  findContainingMount,
  checkPersistentTarget,
} from '../persistent-target';
import { isDockerEnvironment } from '@/lib/paths';

jest.mock('@/lib/paths', () => ({
  isDockerEnvironment: jest.fn(() => true),
}));

const mockIsDocker = isDockerEnvironment as jest.Mock;

/** Trimmed from a real Docker Desktop (macOS) container. */
const DOCKER_DESKTOP_MOUNTINFO = [
  '134 94 0:53 / / rw,relatime - overlay overlay rw,lowerdir=/x,upperdir=/y,workdir=/z',
  '136 134 0:62 / /proc rw,nosuid,nodev,noexec,relatime - proc proc rw',
  '137 134 0:63 / /dev rw,nosuid - tmpfs tmpfs rw,size=65536k,mode=755',
  '142 137 0:66 / /dev/shm rw,nosuid,nodev,noexec,relatime - tmpfs shm rw,size=65536k',
  '143 134 0:43 /csebold/Library/Mobile\\040Documents/Quilltap/V4test /app/quilltap rw,nosuid,nodev,relatime - virtiofs virtiofs0 rw',
  '150 134 0:43 /csebold/Vaults/My\\040Notes /Users/csebold/Vaults/My\\040Notes rw,relatime - virtiofs virtiofs0 rw',
  '144 134 254:1 /docker/containers/abc/hostname /etc/hostname rw,relatime - ext4 /dev/vda1 rw,discard',
  '160 134 0:70 / /scratch rw,relatime - tmpfs tmpfs rw',
  '170 134 254:1 /docker/srv/qtvol/_data /srv/qtvol rw,relatime shared:1 - ext4 /dev/vda1 rw',
  '',
].join('\n');

const readDockerMounts = () => Promise.resolve(DOCKER_DESKTOP_MOUNTINFO);

beforeEach(() => {
  jest.clearAllMocks();
  mockIsDocker.mockReturnValue(true);
});

describe('parseMountInfo', () => {
  it('reads mount points and filesystem types, unescaping spaces', () => {
    const mounts = parseMountInfo(DOCKER_DESKTOP_MOUNTINFO);
    expect(mounts).toContainEqual({ mountPoint: '/', fsType: 'overlay' });
    expect(mounts).toContainEqual({ mountPoint: '/app/quilltap', fsType: 'virtiofs' });
    expect(mounts).toContainEqual({ mountPoint: '/Users/csebold/Vaults/My Notes', fsType: 'virtiofs' });
  });

  it('finds the filesystem type after optional fields', () => {
    const mounts = parseMountInfo(DOCKER_DESKTOP_MOUNTINFO);
    expect(mounts).toContainEqual({ mountPoint: '/srv/qtvol', fsType: 'ext4' });
  });

  it('skips malformed lines', () => {
    expect(parseMountInfo('garbage\n\n1 2 3')).toEqual([]);
  });
});

describe('findContainingMount', () => {
  const mounts = parseMountInfo(DOCKER_DESKTOP_MOUNTINFO);

  it('picks the longest containing mount point', () => {
    expect(findContainingMount(mounts, '/app/quilltap/stores/x')?.mountPoint).toBe('/app/quilltap');
  });

  it('does not treat a sibling with a shared prefix as contained', () => {
    expect(findContainingMount(mounts, '/app/quilltap-other/x')?.mountPoint).toBe('/');
  });

  it('matches the mount point itself', () => {
    expect(findContainingMount(mounts, '/app/quilltap')?.mountPoint).toBe('/app/quilltap');
  });
});

describe('checkPersistentTarget', () => {
  it('refuses a path in the container root overlay', async () => {
    const check = await checkPersistentTarget('/tmp/qt-deconvert-test', readDockerMounts);
    expect(check.persistent).toBe(false);
    if (!check.persistent) {
      expect(check.mountPoint).toBe('/');
      expect(check.message).toContain('lost when the container is recreated');
    }
  });

  it('refuses a path on a tmpfs', async () => {
    const check = await checkPersistentTarget('/scratch/out', readDockerMounts);
    expect(check).toMatchObject({ persistent: false, fsType: 'tmpfs' });
  });

  it('accepts a path under the data directory bind', async () => {
    expect(await checkPersistentTarget('/app/quilltap/exports/store', readDockerMounts))
      .toEqual({ persistent: true });
  });

  it('accepts a path under a path-identical host bind with a space in it', async () => {
    expect(await checkPersistentTarget('/Users/csebold/Vaults/My Notes/out', readDockerMounts))
      .toEqual({ persistent: true });
  });

  it('accepts a named volume', async () => {
    expect(await checkPersistentTarget('/srv/qtvol/store', readDockerMounts))
      .toEqual({ persistent: true });
  });

  it('is a no-op outside a container', async () => {
    mockIsDocker.mockReturnValue(false);
    const read = jest.fn();
    expect(await checkPersistentTarget('/tmp/anything', read)).toEqual({ persistent: true });
    expect(read).not.toHaveBeenCalled();
  });

  it('fails open when the mount table cannot be read', async () => {
    const check = await checkPersistentTarget('/tmp/x', () => Promise.reject(new Error('EACCES')));
    expect(check).toEqual({ persistent: true });
  });

  it('judges a symlinked directory by where it points', async () => {
    // A link that lives "on the bind" but points into the overlay must be refused.
    const dir = await realFs.mkdtemp(path.join(os.tmpdir(), 'qt-persist-'));
    try {
      const realDir = await realFs.realpath(dir);
      const target = path.join(realDir, 'real');
      await realFs.mkdir(target);
      const link = path.join(realDir, 'link');
      await realFs.symlink(target, link);
      const mountinfo = [
        '1 0 0:1 / / rw - overlay overlay rw',
        `2 1 0:2 / ${link} rw - virtiofs virtiofs0 rw`,
      ].join('\n');

      const check = await checkPersistentTarget(path.join(link, 'new-store'), () => Promise.resolve(mountinfo));
      expect(check.persistent).toBe(false);
    } finally {
      await realFs.rm(dir, { recursive: true, force: true });
    }
  });
});
