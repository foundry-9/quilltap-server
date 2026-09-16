/**
 * The one list of image quality tiers, and the one Zod schema over it.
 *
 * Four places validate or offer a quality tier — the `generate_image` tool
 * schema, `POST /api/v1/images?action=generate`,
 * `POST /api/v1/image-profiles/[id]?action=generate`, and the profile editor —
 * and before this module existed the first three each spelled the union out for
 * themselves. Two of them were still carrying DALL·E's `'standard' | 'hd'` after
 * the GPT Image tiers arrived, so a profile could store `max` and the HTTP
 * routes would reject it at the door.
 *
 * The host never interprets the value: it stores it, forwards it, and lets the
 * provider plugin validate the subset its selected model actually supports
 * (OpenAI's table is `plugins/dist/qtap-plugin-openai/image-models.ts`). So this
 * list is deliberately the *sum* of what the plugins accept, and the compile-time
 * assertions below pin it to `ImageGenParams['quality']` in both directions —
 * adding a tier to the shared type without adding it here, or vice versa, is a
 * type error rather than another silent rejection.
 *
 * @module lib/image-gen/quality
 */

import { z } from 'zod';
import type { ImageGenParams } from '@quilltap/plugin-types';

/**
 * Every tier any provider accepts.
 *
 * - `auto` / `low` / `medium` / `high` — the GPT Image spelling.
 * - `xhigh` / `max` — the premium tiers GPT Image 2.5 added.
 * - `standard` / `hd` — the DALL·E spelling.
 */
export const IMAGE_QUALITY_VALUES = [
  'auto',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
  'standard',
  'hd',
] as const;

export type ImageQuality = (typeof IMAGE_QUALITY_VALUES)[number];

/** Zod enum over {@link IMAGE_QUALITY_VALUES}, for request and tool schemas. */
export const imageQualitySchema = z.enum(IMAGE_QUALITY_VALUES);

// ---------------------------------------------------------------------------
// Drift guards. `Assert<A, B>` only compiles when A is assignable to B, so the
// pair below fails to build if this list and the shared type stop being the
// same set — in either direction.
// ---------------------------------------------------------------------------

type Assert<A extends B, B> = A;
type SharedQuality = NonNullable<ImageGenParams['quality']>;

/** Every value here is one the shared type allows. */
type _NoExtraTiers = Assert<ImageQuality, SharedQuality>;
/** Every value the shared type allows appears here. */
type _NoMissingTiers = Assert<SharedQuality, ImageQuality>;
