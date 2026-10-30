/**
 * Custom-tool run presets — where they are found.
 *
 * A preset (`Tools/{toolname}.{preset}.settings.json`, naming contract in
 * `./tool-presets.ts`) is found by the same walk that finds definitions: the
 * invoker's own vault, then their groups' stores, then the project's, then
 * Quilltap General, nearest first. A nearer preset of the same name shadows a
 * farther one, exactly as a nearer `.tool.json` shadows a farther definition.
 * A personal "aggressive" therefore overrides the table's shared one without
 * touching it.
 *
 * The walk also names every store in that order as a place a preset may be
 * filed, so the run dialog can offer a save destination without re-deriving
 * the tiers on the client.
 *
 * Fresh on every call, for the same reason the roster is (see the freshness
 * note atop `./custom-tools.ts`): the files live in stores the user edits.
 */

import { logger } from '@/lib/logger';
import { getErrorMessage } from '@/lib/error-utils';
import { getRepositories } from '@/lib/repositories/factory';
import { resolveTieredMountPool, type MountTier } from '@/lib/mount-index/tiered-mount-pool';
import { listToolsFolderFiles, orderedMounts } from './custom-tools';
import { parsePresetFromPath } from './tool-presets';

const CONTEXT = 'pascal.tool-preset-pool';

/** A store a preset may be read from or filed in. */
export interface ToolPresetStore {
  tier: MountTier;
  mountPointId: string;
  mountName: string;
}

/** One preset that won its name, with the store it came from. */
export interface ToolPreset extends ToolPresetStore {
  /** The preset name — the `{preset}` segment of the filename. */
  name: string;
  /** Vault-relative path of the file in its store. */
  path: string;
  /** Farther stores holding a preset of the same name, nearest first. */
  shadows: ToolPresetStore[];
}

export interface ToolPresetPool {
  /** The winning preset per name, sorted by name. */
  presets: ToolPreset[];
  /** Every enabled store on the walk, nearest first — the save destinations. */
  stores: ToolPresetStore[];
  /** Stores whose `Tools/` folder could not be listed. Their presets are missing, not absent. */
  unread: Array<ToolPresetStore & { reason: string }>;
}

/** Whose walk, and for which tool. */
export interface ToolPresetPoolContext {
  userId: string;
  characterId?: string | null;
  characterMountPointId?: string | null;
  projectId?: string | null;
  toolName: string;
}

/**
 * Resolve one tool's presets for one invoker. Never throws: a store that will
 * not list is reported in `unread` and skipped, so one broken folder does not
 * take every other preset with it.
 */
export async function resolveToolPresetPool(ctx: ToolPresetPoolContext): Promise<ToolPresetPool> {
  // Same pool, same options as `resolveCustomToolRoster`: no participant tier,
  // since another character's vault is theirs alone.
  const pool = await resolveTieredMountPool({
    userId: ctx.userId,
    characterId: ctx.characterId ?? null,
    characterMountPointId: ctx.characterMountPointId ?? null,
    projectId: ctx.projectId ?? null,
  });

  const repos = getRepositories();
  const byName = new Map<string, ToolPreset>();
  const stores: ToolPresetStore[] = [];
  const unread: ToolPresetPool['unread'] = [];

  for (const { tier, mountPointId } of orderedMounts(pool)) {
    const mount = await repos.docMountPoints.findById(mountPointId);
    if (!mount || !mount.enabled) continue;

    const store: ToolPresetStore = { tier, mountPointId, mountName: mount.name };
    stores.push(store);

    let paths: string[];
    try {
      paths = await listToolsFolderFiles(mount);
    } catch (error) {
      logger.warn('Preset listing failed for store', {
        context: CONTEXT,
        mountPointId,
        mountName: mount.name,
        error: getErrorMessage(error),
      });
      unread.push({ ...store, reason: getErrorMessage(error) });
      continue;
    }

    for (const relativePath of paths) {
      const name = parsePresetFromPath(ctx.toolName, relativePath);
      if (name === null) continue;

      const nearer = byName.get(name);
      if (nearer) {
        nearer.shadows.push(store);
        continue;
      }
      byName.set(name, { ...store, name, path: relativePath, shadows: [] });
    }
  }

  const presets = [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));

  logger.debug('Tool presets resolved', {
    context: CONTEXT,
    toolName: ctx.toolName,
    characterId: ctx.characterId ?? null,
    stores: stores.length,
    presets: presets.length,
    shadowed: presets.reduce((n, p) => n + p.shadows.length, 0),
    unread: unread.length,
  });

  return { presets, stores, unread };
}
