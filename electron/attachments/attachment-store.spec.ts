import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from '@effect/vitest';
import { Effect, Layer } from 'effect';
import { SessionId } from '../../src/shared/chat/ids.model';
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

  it.effect('refuses a file that is not an image, even one named like an image', () =>
    Effect.gen(function* () {
      const store = yield* AttachmentStore;
      const error = yield* store.add(new TextEncoder().encode('not an image.png')).pipe(Effect.flip);
      expect(error.reason).toBe('UnsupportedType');
    }).pipe(Effect.provide(layerAttachmentStore(tempDir()).pipe(Layer.provide(layerImageResizerTest)))),
  );

  it.effect('refuses an image that is still over 5 MB after resizing, and accepts one just under', () => {
    const sized = (length: number) =>
      Layer.succeed(
        ImageResizer,
        ImageResizer.of({ fit: () => Effect.succeed({ bytes: new Uint8Array(length), mediaType: 'image/png' as const }) }),
      );
    return Effect.gen(function* () {
      const big = yield* Effect.provide(
        AttachmentStore.use((store) => store.add(PNG)).pipe(Effect.flip),
        layerAttachmentStore(tempDir()).pipe(Layer.provide(sized(5 * 1024 * 1024 + 1))),
      );
      expect(big.reason).toBe('TooLarge');
      const ok = yield* Effect.provide(
        AttachmentStore.use((store) => store.add(PNG)),
        layerAttachmentStore(tempDir()).pipe(Layer.provide(sized(5 * 1024 * 1024))),
      );
      expect(ok.mediaType).toBe('image/png');
    });
  });

  describe('cleanup', () => {
    const layerAt = (dir: string) => layerAttachmentStore(dir).pipe(Layer.provide(layerImageResizerTest));
    const files = (dir: string) => (existsSync(dir) ? readdirSync(dir) : []);
    const s1 = SessionId.make('s1');
    const s2 = SessionId.make('s2');

    it.effect('removing a draft deletes its file', () => {
      const dir = tempDir();
      return Effect.gen(function* () {
        const store = yield* AttachmentStore;
        const { id } = yield* store.add(PNG);
        expect(files(dir)).toHaveLength(1);
        yield* store.remove(id);
        expect(files(dir)).toEqual([]);
      }).pipe(Effect.provide(layerAt(dir)));
    });

    it.effect('removing a draft whose send failed after it was marked sent still deletes it', () => {
      const dir = tempDir();
      return Effect.gen(function* () {
        const store = yield* AttachmentStore;
        const { id } = yield* store.add(PNG);
        yield* store.markSent(s1, [id]);
        yield* store.remove(id);
        expect((yield* store.read(id).pipe(Effect.flip)).reason).toBe('NotFound');
      }).pipe(Effect.provide(layerAt(dir)));
    });

    it.effect('sweeps unsent drafts on start and keeps sent ones readable', () => {
      const dir = tempDir();
      return Effect.gen(function* () {
        const first = yield* Effect.provide(
          Effect.gen(function* () {
            const store = yield* AttachmentStore;
            const sent = yield* store.add(PNG);
            const draft = yield* store.add(PNG);
            yield* store.markSent(s1, [sent.id]);
            return { sent: sent.id, draft: draft.id };
          }),
          layerAt(dir),
        );
        // A new start of the app.
        yield* Effect.provide(
          Effect.gen(function* () {
            const store = yield* AttachmentStore;
            expect((yield* store.read(first.draft).pipe(Effect.flip)).reason).toBe('NotFound');
            expect((yield* store.read(first.sent)).bytes).toEqual(PNG);
          }),
          layerAt(dir),
        );
      });
    });

    it.effect('deleting a session removes only its sent files', () => {
      const dir = tempDir();
      return Effect.gen(function* () {
        const store = yield* AttachmentStore;
        const a = yield* store.add(PNG);
        const b = yield* store.add(PNG);
        yield* store.markSent(s1, [a.id]);
        yield* store.markSent(s2, [b.id]);
        yield* store.removeSession(s1);
        expect((yield* store.read(a.id).pipe(Effect.flip)).reason).toBe('NotFound');
        expect((yield* store.read(b.id)).bytes).toEqual(PNG);
        yield* store.removeSession(SessionId.make('unknown'));
      }).pipe(Effect.provide(layerAt(dir)));
    });

    it.effect('ignores ids and sessions that are not its own', () => {
      const dir = tempDir();
      return Effect.gen(function* () {
        const store = yield* AttachmentStore;
        yield* store.markSent(s1, [AttachmentId.make('../secret'), AttachmentId.make('00000000-0000-4000-8000-000000000000')]);
        yield* store.removeSession(SessionId.make('../..'));
      }).pipe(Effect.provide(layerAt(dir)));
    });
  });
});
