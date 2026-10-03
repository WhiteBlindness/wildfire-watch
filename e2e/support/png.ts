import { deflateSync, inflateSync } from "node:zlib";

/**
 * Just enough PNG to read Playwright screenshots (8-bit RGB or RGBA,
 * non-interlaced) and to write solid-colour map tiles for the stubs.
 */

export interface Pixels {
  width: number;
  height: number;
  channels: 3 | 4;
  data: Uint8Array;
}

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

export function decodePng(png: Buffer): Pixels {
  if (!png.subarray(0, 8).equals(SIGNATURE)) throw new Error("not a PNG");
  let offset = 8;
  let width = 0;
  let height = 0;
  let colourType = 0;
  const idat: Buffer[] = [];
  while (offset < png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.toString("ascii", offset + 4, offset + 8);
    const body = png.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      if (body[8] !== 8 || body[12] !== 0) throw new Error("only 8-bit, non-interlaced PNGs are supported");
      colourType = body[9];
    } else if (type === "IDAT") {
      idat.push(body);
    }
    offset += 12 + length;
  }
  if (colourType !== 2 && colourType !== 6) throw new Error(`unsupported PNG colour type ${colourType}`);
  const channels = colourType === 6 ? 4 : 3;
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const data = new Uint8Array(height * stride);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)];
    const row = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x += 1) {
      const left = x >= channels ? data[y * stride + x - channels] : 0;
      const up = y > 0 ? data[(y - 1) * stride + x] : 0;
      const upLeft = y > 0 && x >= channels ? data[(y - 1) * stride + x - channels] : 0;
      const predictor = [0, left, up, (left + up) >> 1, paeth(left, up, upLeft)][filter];
      data[y * stride + x] = (row[x] + predictor) & 0xff;
    }
  }
  return { width, height, channels, data };
}

/** Counts pixels within `tolerance` of `[r, g, b]` on every channel. */
export function countColour(pixels: Pixels, [r, g, b]: readonly [number, number, number], tolerance: number): number {
  let count = 0;
  for (let index = 0; index < pixels.data.length; index += pixels.channels) {
    if (Math.abs(pixels.data[index] - r) <= tolerance
      && Math.abs(pixels.data[index + 1] - g) <= tolerance
      && Math.abs(pixels.data[index + 2] - b) <= tolerance) count += 1;
  }
  return count;
}

/**
 * Counts red-dominant pixels (amber through dark crimson), the colours of the
 * detection layers. The stubbed basemaps are green, navy, pale blue or grey,
 * so none of them qualifies.
 */
export function countWarm(pixels: Pixels): number {
  let count = 0;
  for (let index = 0; index < pixels.data.length; index += pixels.channels) {
    const [r, g, b] = [pixels.data[index], pixels.data[index + 1], pixels.data[index + 2]];
    if (r >= 110 && r - b >= 70 && r - g >= 20) count += 1;
  }
  return count;
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes: Buffer): number {
  let c = 0xffffffff;
  for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, body: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(body.length, 0);
  head.write(type, 4, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), body])), 0);
  return Buffer.concat([head, body, crc]);
}

/** An opaque single-colour PNG, used as a stand-in satellite tile. */
export function solidPng(size: number, [r, g, b]: readonly [number, number, number]): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 2;
  const row = Buffer.alloc(1 + size * 3);
  for (let x = 0; x < size; x += 1) row.set([r, g, b], 1 + x * 3);
  const raw = Buffer.concat(Array.from({ length: size }, () => row));
  return Buffer.concat([SIGNATURE, chunk("IHDR", header), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
