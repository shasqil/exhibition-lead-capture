/**
 * Reads when a photo was taken, from the EXIF block a phone camera writes into
 * every JPEG.
 *
 * This has to run on the original file. The app shrinks each photo through a
 * canvas before storing it, and a canvas re-encode drops EXIF entirely — by the
 * time the photo is on the lead, the timestamp is gone.
 *
 * Returns an ISO timestamp, or null when the photo carries no usable date:
 * screenshots, images forwarded through a chat app that strips metadata, or a
 * camera whose clock was never set. Callers fall back to their own time then.
 */

// Anything older is a camera clock that was never set (they reset to 2000 or
// 1970), not a real card. Anything more than a day ahead is a wrong clock.
const EARLIEST_PLAUSIBLE = Date.UTC(2015, 0, 1);
const FUTURE_TOLERANCE_MS = 24 * 60 * 60 * 1000;

// EXIF sits in the first few kilobytes; there is no need to read the image.
const HEAD_BYTES = 256 * 1024;

const TAG_DATE_TIME = 0x0132; // IFD0: last modified
const TAG_EXIF_POINTER = 0x8769; // IFD0: where the Exif sub-IFD starts
const TAG_DATE_TIME_ORIGINAL = 0x9003; // Exif: when the shutter was pressed
const TAG_DATE_TIME_DIGITIZED = 0x9004;
const TAG_OFFSET_TIME = 0x9010; // "+08:00" for DateTime
const TAG_OFFSET_TIME_ORIGINAL = 0x9011;
const TAG_OFFSET_TIME_DIGITIZED = 0x9012;

const ASCII = 2;
const LONG = 4;

export async function readPhotoTakenAt(file: Blob, now = Date.now()): Promise<string | null> {
  try {
    const head = await file.slice(0, HEAD_BYTES).arrayBuffer();
    return parseTakenAt(new DataView(head), now);
  } catch {
    return null;
  }
}

/** Exposed for tests: the same parse over bytes already in memory. */
export function parseTakenAt(view: DataView, now = Date.now()): string | null {
  try {
    return findInJpeg(view, now);
  } catch {
    // A truncated or malformed file must never break picking a photo.
    return null;
  }
}

function findInJpeg(view: DataView, now: number): string | null {
  if (view.byteLength < 4 || view.getUint16(0) !== 0xffd8) return null;

  let offset = 2;
  while (offset + 4 <= view.byteLength) {
    if (view.getUint8(offset) !== 0xff) return null;
    const marker = view.getUint8(offset + 1);
    if (marker === 0xff) {
      // Fill byte before a marker; step over it.
      offset += 1;
      continue;
    }
    // Start of image data, or end of image: EXIF always comes before these.
    if (marker === 0xda || marker === 0xd9) return null;

    const length = view.getUint16(offset + 2);
    if (length < 2) return null;
    if (marker === 0xe1 && isExifHeader(view, offset + 4)) {
      const end = Math.min(offset + 2 + length, view.byteLength);
      return readTiff(view, offset + 10, end, now);
    }
    offset += 2 + length;
  }
  return null;
}

function isExifHeader(view: DataView, at: number): boolean {
  if (at + 6 > view.byteLength) return false;
  // "Exif\0\0"
  return (
    view.getUint32(at) === 0x45786966 && view.getUint8(at + 4) === 0 && view.getUint8(at + 5) === 0
  );
}

function readTiff(view: DataView, tiff: number, end: number, now: number): string | null {
  if (tiff + 8 > end) return null;
  const order = view.getUint16(tiff);
  // "II" is little-endian (most Android), "MM" big-endian (iPhone).
  const little = order === 0x4949;
  if (!little && order !== 0x4d4d) return null;

  const u16 = (at: number) => view.getUint16(at, little);
  const u32 = (at: number) => view.getUint32(at, little);
  if (u16(tiff + 2) !== 42) return null;

  const readIfd = (at: number): Map<number, number> => {
    const entries = new Map<number, number>();
    if (at + 2 > end) return entries;
    const count = Math.min(u16(at), 512);
    for (let i = 0; i < count; i++) {
      const entry = at + 2 + i * 12;
      if (entry + 12 > end) break;
      entries.set(u16(entry), entry);
    }
    return entries;
  };

  const ascii = (ifd: Map<number, number>, tag: number): string | null => {
    const entry = ifd.get(tag);
    if (entry === undefined || u16(entry + 2) !== ASCII) return null;
    const count = u32(entry + 4);
    // Values of four bytes or fewer are stored inline in the entry itself.
    const at = count <= 4 ? entry + 8 : tiff + u32(entry + 8);
    if (count === 0 || at + count > end) return null;
    let text = "";
    for (let i = 0; i < count; i++) {
      const code = view.getUint8(at + i);
      if (code === 0) break;
      text += String.fromCharCode(code);
    }
    return text.trim() || null;
  };

  const ifd0 = readIfd(tiff + u32(tiff + 4));

  // Prefer the moment the shutter was pressed; the IFD0 DateTime is updated by
  // editing apps, so it is only a fallback.
  const pointer = ifd0.get(TAG_EXIF_POINTER);
  if (pointer !== undefined && u16(pointer + 2) === LONG) {
    const exif = readIfd(tiff + u32(pointer + 8));
    const original = toIso(
      ascii(exif, TAG_DATE_TIME_ORIGINAL),
      ascii(exif, TAG_OFFSET_TIME_ORIGINAL),
      now,
    );
    if (original) return original;
    const digitized = toIso(
      ascii(exif, TAG_DATE_TIME_DIGITIZED),
      ascii(exif, TAG_OFFSET_TIME_DIGITIZED),
      now,
    );
    if (digitized) return digitized;
    return toIso(ascii(ifd0, TAG_DATE_TIME), ascii(exif, TAG_OFFSET_TIME), now);
  }
  return toIso(ascii(ifd0, TAG_DATE_TIME), null, now);
}

/**
 * EXIF writes "2026:09:20 10:42:07" with no timezone. Newer phones add an
 * offset tag ("+08:00") alongside; when they do, the time is exact. When they
 * do not, it is the camera's local time — which, for a photo taken on the phone
 * now uploading it, is this browser's local time.
 */
function toIso(text: string | null, offset: string | null, now: number): string | null {
  if (!text) return null;
  const match = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(text);
  if (!match) return null;
  const [, y, mo, d, h, mi, s] = match;

  let ms: number;
  if (offset && /^[+-]\d{2}:\d{2}$/.test(offset)) {
    ms = Date.parse(`${y}-${mo}-${d}T${h}:${mi}:${s}${offset}`);
  } else {
    ms = new Date(+y, +mo - 1, +d, +h, +mi, +s).getTime();
  }

  if (Number.isNaN(ms)) return null;
  if (ms < EARLIEST_PLAUSIBLE || ms > now + FUTURE_TOLERANCE_MS) return null;
  return new Date(ms).toISOString();
}
