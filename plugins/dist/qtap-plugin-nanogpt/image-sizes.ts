/**
 * Fitting a requested image shape onto what one NanoGPT model accepts.
 *
 * The host asks for a shape in one provider-wide vocabulary — a portrait avatar
 * arrives as `size: '832x1248'` — but NanoGPT fronts two hundred models with
 * three different ideas of a size, and its detailed catalog says which one each
 * model speaks:
 *
 *   - concrete sizes, `WxH` (`1024x1536`) or `W*H` (`1024*1536`);
 *   - resolution tiers (`1k`, `2k`) with the shape carried separately in an
 *     `aspect_ratio` field (`2:3`), the Qwen Image 3 family among them.
 *
 * A size the model does not list is a hard 400 ("supports 1K and 2K output"),
 * so the request is fitted here, at the wire, from the model's own catalog
 * entry: the nearest listed concrete size by aspect ratio, or the nearest tier
 * by long edge plus the nearest listed aspect ratio. With no catalog entry, or
 * no shape to fit, the request goes out exactly as asked.
 *
 * Pure: no network, no logging — the provider fetches the catalog and records
 * what changed.
 */

/** The catalog fields this module reads from a model's entry. */
export interface NanoGPTSizeCatalog {
  resolutions?: string[];
  aspect_ratio?: string[];
}

export interface FittedImageShape {
  /** The `size` to post, in the model's own spelling; undefined to omit. */
  size?: string;
  /** The `aspect_ratio` to post, or undefined to omit. */
  aspectRatio?: string;
  /** True when anything differs from what was asked. */
  adjusted: boolean;
}

/** The area a request with no pixel dimensions is measured against. */
const DEFAULT_AREA = 1024 * 1024;

function parseDims(value: string): { width: number; height: number } | null {
  const match = /^\s*(\d+)\s*[x×*]\s*(\d+)\s*$/i.exec(value);
  if (!match) return null;
  const width = Number(match[1]);
  const height = Number(match[2]);
  return width > 0 && height > 0 ? { width, height } : null;
}

function parseRatio(value: string): number | null {
  const match = /^\s*(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)\s*$/.exec(value);
  if (!match) return null;
  const width = Number(match[1]);
  const height = Number(match[2]);
  return width > 0 && height > 0 ? width / height : null;
}

/** `1k` → 1024, `1.5k` → 1536; anything else is not a tier this can rank. */
function tierLongEdge(value: string): number | null {
  const match = /^\s*(\d+(?:\.\d+)?)\s*k\s*$/i.exec(value);
  return match ? Number(match[1]) * 1024 : null;
}

/** Distance between two ratios, symmetric for portrait and landscape. */
function ratioDistance(a: number, b: number): number {
  return Math.abs(Math.log(a) - Math.log(b));
}

/**
 * Fit a requested `size` / `aspectRatio` onto a model's advertised options.
 * `size` wins over `aspectRatio` as the statement of shape when both parse.
 */
export function fitImageShape(
  catalog: NanoGPTSizeCatalog | undefined,
  size: string | undefined,
  aspectRatio: string | undefined,
): FittedImageShape {
  const asked: FittedImageShape = { size, aspectRatio: undefined, adjusted: false };
  const resolutions = catalog?.resolutions ?? [];
  if (resolutions.length === 0) return asked;

  // A size the model lists verbatim needs no fitting.
  if (size && resolutions.includes(size)) return asked;

  const dims = size ? parseDims(size) : null;
  const targetRatio = dims ? dims.width / dims.height : aspectRatio ? parseRatio(aspectRatio) : null;
  if (targetRatio === null) return asked;
  const targetArea = dims ? dims.width * dims.height : DEFAULT_AREA;

  const concrete = resolutions
    .map((value) => ({ value, dims: parseDims(value) }))
    .filter((entry): entry is { value: string; dims: { width: number; height: number } } => entry.dims !== null);

  if (concrete.length > 0) {
    const best = concrete.reduce((winner, candidate) => {
      const winnerRatio = ratioDistance(winner.dims.width / winner.dims.height, targetRatio);
      const candidateRatio = ratioDistance(candidate.dims.width / candidate.dims.height, targetRatio);
      if (candidateRatio !== winnerRatio) return candidateRatio < winnerRatio ? candidate : winner;
      const winnerArea = Math.abs(winner.dims.width * winner.dims.height - targetArea);
      const candidateArea = Math.abs(candidate.dims.width * candidate.dims.height - targetArea);
      return candidateArea < winnerArea ? candidate : winner;
    });
    return { size: best.value, aspectRatio: undefined, adjusted: best.value !== size };
  }

  // Tier models: the size names a tier, the shape rides in `aspect_ratio`.
  const targetLongEdge = dims ? Math.max(dims.width, dims.height) : 1024;
  const tiers = resolutions
    .map((value) => ({ value, edge: tierLongEdge(value) }))
    .filter((entry): entry is { value: string; edge: number } => entry.edge !== null);
  if (tiers.length === 0) return asked;

  const tier = tiers.reduce((winner, candidate) =>
    Math.abs(candidate.edge - targetLongEdge) < Math.abs(winner.edge - targetLongEdge) ? candidate : winner,
  );

  const ratios = (catalog?.aspect_ratio ?? [])
    .map((value) => ({ value, ratio: parseRatio(value) }))
    .filter((entry): entry is { value: string; ratio: number } => entry.ratio !== null);
  const ratio = ratios.length
    ? ratios.reduce((winner, candidate) =>
        ratioDistance(candidate.ratio, targetRatio) < ratioDistance(winner.ratio, targetRatio) ? candidate : winner,
      ).value
    : undefined;

  return { size: tier.value, aspectRatio: ratio, adjusted: true };
}
