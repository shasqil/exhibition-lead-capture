/**
 * A phone photo is 3-8 MB, which is far more than a card scan needs and slow to
 * upload on exhibition wifi. Shrinking to 1600px on the long edge keeps the
 * small print readable while bringing each side down to a few hundred KB.
 */
const MAX_EDGE = 1600;
const QUALITY = 0.82;

export async function compressImage(file: File | Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const width = Math.round(bitmap.width * scale);
    const height = Math.round(bitmap.height * scale);

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) return file;
    context.drawImage(bitmap, 0, 0, width, height);

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", QUALITY),
    );
    // If the browser refused to encode, the original is still better than nothing.
    return blob ?? file;
  } catch {
    return file;
  } finally {
    bitmap.close();
  }
}

/** Turns a blob into the bare base64 the Anthropic image block expects. */
export async function blobToBase64(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}
