/**
 * `patchSchemaOf` — the write-side shape of a settings or record schema.
 *
 * Zod 4's `.partial()` makes every key optional but keeps each field's
 * `.default()` / `.prefault()`, so parsing `{ watermark: 200 }` against
 * `Schema.partial()` hands back every other field at its default. Merged over
 * the stored value, that patch silently resets everything the caller did not
 * send (bug 244). A patch schema must leave an omitted key omitted: this one
 * strips the defaults first, then makes each key optional. Bounds, enums and
 * nullability are kept.
 *
 * @module schemas/patch-schema
 */

import { z } from 'zod'

type WrapperDef = { type: string; innerType?: z.ZodType }

/**
 * The schema with every `.default()` / `.prefault()` removed, including one
 * sitting under an `.optional()` or `.nullable()` (`z.number().default(256)
 * .optional()` still hands back 256 for an absent key in Zod 4). The optional
 * and nullable wrappers themselves are kept.
 */
function withoutDefault(schema: z.ZodType): z.ZodType {
  const def = (schema as unknown as { _zod: { def: WrapperDef } })._zod.def
  if (!def.innerType) return schema
  switch (def.type) {
    case 'default':
    case 'prefault':
      return withoutDefault(def.innerType)
    case 'optional':
      return withoutDefault(def.innerType).optional()
    case 'nullable':
      return withoutDefault(def.innerType).nullable()
    default:
      return schema
  }
}

type PatchShape<S extends z.ZodRawShape> = { [K in keyof S]: z.ZodOptional<z.ZodType<z.output<S[K]>, z.input<S[K]>>> }

/**
 * Every key optional and no key defaulted: what the caller sent, and nothing
 * else. Unknown keys are stripped, as with the source object.
 */
export function patchSchemaOf<S extends z.ZodRawShape>(schema: z.ZodObject<S>): z.ZodObject<PatchShape<S>> {
  const shape: Record<string, z.ZodType> = {}
  for (const [key, field] of Object.entries(schema.shape)) {
    shape[key] = withoutDefault(field as z.ZodType).optional()
  }
  return z.object(shape) as unknown as z.ZodObject<PatchShape<S>>
}
