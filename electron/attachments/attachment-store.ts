import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Context, Effect, Layer } from 'effect';
import {
  AttachmentId,
  type AttachmentMediaType,
  type IngestedAttachment,
} from '../../src/shared/attachments/attachment.model';
import { AttachmentsError } from '../../src/shared/attachments/attachments-error.model';
import { extensionOf, sniffImageType } from './image-type';
import { ImageResizer } from './image-resizer';

/** A stored image, read back for sending. */
export interface StoredImage {
  readonly mediaType: AttachmentMediaType;
  readonly bytes: Uint8Array;
}

/**
 * Images the user added to a draft, kept as files in app data until they are sent or removed. The renderer
 * only ever holds an id. Storage failures are defects: no caller can act on them.
 */
export class AttachmentStore extends Context.Service<
  AttachmentStore,
  {
    /** Validates by magic bytes, scales the image down if needed and stores it. */
    readonly add: (bytes: Uint8Array) => Effect.Effect<IngestedAttachment, AttachmentsError>;
    /** Deletes the file. An unknown id is ignored. */
    readonly remove: (id: AttachmentId) => Effect.Effect<void>;
    /** The stored image, for the Adapter to build the provider payload. Fails with `NotFound`. */
    readonly read: (id: AttachmentId) => Effect.Effect<StoredImage, AttachmentsError>;
  }
>()('attachments/AttachmentStore') {}

const MEDIA_TYPES = Object.keys(extensionOf) as ReadonlyArray<AttachmentMediaType>;

/** Ids are ours (UUIDs). Anything else from the renderer never reaches the file system, so no path can be injected. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export const layerAttachmentStore = (dir: string): Layer.Layer<AttachmentStore, never, ImageResizer> =>
  Layer.effect(
    AttachmentStore,
    Effect.gen(function* () {
      const resizer = yield* ImageResizer;
      const fileOf = (id: string, mediaType: AttachmentMediaType) => path.join(dir, `${id}.${extensionOf[mediaType]}`);

      const add = Effect.fn('AttachmentStore.add')(function* (bytes: Uint8Array) {
        const sniffed = sniffImageType(bytes);
        if (sniffed === undefined) {
          return yield* new AttachmentsError({
            reason: 'UnsupportedType',
            detail: 'The file is not a PNG, JPEG, GIF or WebP image',
          });
        }
        const image = yield* resizer.fit({ bytes, mediaType: sniffed });
        const id = AttachmentId.make(randomUUID());
        yield* Effect.tryPromise(async () => {
          await mkdir(dir, { recursive: true });
          await writeFile(fileOf(id, image.mediaType), image.bytes);
        }).pipe(Effect.orDie);
        return { id, mediaType: image.mediaType };
      });

      const remove = Effect.fn('AttachmentStore.remove')(function* (id: AttachmentId) {
        if (!UUID.test(id)) return;
        yield* Effect.tryPromise(() =>
          Promise.all(MEDIA_TYPES.map((mediaType) => rm(fileOf(id, mediaType), { force: true }))),
        ).pipe(Effect.orDie);
      });

      const read = Effect.fn('AttachmentStore.read')(function* (id: AttachmentId) {
        const missing = new AttachmentsError({ reason: 'NotFound', detail: `No stored image ${id}` });
        if (!UUID.test(id)) return yield* missing;
        for (const mediaType of MEDIA_TYPES) {
          const found = yield* Effect.tryPromise(() => readFile(fileOf(id, mediaType))).pipe(
            Effect.map((buffer): StoredImage => ({ mediaType, bytes: new Uint8Array(buffer) })),
            Effect.catch(() => Effect.succeed(undefined)),
          );
          if (found !== undefined) return found;
        }
        return yield* missing;
      });

      return AttachmentStore.of({ add, remove, read });
    }),
  );
