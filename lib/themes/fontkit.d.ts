/**
 * The slice of `fontkit` that `lib/themes/font-info.ts` (its only importer)
 * reads. fontkit ships no types of its own; this declares only what is used,
 * so nothing else is tempted to reach for more of it.
 */
declare module 'fontkit' {
  interface FontkitAxis {
    name: string;
    min: number;
    default: number;
    max: number;
  }
  interface FontkitFont {
    familyName: string | null;
    subfamilyName: string | null;
    italicAngle: number;
    variationAxes: Record<string, FontkitAxis>;
    getName(key: string, lang?: string): string | null;
    'OS/2'?: {
      usWeightClass?: number;
      fsType?: { noEmbedding?: boolean; viewOnly?: boolean; editable?: boolean; noSubsetting?: boolean; bitmapOnly?: boolean };
      fsSelection?: { italic?: boolean; oblique?: boolean };
    };
  }
  interface FontkitCollection {
    fonts: FontkitFont[];
  }
  export function create(buffer: Buffer, postscriptName?: string): FontkitFont | FontkitCollection;
}
