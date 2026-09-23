#!/usr/bin/env node
/*
 * Unit tests for the EXIF photo-time reader.
 *
 * Builds real EXIF blocks byte by byte — both byte orders, with and without
 * the timezone tag — rather than depending on sample photos, so every case the
 * parser has to handle is spelled out here.
 *
 * Usage: npm test
 */
import { parseTakenAt } from "../src/lib/exif.ts";
import { TAGS, buildExifJpeg } from "./exif-builder.mjs";

// Pin the zone so the cases without a timezone tag have one right answer.
// Node honours a runtime change to TZ, and nothing has read the clock yet.
process.env.TZ = "Asia/Singapore";

const NOW = Date.parse("2026-09-24T00:00:00Z");
const parse = (jpeg) => parseTakenAt(new DataView(jpeg.buffer), NOW);

const cases = [
  {
    name: "iPhone (big-endian) with timezone tag",
    jpeg: buildExifJpeg({
      little: false,
      exif: [[TAGS.ORIGINAL, "2026:09:20 10:42:07"], [TAGS.OFFSET_ORIGINAL, "+08:00"]],
    }),
    expect: "2026-09-20T02:42:07.000Z",
  },
  {
    name: "Android (little-endian) with timezone tag",
    jpeg: buildExifJpeg({
      exif: [[TAGS.ORIGINAL, "2026:09:20 10:42:07"], [TAGS.OFFSET_ORIGINAL, "+07:00"]],
    }),
    expect: "2026-09-20T03:42:07.000Z",
  },
  {
    name: "No timezone tag: read as the phone's own local time",
    jpeg: buildExifJpeg({ exif: [[TAGS.ORIGINAL, "2026:09:20 10:42:07"]] }),
    expect: "2026-09-20T02:42:07.000Z", // TZ=Asia/Singapore
  },
  {
    name: "Shutter time preferred over the editable DateTime",
    jpeg: buildExifJpeg({
      ifd0: [[TAGS.DATE_TIME, "2026:09:23 18:00:00"]],
      exif: [[TAGS.ORIGINAL, "2026:09:20 10:42:07"], [TAGS.OFFSET_ORIGINAL, "+08:00"]],
    }),
    expect: "2026-09-20T02:42:07.000Z",
  },
  {
    name: "Falls back to DateTimeDigitized",
    jpeg: buildExifJpeg({ exif: [[TAGS.DIGITIZED, "2026:09:20 10:42:07"]] }),
    expect: "2026-09-20T02:42:07.000Z",
  },
  {
    name: "Falls back to IFD0 DateTime when there is no Exif block",
    jpeg: buildExifJpeg({ ifd0: [[TAGS.DATE_TIME, "2026:09:20 10:42:07"]] }),
    expect: "2026-09-20T02:42:07.000Z",
  },
  {
    name: "Camera clock never set (year 2000) is ignored",
    jpeg: buildExifJpeg({ exif: [[TAGS.ORIGINAL, "2000:01:01 00:00:00"]] }),
    expect: null,
  },
  {
    name: "Zeroed placeholder date is ignored",
    jpeg: buildExifJpeg({ exif: [[TAGS.ORIGINAL, "0000:00:00 00:00:00"]] }),
    expect: null,
  },
  {
    name: "A date in the future is ignored",
    jpeg: buildExifJpeg({ exif: [[TAGS.ORIGINAL, "2027:03:01 09:00:00"]] }),
    expect: null,
  },
  {
    name: "JPEG with no EXIF at all",
    jpeg: new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x4a, 0x46, 0xff, 0xd9]),
    expect: null,
  },
  {
    name: "A PNG, not a JPEG",
    jpeg: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    expect: null,
  },
  {
    name: "Truncated EXIF block does not throw",
    jpeg: buildExifJpeg({ exif: [[TAGS.ORIGINAL, "2026:09:20 10:42:07"]] }).slice(0, 30),
    expect: null,
  },
  {
    name: "Empty file",
    jpeg: new Uint8Array([]),
    expect: null,
  },
];

let failures = 0;
for (const { name, jpeg, expect } of cases) {
  let got;
  try {
    got = parse(jpeg);
  } catch (error) {
    got = `THREW: ${error.message}`;
  }
  const ok = got === expect;
  if (!ok) failures += 1;
  console.log(`  ${ok ? "✓" : "✗"} ${name}${ok ? "" : `\n      expected ${expect}\n      got      ${got}`}`);
}

console.log(failures ? `\n${failures} failing` : `\nAll ${cases.length} passing`);
process.exit(failures ? 1 : 0);
