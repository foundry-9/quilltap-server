/**
 * Backups written before bug 181's fix carry each memory embedding as
 * `JSON.stringify(Float32Array)` output — an index-keyed object
 * `{"0": 0.25, "1": -0.5}` — which `MemorySchema.embedding` refuses.
 *
 * `decodeIndexKeyedEmbedding` turns exactly that shape back into a
 * `number[]`: a plain object whose keys are the canonical decimals
 * `"0"…"n-1"` with no gaps, every value a finite number. Anything else is
 * returned unchanged, for the schema to accept or refuse as before.
 */
export function decodeIndexKeyedEmbedding(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value) || ArrayBuffer.isView(value)) return value;
  if (Object.getPrototypeOf(value) !== Object.prototype) return value;

  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length === 0) return value;

  const out = new Array<number>(entries.length);
  const seen = new Array<boolean>(entries.length).fill(false);
  for (const [key, v] of entries) {
    if (!/^(0|[1-9]\d*)$/.test(key)) return value;
    const index = Number(key);
    if (index >= entries.length || seen[index]) return value;
    if (typeof v !== 'number' || !Number.isFinite(v)) return value;
    out[index] = v;
    seen[index] = true;
  }
  return out;
}
