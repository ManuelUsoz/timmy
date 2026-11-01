import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from '@effect/vitest';
import { Effect, Layer } from 'effect';
import { DesktopApi } from '../../src/app/core/desktop-api';
import {
  layerChatUnused,
  layerFilesUnused,
  layerProjectsUnused,
  layerSessionsUnused,
  layerSettingsUnused,
  layerWindowUnused,
  makeDesktopTestLayer,
} from '../../src/app/core/desktop-layers';
import { AppInfoRpcs } from '../../src/shared/app-info/app-info.rpc';
import { AttachmentId } from '../../src/shared/attachments/attachment.model';
import { layerAttachmentStore } from '../attachments/attachment-store';
import { layerImageResizerTest } from '../attachments/image-resizer';
import { layerAttachmentsHandlers } from './attachments';

const roots: string[] = [];
const makeLayer = () => {
  const root = mkdtempSync(path.join(tmpdir(), 'timmy-attachments-'));
  roots.push(root);
  const dir = path.join(root, 'attachments');
  const layer = makeDesktopTestLayer(
    Layer.mergeAll(
      layerAttachmentsHandlers.pipe(Layer.provide(layerAttachmentStore(dir).pipe(Layer.provide(layerImageResizerTest)))),
      AppInfoRpcs.toLayer({ 'AppInfo.get': () => Effect.die('unused') }),
      layerChatUnused,
      layerSessionsUnused,
      layerWindowUnused,
      layerSettingsUnused,
      layerFilesUnused,
      layerProjectsUnused,
    ),
  );
  return { dir, layer };
};

afterAll(() => roots.forEach((root) => rmSync(root, { recursive: true, force: true })));

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1]);
const GIF = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 1]);
const WEBP = new Uint8Array([0x52, 0x49, 0x46, 0x46, 9, 9, 9, 9, 0x57, 0x45, 0x42, 0x50, 1]);
const WAV = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x41, 0x56, 0x45]);

describe('Attachments.add', () => {
  it.effect('stores each accepted image type under its own id and says which type it found', () => {
    const { dir, layer } = makeLayer();
    return Effect.gen(function* () {
      const api = yield* DesktopApi;
      const found = [];
      for (const bytes of [PNG, JPEG, GIF, WEBP]) found.push(yield* api['Attachments.add']({ bytes }));
      expect(found.map((a) => a.mediaType)).toEqual(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
      expect(new Set(found.map((a) => a.id)).size).toBe(4);
      expect(readdirSync(dir)).toHaveLength(4);
      expect(readFileSync(path.join(dir, `${found[0]?.id}.png`))).toEqual(Buffer.from(PNG));
    }).pipe(Effect.provide(layer));
  });

  it.effect('refuses bytes that are not an accepted image and stores nothing', () => {
    const { dir, layer } = makeLayer();
    return Effect.gen(function* () {
      const api = yield* DesktopApi;
      const text = yield* api['Attachments.add']({ bytes: new TextEncoder().encode('<html>no</html>') }).pipe(Effect.flip);
      expect(text.reason).toBe('UnsupportedType');
      // RIFF without WEBP is a WAV or AVI, not an image.
      const riff = yield* api['Attachments.add']({ bytes: WAV }).pipe(Effect.flip);
      expect(riff.reason).toBe('UnsupportedType');
      expect(existsSync(dir)).toBe(false);
    }).pipe(Effect.provide(layer));
  });
});

describe('Attachments.remove', () => {
  it.effect('deletes the stored file and ignores an id it does not know', () => {
    const { dir, layer } = makeLayer();
    return Effect.gen(function* () {
      const api = yield* DesktopApi;
      const { id } = yield* api['Attachments.add']({ bytes: PNG });
      expect(readdirSync(dir)).toHaveLength(1);
      yield* api['Attachments.remove']({ id });
      expect(readdirSync(dir)).toHaveLength(0);
      yield* api['Attachments.remove']({ id });
      yield* api['Attachments.remove']({ id: AttachmentId.make('../../settings') });
    }).pipe(Effect.provide(layer));
  });
});
