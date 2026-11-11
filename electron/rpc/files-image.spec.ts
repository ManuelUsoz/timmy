import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from '@effect/vitest';
import { Effect, Layer } from 'effect';
import { DesktopApi } from '../../src/app/core/desktop-api';
import { layerProjectsUnused, layerSettingsUnused, layerWindowUnused, makeDesktopTestLayer } from '../../src/app/core/desktop-layers';
import { AppInfoRpcs } from '../../src/shared/app-info/app-info.rpc';
import { MAX_IMAGE_BYTES } from '../../src/shared/files/files.model';
import { layerFilesState } from '../files/files-state';
import { layerFileOpenerTest } from '../files/file-opener';
import { layerProjectFiles } from '../files/project-files';
import { layerProjectStore, ProjectStore } from '../projects/project-store';
import { layerFilesHandlers } from './files';

const roots: string[] = [];
const db = path.join(mkdtempSync(path.join(tmpdir(), 'timmy-images-db-')), 'timmy.db');
roots.push(path.dirname(db));
const tempProject = () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'timmy-images-'));
  roots.push(dir);
  Effect.runSync(Effect.flatMap(ProjectStore, (store) => store.add(dir)).pipe(Effect.provide(layerProjectStore(db))));
  return dir;
};
const write = (root: string, file: string, content: Uint8Array | string) => {
  mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  writeFileSync(path.join(root, file), content);
};

const layer = makeDesktopTestLayer(
  Layer.mergeAll(
    layerFilesHandlers.pipe(
      Layer.provide(layerProjectFiles()),
      Layer.provide(layerFileOpenerTest()),
      Layer.provide(layerFilesState),
      Layer.provide(layerProjectStore(db)),
    ),
    AppInfoRpcs.toLayer({ 'AppInfo.get': () => Effect.die('unused') }),
    layerWindowUnused,
    layerSettingsUnused,
    layerProjectsUnused,
  ),
);

afterAll(() => roots.forEach((root) => rmSync(root, { recursive: true, force: true })));

/** Bytes from numbers and ASCII strings, in order. */
const bytes = (...parts: ReadonlyArray<number | string | ReadonlyArray<number>>): Uint8Array =>
  Uint8Array.from(parts.flatMap((part) => (typeof part === 'number' ? [part] : typeof part === 'string' ? [...part].map((c) => c.charCodeAt(0)) : [...part])));
const be32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const be16 = (n: number) => [(n >>> 8) & 255, n & 255];
const le32 = (n: number) => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255];
const le24 = (n: number) => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255];
const le16 = (n: number) => [n & 255, (n >>> 8) & 255];

/** The header of each format with its width and height, as an encoder writes it; the pixels themselves do not matter. */
const png = (w: number, h: number) => bytes(0x89, 'PNG\r\n', 0x1a, '\n', be32(13), 'IHDR', be32(w), be32(h), 8, 6, 0, 0, 0, be32(0), be32(0), 'IEND', be32(0));
const jpeg = (w: number, h: number) =>
  bytes(0xff, 0xd8, 0xff, 0xe0, be16(16), 'JFIF', 0, 1, 1, 0, be16(1), be16(1), 0, 0, 0xff, 0xdb, be16(4), 0, 0, 0xff, 0xc2, be16(17), 8, be16(h), be16(w), 3, Array(9).fill(0), 0xff, 0xd9);
const gif = (w: number, h: number) => bytes('GIF89a', le16(w), le16(h), 0, 0, 0, ';');
const webpLossless = (w: number, h: number) => {
  const bits = (w - 1) | ((h - 1) << 14);
  return bytes('RIFF', le32(14), 'WEBP', 'VP8L', le32(5), 0x2f, le32(bits));
};
const webpExtended = (w: number, h: number) => bytes('RIFF', le32(22), 'WEBP', 'VP8X', le32(10), 0, 0, 0, 0, le24(w - 1), le24(h - 1));
const webpLossy = (w: number, h: number) => bytes('RIFF', le32(20), 'WEBP', 'VP8 ', le32(10), 0, 0, 0, 0x9d, 0x01, 0x2a, le16(w), le16(h));
const avif = (w: number, h: number) =>
  bytes(be32(28), 'ftyp', 'avif', be32(0), 'avif', 'mif1', 'miaf', be32(36), 'meta', be32(0), be32(20), 'ispe', be32(0), be32(w), be32(h), be32(0));
