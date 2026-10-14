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

/** The schema under any `.default()` / `.prefault()` wrappers. */
function withoutDefault(schema: z.ZodType): z.ZodType {
  let current = schema
  for (;;) {
    const def = (current as unknown as { _zod: { def: { type: string; innerType?: z.ZodType } } })._zod.def
    if ((def.type === 'default' || def.type === 'prefault') && def.innerType) {
      current = def.innerType
      continue
    }
    return current
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
