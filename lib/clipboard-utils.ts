/**
 * Centralized clipboard utilities that work in both Electron and browser contexts.
 *
 * Always prefers the standard Clipboard API (`navigator.clipboard.write()`) for
 * image copies — this works in modern browsers and Electron ≥ 25, and critically
 * ensures that copied images are paste-able back into the same renderer process
 * (e.g. fullscreen viewer → ChatComposer).
 *
 * Falls back to Electron's `clipboard.writeImage()` via IPC (`window.quilltap`)
 * only when the browser API throws. The native path writes to the OS clipboard
 * for external-app interop, but the renderer may not see it as `image/*` on paste.
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
 * Always tries the standard Clipboard API first — in modern Chromium (including
 * Electron ≥ 25) `navigator.clipboard.write()` with image/png ClipboardItems
 * works, and the result is readable by the same renderer on paste. This ensures
 * copy → paste round-trips within the app (e.g. fullscreen viewer → ChatComposer).
 *
 * Falls back to Electron's native `clipboard.writeImage()` via IPC only when the
 * browser API fails (older Electron builds, permissions issues, etc.). The native
 * path writes to the OS clipboard so external apps can paste the image, but the
 * renderer's `clipboardData.items` may not expose it as `image/*` on every platform.
 *
 * @returns `true` on success, `false` on failure.
 */
export async function copyImageToClipboard(src: string): Promise<boolean> {
  const response = await fetch(src);
  const blob = await response.blob();

  // Try the standard Clipboard API first — works in browsers and modern Electron
  try {
    const pngBlob = blob.type === 'image/png' ? blob : await convertToPngBlob(blob);
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': pngBlob })]);
    return true;
  } catch {
    // fall through to Electron IPC fallback
  }

  // Fallback: Electron IPC path (native clipboard.writeImage via nativeImage)
  if (hasElectronClipboard()) {
    const dataUrl = await blobToDataUrl(blob);
    return window.quilltap!.copyImageToClipboard(dataUrl);
  }

  throw new Error('No clipboard write method available');
}
