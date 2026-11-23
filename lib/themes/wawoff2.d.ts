/**
 * The slice of `wawoff2` that `lib/themes/convert-fonts.ts` (its only
 * importer) uses. The package ships no types of its own.
 */
declare module 'wawoff2' {
  export function compress(buffer: Uint8Array): Promise<Uint8Array>;
  export function decompress(buffer: Uint8Array): Promise<Uint8Array>;
}
