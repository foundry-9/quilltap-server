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
 * Convert an image Blob to PNG via an offscreen canvas.
 * The Clipboard API only supports image/png for ClipboardItem writes,
 * so non-PNG images (e.g. WebP) must be converted first.
 *
 * Uses a data URL (not blob: URL) to load the image, since the CSP
 * img-src directive allows data: but not blob:.
 */
function convertToPngBlob(blob: Blob): Promise<Blob> {
  return new Promise(async (resolve, reject) => {
    try {
      const dataUrl = await blobToDataUrl(blob);
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Failed to get canvas 2d context'));
          return;
        }
        ctx.drawImage(img, 0, 0);
        canvas.toBlob(
          (pngBlob) => {
            if (pngBlob) {
              resolve(pngBlob);
            } else {
              reject(new Error('Canvas toBlob returned null'));
            }
          },
          'image/png'
        );
      };
      img.onerror = () => {
        reject(new Error('Failed to load image for PNG conversion'));
      };
      img.src = dataUrl;
    } catch (err) {
      reject(err);
    }
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

  // Browser: standard Clipboard API (only supports image/png)
  const pngBlob = blob.type === 'image/png' ? blob : await convertToPngBlob(blob);
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': pngBlob })]);
  return true;
}
