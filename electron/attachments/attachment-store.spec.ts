import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from '@effect/vitest';
import { Effect, Layer } from 'effect';
import { AttachmentId } from '../../src/shared/attachments/attachment.model';
import { AttachmentStore, layerAttachmentStore } from './attachment-store';
import { ImageResizer, layerImageResizerTest } from './image-resizer';

const roots: string[] = [];
const tempDir = () => {
  const root = mkdtempSync(path.join(tmpdir(), 'timmy-store-'));
  roots.push(root);
  return path.join(root, 'attachments');
};
afterAll(() => roots.forEach((root) => rmSync(root, { recursive: true, force: true })));

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

describe('AttachmentStore', () => {
  it.effect('reads back what it stored, with its media type', () =>
    Effect.gen(function* () {
      const store = yield* AttachmentStore;
      const { id } = yield* store.add(PNG);
      const image = yield* store.read(id);
      expect(image.mediaType).toBe('image/png');
      expect(image.bytes).toEqual(PNG);
    }).pipe(Effect.provide(layerAttachmentStore(tempDir()).pipe(Layer.provide(layerImageResizerTest)))),
  );

  it.effect('stores what the resizer returns, under the type it returns', () => {
    const shrinker = Layer.succeed(
      ImageResizer,
      ImageResizer.of({ fit: () => Effect.succeed({ bytes: new Uint8Array([7, 7]), mediaType: 'image/jpeg' as const }) }),
    );
    return Effect.gen(function* () {
      const store = yield* AttachmentStore;
      const { id, mediaType } = yield* store.add(PNG);
      expect(mediaType).toBe('image/jpeg');
      expect(yield* store.read(id)).toEqual({ mediaType: 'image/jpeg', bytes: new Uint8Array([7, 7]) });
    }).pipe(Effect.provide(layerAttachmentStore(tempDir()).pipe(Layer.provide(shrinker))));
  });

  it.effect('does not find a removed image, nor an id that is not one of its own', () =>
    Effect.gen(function* () {
      const store = yield* AttachmentStore;
      const { id } = yield* store.add(PNG);
      yield* store.remove(id);
      expect((yield* store.read(id).pipe(Effect.flip)).reason).toBe('NotFound');
      expect((yield* store.read(AttachmentId.make('../secret')).pipe(Effect.flip)).reason).toBe('NotFound');
    }).pipe(Effect.provide(layerAttachmentStore(tempDir()).pipe(Layer.provide(layerImageResizerTest)))),
  );
});
