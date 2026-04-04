/**
 * Centralized clipboard utilities that work in both Electron and browser contexts.
 *
 * In Electron, `navigator.clipboard.write()` with image ClipboardItems is not
 * supported — it only reliably handles text. Image copies go through
 * `window.quilltap.copyImageToClipboard` IPC, which uses Electron's native
 * `clipboard.writeImage()` via `nativeImage`.
 *
 * In a regular browser, the standard Clipboard API works as expected.
 */

/** Whether the Electron bridge exposes image clipboard support. */
function hasElectronClipboard(): boolean {
  return typeof window !== 'undefined' && !!window.quilltap?.copyImageToClipboard;
}

/**
 * Convert a Blob to a data URL string for passing through Electron IPC.
 */
function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

/**
 * Copy an image to the clipboard from a fetch-able URL (relative or absolute).
 *
 * In Electron: fetches the image, converts to a data URL, and sends via IPC
 * so the main process can use `nativeImage` + `clipboard.writeImage()`.
 * In browser: uses the standard `navigator.clipboard.write()` API.
 *
 * @returns `true` on success, `false` on failure.
 */
export async function copyImageToClipboard(src: string): Promise<boolean> {
  const response = await fetch(src);
  const blob = await response.blob();

  if (hasElectronClipboard()) {
    console.debug('[clipboard-utils] Copying image via Electron IPC', { src });
    const dataUrl = await blobToDataUrl(blob);
    return window.quilltap!.copyImageToClipboard(dataUrl);
  }

  // Browser: standard Clipboard API
  await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
  return true;
}
