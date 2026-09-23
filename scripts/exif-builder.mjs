/**
 * Builds EXIF blocks byte by byte, for the parser's unit tests and for the
 * smoke test's photo fixture. Kept apart from the tests so importing it does
 * not run them.
 */
export const TAGS = {
  DATE_TIME: 0x0132,
  EXIF_POINTER: 0x8769,
  ORIGINAL: 0x9003,
  DIGITIZED: 0x9004,
  OFFSET_ORIGINAL: 0x9011,
};

/**
 * A JPEG header carrying one EXIF block and nothing else — enough for the
 * parser, which stops before the image data. `ifd0` and `exif` are lists of
 * [tag, asciiText].
 */
export function buildExifJpeg({ little = true, ifd0 = [], exif = null }) {
  const entries0 = [...ifd0];
  const hasExif = exif !== null;
  const count0 = entries0.length + (hasExif ? 1 : 0);
  const count1 = hasExif ? exif.length : 0;

  const ifd0At = 8;
  const ifd0Size = 2 + count0 * 12 + 4;
  const exifAt = ifd0At + ifd0Size;
  const exifSize = hasExif ? 2 + count1 * 12 + 4 : 0;
  let dataAt = exifAt + exifSize;

  const strings = [...entries0, ...(exif ?? [])].map(([, text]) => text);
  const dataSize = strings.reduce((sum, text) => sum + text.length + 1, 0);
  const tiff = new DataView(new ArrayBuffer(dataAt + dataSize));
  const bytes = new Uint8Array(tiff.buffer);

  tiff.setUint16(0, little ? 0x4949 : 0x4d4d);
  tiff.setUint16(2, 42, little);
  tiff.setUint32(4, ifd0At, little);

  const writeAscii = (entry, tag, text) => {
    tiff.setUint16(entry, tag, little);
    tiff.setUint16(entry + 2, 2, little);
    tiff.setUint32(entry + 4, text.length + 1, little);
    tiff.setUint32(entry + 8, dataAt, little);
    for (let i = 0; i < text.length; i++) bytes[dataAt + i] = text.charCodeAt(i);
    bytes[dataAt + text.length] = 0;
    dataAt += text.length + 1;
  };

  tiff.setUint16(ifd0At, count0, little);
  entries0.forEach(([tag, text], i) => writeAscii(ifd0At + 2 + i * 12, tag, text));
  if (hasExif) {
    const pointer = ifd0At + 2 + entries0.length * 12;
    tiff.setUint16(pointer, TAGS.EXIF_POINTER, little);
    tiff.setUint16(pointer + 2, 4, little);
    tiff.setUint32(pointer + 4, 1, little);
    tiff.setUint32(pointer + 8, exifAt, little);
    tiff.setUint16(exifAt, count1, little);
    exif.forEach(([tag, text], i) => writeAscii(exifAt + 2 + i * 12, tag, text));
  }

  const payload = new Uint8Array([0x45, 0x78, 0x69, 0x66, 0, 0, ...bytes]);
  const length = payload.length + 2;
  return new Uint8Array([
    0xff, 0xd8,
    0xff, 0xe1, length >> 8, length & 0xff,
    ...payload,
    0xff, 0xd9,
  ]);
}
