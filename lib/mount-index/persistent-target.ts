/**
 * Persistent Target
 *
 * Answers one question for operations that write a store out to a directory
 * of the operator's choosing (deconvert, sync): "will what I write there
 * outlive this container?"
 *
 * Outside a container the answer is always yes. Inside one, a path that is not
 * under a bind mount or volume lives in the container's own writable layer
 * (overlay) or in a tmpfs. Writing there succeeds, the files are readable for
 * as long as the container lives, and they vanish without a trace when it is
 * recreated. Deconvert deletes the database copy after it writes, so a
 * deconvert to `/tmp/x` used to leave the store's only copy somewhere that the
 * next `--recreate` destroys.
 *
 * The check reads `/proc/self/mountinfo`, finds the mount that contains the
 * target (through its nearest existing ancestor, symlinks resolved), and
 * refuses when that mount is the container root or a memory filesystem.
 *
 * @module mount-index/persistent-target
 */

import fs from 'fs/promises';
import path from 'path';
import { createServiceLogger } from '@/lib/logging/create-logger';
import { isDockerEnvironment } from '@/lib/paths';

const logger = createServiceLogger('MountIndex:PersistentTarget');

const MOUNTINFO_PATH = '/proc/self/mountinfo';

/**
 * Filesystem types that never hold user data across a container's lifetime:
 * the container root's overlay, memory filesystems, and kernel pseudo-fs.
 */
const EPHEMERAL_FS_TYPES = new Set([
  'overlay',
  'tmpfs',
  'devtmpfs',
  'proc',
  'sysfs',
  'devpts',
  'mqueue',
  'cgroup',
  'cgroup2',
]);

export interface MountEntry {
  mountPoint: string;
  fsType: string;
}

export type PersistentTargetCheck =
  | { persistent: true }
  | {
      persistent: false;
      /** The mount that would hold the files. */
      mountPoint: string;
      fsType: string;
      /** Operator-facing explanation, safe to surface in the UI. */
      message: string;
    };

/** Error thrown when a write target would not survive the container. */
export class EphemeralTargetError extends Error {
  readonly targetPath: string;

  constructor(targetPath: string, message: string) {
    super(message);
    this.name = 'EphemeralTargetError';
    this.targetPath = targetPath;
  }
}

/** Undo the octal escapes mountinfo uses for space, tab, newline and backslash. */
function unescapeMountField(field: string): string {
  return field.replace(/\\([0-7]{3})/g, (_, oct: string) => String.fromCharCode(parseInt(oct, 8)));
}

/**
 * Parse `/proc/self/mountinfo`. Each line is
 * `id parent major:minor root mountPoint options [optional...] - fsType source superOptions`.
 */
export function parseMountInfo(text: string): MountEntry[] {
  const entries: MountEntry[] = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    const fields = line.split(' ');
    const separator = fields.indexOf('-');
    if (separator < 0 || fields.length < 5 || separator + 1 >= fields.length) continue;
    entries.push({
      mountPoint: unescapeMountField(fields[4]),
      fsType: fields[separator + 1],
    });
  }
  return entries;
}

/** The mount whose mount point is the longest prefix of `absPath` (the last one wins on ties, as the kernel stacks them). */
export function findContainingMount(mounts: MountEntry[], absPath: string): MountEntry | null {
  let best: MountEntry | null = null;
  for (const mount of mounts) {
    const mp = mount.mountPoint;
    const contains =
      mp === '/' || absPath === mp || absPath.startsWith(mp.endsWith('/') ? mp : `${mp}/`);
    if (!contains) continue;
    if (!best || mp.length >= best.mountPoint.length) best = mount;
  }
  return best;
}

/**
 * Resolve symlinks through the nearest existing ancestor, then re-append the
 * part that does not exist yet. A target under a symlinked directory belongs
 * to whatever mount the link points into.
 */
async function resolveThroughExistingAncestor(absPath: string): Promise<string> {
  const pending: string[] = [];
  let current = absPath;
  for (;;) {
    try {
      const real = await fs.realpath(current);
      return pending.length ? path.join(real, ...pending.reverse()) : real;
    } catch {
      const parent = path.dirname(current);
      if (parent === current) return absPath;
      pending.push(path.basename(current));
      current = parent;
    }
  }
}

/**
 * Report whether files written under `targetPath` will outlive this process's
 * container. Never throws; when the mount table can't be read it answers
 * "persistent" (and logs), since refusing every write on an unusual runtime
 * would be worse than the risk this guards.
 */
export async function checkPersistentTarget(
  targetPath: string,
  readMountInfo: () => Promise<string> = () => fs.readFile(MOUNTINFO_PATH, 'utf8')
): Promise<PersistentTargetCheck> {
  if (!isDockerEnvironment()) {
    return { persistent: true };
  }

  let mounts: MountEntry[];
  try {
    mounts = parseMountInfo(await readMountInfo());
  } catch (err) {
    logger.warn('Could not read the mount table; not checking target persistence', {
      targetPath,
      error: err instanceof Error ? err.message : String(err),
    });
    return { persistent: true };
  }

  const resolved = await resolveThroughExistingAncestor(path.resolve(targetPath));
  const mount = findContainingMount(mounts, resolved);
  if (!mount) {
    logger.warn('No mount contains the target; not checking target persistence', { targetPath, resolved });
    return { persistent: true };
  }

  const ephemeral = mount.mountPoint === '/' || EPHEMERAL_FS_TYPES.has(mount.fsType);
  logger.debug('Checked target persistence', {
    targetPath,
    resolved,
    mountPoint: mount.mountPoint,
    fsType: mount.fsType,
    ephemeral,
  });
  if (!ephemeral) {
    return { persistent: true };
  }

  return {
    persistent: false,
    mountPoint: mount.mountPoint,
    fsType: mount.fsType,
    message:
      `The path '${targetPath}' is inside the container itself, not on a bind mount, so anything ` +
      'written there is lost when the container is recreated. Choose a path under the data ' +
      'directory (/app/quilltap) or under a store that is bind-mounted from the host ' +
      "(see 'quilltap docs docker-mounts').",
  };
}

/**
 * Throw {@link EphemeralTargetError} when `targetPath` would not survive the
 * container. Call before writing a store out to an operator-chosen directory.
 */
export async function assertPersistentTarget(targetPath: string): Promise<void> {
  const check = await checkPersistentTarget(targetPath);
  if (check.persistent) return;

  logger.warn('Refusing write to a path inside the container layer', {
    targetPath,
    mountPoint: check.mountPoint,
    fsType: check.fsType,
  });
  throw new EphemeralTargetError(targetPath, check.message);
}
