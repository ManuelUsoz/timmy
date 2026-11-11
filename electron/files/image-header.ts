import type { ImageType } from '../../src/shared/files/files.model';

/**
 * What a file's own bytes say about it as an image: its type from the magic bytes (never the extension) and its size in
 * pixels from the header, without decoding a pixel. Pure, so main can refuse an image before any of it is sent.
 */

/** An image the reader can show: its type and its size in pixels (none for an SVG). */
export interface ImageHeader {
  readonly type: ImageType;
  readonly width: number | null;
  readonly height: number | null;
}

const ascii = (bytes: Uint8Array, at: number, text: string): boolean =>
  at + text.length <= bytes.length && [...text].every((char, i) => bytes[at + i] === char.charCodeAt(0));

const startsWith = (bytes: Uint8Array, signature: ReadonlyArray<number>): boolean =>
  signature.length <= bytes.length && signature.every((byte, i) => bytes[i] === byte);

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG = [0xff, 0xd8, 0xff];

/** The ISO-BMFF brands that make an AVIF file (still image and sequence). */
const AVIF_BRANDS = ['avif', 'avis'];

const isAvif = (bytes: Uint8Array): boolean => {
  if (!ascii(bytes, 4, 'ftyp')) return false;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
  const boxEnd = Math.min(view.getUint32(0), bytes.length);
  // The major brand at 8, then the compatible brands after the minor version.
  for (let at = 8; at + 4 <= boxEnd; at += at === 8 ? 8 : 4) {
    if (AVIF_BRANDS.some((brand) => ascii(bytes, at, brand))) return true;
  }
  return false;
};

/** An ICO: reserved 0, type 1 (icon), and at least one entry. */
const isIco = (bytes: Uint8Array): boolean => startsWith(bytes, [0, 0, 1, 0]) && bytes.length >= 6 && (bytes[4]! | (bytes[5]! << 8)) > 0;

/** A BMP: `BM`, then a DIB header of a size some version of the format has. */
const isBmp = (bytes: Uint8Array): boolean => {
  if (!ascii(bytes, 0, 'BM') || bytes.length < 18) return false;
  const dib = new DataView(bytes.buffer, bytes.byteOffset, bytes.length).getUint32(14, true);
  return [12, 40, 52, 56, 64, 108, 124].includes(dib);
};

const decoder = new TextDecoder('utf-8');

/**
 * An SVG: after an optional BOM, white space, an XML declaration, comments, processing instructions and a doctype, the
 * first element is `<svg`. Chromium draws an SVG only with its own MIME type, so this is what makes a file one.
 */
const isSvg = (head: Uint8Array): boolean => {
  const text = decoder.decode(head).replace(/^﻿/, '');
  const prolog = /^(?:\s+|<\?[\s\S]*?\?>|<!--[\s\S]*?-->|<!DOCTYPE[^>]*>)*/i;
  const rest = text.slice(prolog.exec(text)?.[0].length ?? 0);
  return /^<svg[\s>/]/.test(rest);
};

/** The type of an image from its first bytes; none for anything else (PDF, tiff, jxl, audio, video, text). */
export const imageTypeOf = (head: Uint8Array): ImageType | undefined => {
  if (startsWith(head, PNG)) return 'image/png';
  if (startsWith(head, JPEG)) return 'image/jpeg';
  if (ascii(head, 0, 'GIF87a') || ascii(head, 0, 'GIF89a')) return 'image/gif';
  if (ascii(head, 0, 'RIFF') && ascii(head, 8, 'WEBP')) return 'image/webp';
  if (isAvif(head)) return 'image/avif';
  if (isIco(head)) return 'image/x-icon';
  if (isBmp(head)) return 'image/bmp';
  if (isSvg(head)) return 'image/svg+xml';
  return undefined;
};

type Size = { readonly width: number; readonly height: number };

const pngSize = (bytes: Uint8Array, view: DataView): Size | undefined =>
  bytes.length >= 24 && ascii(bytes, 12, 'IHDR') ? { width: view.getUint32(16), height: view.getUint32(20) } : undefined;

/** The JPEG start-of-frame markers (C0 to CF but C4, C8 and CC, which are tables and a reserved one). */
const isStartOfFrame = (marker: number): boolean => marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;

