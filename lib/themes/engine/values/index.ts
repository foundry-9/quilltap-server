/**
 * Theme engine — token values as structures (Calliope Live, Spec E, Stage 0).
 *
 * The one place a token value is parsed into something a control can edit
 * and formatted back. Every `parse` returns null for a value it does not
 * fully understand, and the editor then shows that value as text and never
 * rewrites it; `format(parse(v))` renders the same as `v` for every value it
 * accepts. Pure and browser-safe, so the editor, the CLI and a later LLM step
 * share them.
 *
 * @module themes/engine/values
 */

export { splitTopLevel, isVarReference, isFunctionCall, formatNumber } from './split';
export {
  parseLength,
  formatLength,
  parseLengthList,
  formatLengthList,
  radiusCorners,
  collapseCorners,
  parseBlur,
  formatBlur,
  type LengthPart,
  type Blur,
} from './length';
export { parseShadow, formatShadow, defaultShadowLayer, type Shadow, type ShadowLayer } from './shadow';
export { parseFontStack, formatFontStack, formatFontFamily, GENERIC_FONT_FAMILIES, type FontStack } from './font-stack';
export { parseTransition, formatTransition, EASING_KEYWORDS, type Transition, type TransitionLayer } from './transition';
export {
  parseDuration,
  formatDuration,
  parseOpacity,
  formatOpacity,
  opacityFraction,
  parseZIndex,
  formatZIndex,
  parseFontWeight,
  formatFontWeight,
  DURATION_UNITS,
  FONT_WEIGHT_KEYWORDS,
  type Quantity,
  type FontWeight,
} from './quantity';
export { parseImage, formatImage, type ImageValue } from './image';
