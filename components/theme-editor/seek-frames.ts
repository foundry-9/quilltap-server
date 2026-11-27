/**
 * Try `step` once a frame, starting on the next one, until it answers true
 * or `maxFrames` tries have been made. For waiting on something a render is
 * about to draw (a row coming near the viewport, an editor mounting) or on a
 * scroll position settling.
 *
 * @module components/theme-editor/seek-frames
 */
export function seekFrames(step: () => boolean, maxFrames: number): void {
  let frames = 0
  const seek = () => {
    if (step()) return
    if (++frames < maxFrames) requestAnimationFrame(seek)
  }
  requestAnimationFrame(seek)
}
