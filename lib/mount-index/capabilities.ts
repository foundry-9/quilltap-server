/**
 * Derived per-mount capability flags.
 *
 * The file-manager UI needs to know, *per mount*, which verbs it may offer
 * before it renders them — hide "paste" on a read-only mount, disable
 * "convert" while a conversion is in flight, gate the light (navigate-only)
 * costume, and so on. Today the only way to know is to re-derive that from
 * `mountType` / `conversionStatus` / `enabled` on the client, which scatters
 * the policy across every consumer and lets the heavy and light costumes
 * drift apart.
 *
 * This module is the single server-side source of truth. `deriveMountCapabilities`
 * is a pure function of a `DocMountPoint` (no I/O, no logging) so it is trivially
 * unit-testable; the GET single-mount route folds its result into the response
 * as a derived, non-persisted `capabilities` block. Nothing here touches the
 * database schema — there is no DDL/export impact.
 *
 * @module mount-index/capabilities
 */

import type { DocMountPoint } from '@/lib/schemas/mount-index.types';

/**
 * What a given mount currently allows. Every flag is derived; none is persisted.
 *
 * `canMoveIn` / `canMoveOut` are split deliberately: the heavy costume's
 * cross-pane copy/paste gates each pane independently — a mount mid-conversion
 * must refuse being a paste *destination* even though, in principle, it could
 * still serve as a read *source*. We keep both conservative for v1 (see below)
 * and can relax `canMoveOut` later if a use case demands it.
 */
export interface MountCapabilities {
  /** Upload / save / write into this mount. */
  canWrite: boolean;
  /** Delete files or folders in this mount. */
  canDelete: boolean;
  /** Create new folders in this mount. */
  canCreateFolder: boolean;
  /** This mount may be the *destination* of a copy/move. */
  canMoveIn: boolean;
  /** This mount may be the *source* of a copy/move. */
  canMoveOut: boolean;
  /** Offer the convert (fs→db) or deconvert (db→fs) action right now. */
  canConvert: boolean;
}

/**
 * Derive the capability flags for a mount from its current state.
 *
 * Rules:
 * - A mount mid-conversion (`conversionStatus` of `converting` / `deconverting`)
 *   is quiesced: no writes, deletes, folder creates, or move/copy in either
 *   direction, and no fresh conversion may be kicked off.
 * - A disabled mount allows nothing.
 * - `canConvert` additionally refuses while a scan is running, mirroring the
 *   guards already enforced server-side in `handleConvert` / `handleDeconvert`.
 *
 * When a persisted per-mount read-only flag lands later (currently deferred),
 * thread it through here as an additional `&& !mp.readOnly` — this stays the
 * one place the policy lives.
 */
export function deriveMountCapabilities(mp: DocMountPoint): MountCapabilities {
  const midConversion =
    mp.conversionStatus === 'converting' || mp.conversionStatus === 'deconverting';
  const quiescent = mp.enabled && !midConversion;

  return {
    canWrite: quiescent,
    canDelete: quiescent,
    canCreateFolder: quiescent,
    canMoveIn: quiescent,
    canMoveOut: quiescent,
    canConvert: quiescent && mp.scanStatus !== 'scanning',
  };
}