/** Walks the JPEG segments to the first frame header, which holds the size. */
const jpegSize = (bytes: Uint8Array, view: DataView): Size | undefined => {
  let at = 2;
  while (at + 4 <= bytes.length) {
    if (bytes[at] !== 0xff) return undefined;
    const marker = bytes[at + 1]!;
    // Fill bytes, and the markers that stand alone (restart, start of image, temporary).
    if (marker === 0xff) {
      at += 1;
      continue;
    }
    if ((marker >= 0xd0 && marker <= 0xd8) || marker === 0x01) {
      at += 2;
      continue;
    }
    const length = view.getUint16(at + 2);
    if (isStartOfFrame(marker)) return at + 9 <= bytes.length ? { height: view.getUint16(at + 5), width: view.getUint16(at + 7) } : undefined;
    at += 2 + length;
  }
  return undefined;
};

const gifSize = (bytes: Uint8Array, view: DataView): Size | undefined =>
  bytes.length >= 10 ? { width: view.getUint16(6, true), height: view.getUint16(8, true) } : undefined;

const uint24 = (bytes: Uint8Array, at: number): number => bytes[at]! | (bytes[at + 1]! << 8) | (bytes[at + 2]! << 16);

const webpSize = (bytes: Uint8Array, view: DataView): Size | undefined => {
  if (ascii(bytes, 12, 'VP8X') && bytes.length >= 30) return { width: uint24(bytes, 24) + 1, height: uint24(bytes, 27) + 1 };
  if (ascii(bytes, 12, 'VP8L') && bytes.length >= 25 && bytes[20] === 0x2f) {
    const bits = view.getUint32(21, true);
    return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
  }
  if (ascii(bytes, 12, 'VP8 ') && bytes.length >= 30) return { width: view.getUint16(26, true) & 0x3fff, height: view.getUint16(28, true) & 0x3fff };
  return undefined;
};

/** The largest `ispe` (image spatial extent) property: a grid image lists its tiles and the whole picture. */
const avifSize = (bytes: Uint8Array, view: DataView): Size | undefined => {
  let best: Size | undefined;
  for (let at = 4; at + 16 <= bytes.length; at++) {
    if (!ascii(bytes, at, 'ispe')) continue;
    const size = { width: view.getUint32(at + 8), height: view.getUint32(at + 12) };
    if (best === undefined || size.width * size.height > best.width * best.height) best = size;
  }
  return best;
};

/** The largest picture of the icon; 0 in the directory means 256. */
const icoSize = (bytes: Uint8Array, view: DataView): Size | undefined => {
  const count = view.getUint16(4, true);
  if (bytes.length < 6 + count * 16) return undefined;
  let best = { width: 0, height: 0 };
  for (let entry = 0; entry < count; entry++) {
    const at = 6 + entry * 16;
    const size = { width: bytes[at] || 256, height: bytes[at + 1] || 256 };
    if (size.width * size.height > best.width * best.height) best = size;
  }
  return best;
};

/** The DIB header: an old OS/2 one has 16-bit sizes, every later one 32-bit, the height negative for top-down rows. */
const bmpSize = (bytes: Uint8Array, view: DataView): Size | undefined => {
  if (view.getUint32(14, true) === 12) return bytes.length >= 22 ? { width: view.getUint16(18, true), height: view.getUint16(20, true) } : undefined;
  return bytes.length >= 26 ? { width: Math.abs(view.getInt32(18, true)), height: Math.abs(view.getInt32(22, true)) } : undefined;
};

const SIZE_OF: Readonly<Record<Exclude<ImageType, 'image/svg+xml'>, (bytes: Uint8Array, view: DataView) => Size | undefined>> = {
  'image/png': pngSize,
  'image/jpeg': jpegSize,
  'image/gif': gifSize,
  'image/webp': webpSize,
  'image/avif': avifSize,
  'image/x-icon': icoSize,
  'image/bmp': bmpSize,
};

/** The whole file as an image: its type and size in pixels. None when it is not one, or its header is cut short or empty. */
export const imageOf = (bytes: Uint8Array): ImageHeader | undefined => {
  const type = imageTypeOf(bytes.subarray(0, 4096));
  if (type === undefined) return undefined;
  if (type === 'image/svg+xml') return { type, width: null, height: null };
  const size = SIZE_OF[type](bytes, new DataView(bytes.buffer, bytes.byteOffset, bytes.length));
  if (size === undefined || size.width <= 0 || size.height <= 0) return undefined;
  return { type, ...size };
};