const ico = (sizes: ReadonlyArray<number>) =>
  bytes(0, 0, 1, 0, le16(sizes.length), ...sizes.map((s) => [s % 256, s % 256, 0, 0, ...le16(1), ...le16(32), ...le32(0), ...le32(0)]));
const bmp = (w: number, h: number) => bytes('BM', le32(54), le32(0), le32(54), le32(40), le32(w), le32(-h), le16(1), le16(24), Array(24).fill(0));

const readImage = (cwd: string, file: string) => Effect.flatMap(DesktopApi, (api) => api['Files.readImage']({ cwd, file }));

describe('Files.readImage', () => {
  it.effect('answers each format with its type from the bytes, its size in pixels and the bytes themselves', () => {
    const root = tempProject();
    const files: ReadonlyArray<readonly [string, Uint8Array, string, number, number]> = [
      ['a.png', png(640, 480), 'image/png', 640, 480],
      ['a.jpg', jpeg(1920, 1080), 'image/jpeg', 1920, 1080],
      ['a.gif', gif(32, 16), 'image/gif', 32, 16],
      ['lossless.webp', webpLossless(300, 200), 'image/webp', 300, 200],
      ['extended.webp', webpExtended(1000, 750), 'image/webp', 1000, 750],
      ['lossy.webp', webpLossy(77, 55), 'image/webp', 77, 55],
      ['a.avif', avif(1200, 800), 'image/avif', 1200, 800],
      ['favicon.ico', ico([16, 256, 48]), 'image/x-icon', 256, 256],
      ['a.bmp', bmp(12, 10), 'image/bmp', 12, 10],
    ];
    files.forEach(([file, content]) => write(root, `img/${file}`, content));
    return Effect.gen(function* () {
      for (const [file, content, type, width, height] of files) {
        const image = yield* readImage(root, `img/${file}`);
        expect({ file, ...image, bytes: image.kind === 'image' ? [...image.bytes] : [] }).toEqual({
          file,
          kind: 'image',
          type,
          width,
          height,
          size: content.length,
          bytes: [...content],
        });
      }
    }).pipe(Effect.provide(layer));
  });

  it.effect('answers an SVG as image/svg+xml, after a BOM, an XML declaration, comments and a doctype, with no size in pixels', () => {
    const root = tempProject();
    const svg = '﻿<?xml version="1.0"?>\n<!-- drawn by hand -->\n<!DOCTYPE svg>\n<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>';
    write(root, 'logo.svg', svg);
    write(root, 'plain.svg', '<svg viewBox="0 0 1 1"></svg>');
    return Effect.gen(function* () {
      const logo = yield* readImage(root, 'logo.svg');
      expect(logo).toMatchObject({ kind: 'image', type: 'image/svg+xml', width: null, height: null });
      expect(new TextDecoder('utf-8', { ignoreBOM: true }).decode(logo.kind === 'image' ? logo.bytes : new Uint8Array())).toBe(svg);
      expect(yield* readImage(root, 'plain.svg')).toMatchObject({ kind: 'image', type: 'image/svg+xml' });
    }).pipe(Effect.provide(layer));
  });

  it.effect('reads the type from the content, never the extension', () => {
    const root = tempProject();
    write(root, 'really-a-png.jpg', png(4, 3));
    write(root, 'screenshot', gif(8, 8));
    write(root, 'fake.png', 'not a picture at all');
    write(root, 'fake.svg', '<html><svg/></html>');
    return Effect.gen(function* () {
      expect(yield* readImage(root, 'really-a-png.jpg')).toMatchObject({ kind: 'image', type: 'image/png', width: 4, height: 3 });
      expect(yield* readImage(root, 'screenshot')).toMatchObject({ kind: 'image', type: 'image/gif' });
      expect(yield* readImage(root, 'fake.png')).toEqual({ kind: 'notAnImage', size: 20 });
      expect(yield* readImage(root, 'fake.svg')).toEqual({ kind: 'notAnImage', size: 19 });
    }).pipe(Effect.provide(layer));
  });

  it.effect('refuses PDF, tiff, jxl, audio, video and other binaries, with their size', () => {
    const root = tempProject();
    const others: ReadonlyArray<readonly [string, Uint8Array]> = [
      ['doc.pdf', bytes('%PDF-1.7\n', Array(40).fill(0))],
      ['scan.tiff', bytes('II*', 0, le32(8), Array(40).fill(0))],
      ['photo.jxl', bytes(0xff, 0x0a, Array(40).fill(0))],
      ['song.mp3', bytes('ID3', 4, 0, Array(40).fill(0))],
      ['clip.mp4', bytes(be32(24), 'ftyp', 'isom', be32(0), 'isom', 'mp41', Array(20).fill(0))],
      ['tool.exe', bytes('MZ', Array(40).fill(0))],
    ];
    others.forEach(([file, content]) => write(root, file, content));
    return Effect.gen(function* () {
      for (const [file, content] of others) {
        expect({ file, answer: yield* readImage(root, file) }).toEqual({ file, answer: { kind: 'notAnImage', size: content.length } });
      }
    }).pipe(Effect.provide(layer));
  });

  it.effect('answers an image over 8 MiB with the byte limit and its size, and sends none of it', () => {
    const root = tempProject();
    const header = png(100, 100);
    const big = new Uint8Array(MAX_IMAGE_BYTES + 1);
    big.set(header);
    const atCap = new Uint8Array(MAX_IMAGE_BYTES);
    atCap.set(header);
    write(root, 'big.png', big);
    write(root, 'at-cap.png', atCap);
    write(root, 'big.bin', new Uint8Array(MAX_IMAGE_BYTES + 1));
    return Effect.gen(function* () {
      expect(yield* readImage(root, 'big.png')).toEqual({ kind: 'tooLarge', limit: 'bytes', size: MAX_IMAGE_BYTES + 1 });
      expect(yield* readImage(root, 'at-cap.png')).toMatchObject({ kind: 'image', size: MAX_IMAGE_BYTES });
      expect(yield* readImage(root, 'big.bin')).toEqual({ kind: 'notAnImage', size: MAX_IMAGE_BYTES + 1 });
    }).pipe(Effect.provide(layer));
  });

  it.effect('answers an image over 40 megapixels with the pixel limit and its size in pixels, from the header alone', () => {
    const root = tempProject();
    write(root, 'huge.png', png(16000, 16000));
    write(root, 'huge.jpg', jpeg(8000, 5001));
    write(root, 'at-cap.webp', webpExtended(8000, 5000));
    return Effect.gen(function* () {
      expect(yield* readImage(root, 'huge.png')).toEqual({ kind: 'tooLarge', limit: 'pixels', size: png(1, 1).length, width: 16000, height: 16000 });
      expect(yield* readImage(root, 'huge.jpg')).toMatchObject({ kind: 'tooLarge', limit: 'pixels', width: 8000, height: 5001 });
      expect(yield* readImage(root, 'at-cap.webp')).toMatchObject({ kind: 'image', width: 8000, height: 5000 });
    }).pipe(Effect.provide(layer));
  });

  it.effect('answers a picture whose header is cut short as not an image', () => {
    const root = tempProject();
    write(root, 'cut.png', png(10, 10).slice(0, 18));
    write(root, 'cut.jpg', bytes(0xff, 0xd8, 0xff, 0xe0, be16(16), 'JFIF'));
    return Effect.gen(function* () {
      expect(yield* readImage(root, 'cut.png')).toEqual({ kind: 'notAnImage', size: 18 });
      expect(yield* readImage(root, 'cut.jpg')).toMatchObject({ kind: 'notAnImage' });
    }).pipe(Effect.provide(layer));
  });

  it.effect('reads only files of a Project, as Files.read does', () => {
    const root = tempProject();
    write(root, 'a.png', png(1, 1));
    const stranger = mkdtempSync(path.join(tmpdir(), 'timmy-images-stranger-'));
    roots.push(stranger);
    write(stranger, 'b.png', png(1, 1));
    return Effect.gen(function* () {
      const reasons = [];
      for (const [cwd, file] of [[root, 'nope.png'], [root, '../b.png'], [stranger, 'b.png']] as const) {
        reasons.push((yield* Effect.flip(readImage(cwd, file))).reason);
      }
      expect(reasons).toEqual(['FileNotFound', 'OutsideProject', 'UnknownProject']);
    }).pipe(Effect.provide(layer));
  });
});
