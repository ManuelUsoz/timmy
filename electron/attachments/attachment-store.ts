import { randomUUID } from 'node:crypto';
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Context, Effect, Layer } from 'effect';
import {
  AttachmentId,
  type AttachmentMediaType,
  type IngestedAttachment,
} from '../../src/shared/attachments/attachment.model';
import type { SessionId } from '../../src/shared/chat/ids.model';
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
    /** Files of a sent message leave the drafts: they now belong to the session and survive the startup sweep. */
    readonly markSent: (sessionId: SessionId, ids: ReadonlyArray<AttachmentId>) => Effect.Effect<void>;
    /** Deletes every sent file of the session. An unknown session is ignored. */
    readonly removeSession: (sessionId: SessionId) => Effect.Effect<void>;
  }
>()('attachments/AttachmentStore') {}

/** The most a stored image may weigh, after it has been scaled down. */
export const MAX_BYTES = 5 * 1024 * 1024;

const MEDIA_TYPES = Object.keys(extensionOf) as ReadonlyArray<AttachmentMediaType>;

/** Session ids name a folder, so only plain names are accepted. */
const SAFE_NAME = /^[A-Za-z0-9_-]+$/;
const SENT = 'sent';

/** Ids are ours (UUIDs). Anything else from the renderer never reaches the file system, so no path can be injected. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export const layerAttachmentStore = (dir: string): Layer.Layer<AttachmentStore, never, ImageResizer> =>
  Layer.effect(
    AttachmentStore,
    Effect.gen(function* () {
      const resizer = yield* ImageResizer;
      const fileOf = (id: string, mediaType: AttachmentMediaType, folder = dir) =>
        path.join(folder, `${id}.${extensionOf[mediaType]}`);
      const sentDir = path.join(dir, SENT);

      // Whatever is still loose in the folder was never sent: the previous run left it behind.
      yield* Effect.tryPromise(async () => {
        const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
        await Promise.all(
          entries.filter((entry) => entry.isFile()).map((entry) => rm(path.join(dir, entry.name), { force: true })),
        );
      }).pipe(Effect.orDie);

      const add = Effect.fn('AttachmentStore.add')(function* (bytes: Uint8Array) {
        const sniffed = sniffImageType(bytes);
        if (sniffed === undefined) {
          return yield* new AttachmentsError({
            reason: 'UnsupportedType',
            detail: 'The file is not a PNG, JPEG, GIF or WebP image',
          });
        }
        const image = yield* resizer.fit({ bytes, mediaType: sniffed });
        if (image.bytes.length > MAX_BYTES) {
          return yield* new AttachmentsError({ reason: 'TooLarge', detail: 'The image is over 5 MB even after scaling it down' });
        }
        const id = AttachmentId.make(randomUUID());
        yield* Effect.tryPromise(async () => {
          await mkdir(dir, { recursive: true });
          await writeFile(fileOf(id, image.mediaType), image.bytes);
        }).pipe(Effect.orDie);
        return { id, mediaType: image.mediaType };
      });

      const remove = Effect.fn('AttachmentStore.remove')(function* (id: AttachmentId) {
        if (!UUID.test(id)) return;
        const sessions = yield* Effect.tryPromise(() => readdir(sentDir)).pipe(
          Effect.catch(() => Effect.succeed([] as string[])),
        );
        const folders = [dir, ...sessions.map((name) => path.join(sentDir, name))];
        yield* Effect.tryPromise(() =>
          Promise.all(
            folders.flatMap((folder) => MEDIA_TYPES.map((mediaType) => rm(fileOf(id, mediaType, folder), { force: true }))),
          ),
        ).pipe(Effect.orDie);
      });

      const read = Effect.fn('AttachmentStore.read')(function* (id: AttachmentId) {
        const missing = new AttachmentsError({ reason: 'NotFound', detail: `No stored image ${id}` });
        if (!UUID.test(id)) return yield* missing;
        const folders = [
          dir,
          ...(yield* Effect.tryPromise(() => readdir(sentDir)).pipe(
            Effect.map((names) => names.map((name) => path.join(sentDir, name))),
            Effect.catch(() => Effect.succeed([] as string[])),
          )),
        ];
        for (const folder of folders) {
          for (const mediaType of MEDIA_TYPES) {
            const found = yield* Effect.tryPromise(() => readFile(fileOf(id, mediaType, folder))).pipe(
              Effect.map((buffer): StoredImage => ({ mediaType, bytes: new Uint8Array(buffer) })),
              Effect.catch(() => Effect.succeed(undefined)),
            );
            if (found !== undefined) return found;
          }
        }
        return yield* missing;
      });

      const markSent = Effect.fn('AttachmentStore.markSent')(function* (
        sessionId: SessionId,
        ids: ReadonlyArray<AttachmentId>,
      ) {
        const valid = ids.filter((id) => UUID.test(id));
        if (!SAFE_NAME.test(sessionId) || valid.length === 0) return;
        const folder = path.join(sentDir, sessionId);
        yield* Effect.tryPromise(async () => {
          await mkdir(folder, { recursive: true });
          await Promise.all(
            valid.flatMap((id) =>
              MEDIA_TYPES.map((mediaType) =>
                rename(fileOf(id, mediaType), fileOf(id, mediaType, folder)).catch(() => undefined),
              ),
            ),
          );
        }).pipe(Effect.orDie);
      });

      const removeSession = Effect.fn('AttachmentStore.removeSession')(function* (sessionId: SessionId) {
        if (!SAFE_NAME.test(sessionId)) return;
        yield* Effect.tryPromise(() => rm(path.join(sentDir, sessionId), { recursive: true, force: true })).pipe(
          Effect.orDie,
        );
      });

      return AttachmentStore.of({ add, remove, read, markSent, removeSession });
    }),
  );
