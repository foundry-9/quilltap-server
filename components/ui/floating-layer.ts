/**
 * The topmost floating layer.
 *
 * A few surfaces (the always-on Brahma Console and its launcher button) float
 * above every portal modal so the operator can reach them mid-form. They are
 * not part of whatever modal is open, so a modal's "click outside to close" or
 * "Escape to close" must not fire for interactions inside them. Those surfaces
 * carry {@link FLOATING_LAYER_ATTR}; outside-click/Escape handlers ask
 * {@link isInFloatingLayer} before dismissing.
 *
 * @module components/ui/floating-layer
 */

/** Marks an element as part of the topmost floating layer. */
export const FLOATING_LAYER_ATTR = 'data-qt-floating-layer'

/** Spread onto a topmost-layer element: `<div {...floatingLayerProps}>`. */
export const floatingLayerProps = { [FLOATING_LAYER_ATTR]: '' } as const

/** True when an event target sits inside a topmost floating-layer surface. */
export function isInFloatingLayer(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(`[${FLOATING_LAYER_ATTR}]`) !== null
}
