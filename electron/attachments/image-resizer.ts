import { Context, Effect, Layer } from 'effect';
import type { AttachmentMediaType } from '../../src/shared/attachments/attachment.model';

/** The longest edge, in pixels, of a stored image; larger ones are scaled down before they are kept. */
export const MAX_EDGE = 1568;

export interface FittedImage {
  readonly bytes: Uint8Array;
  readonly mediaType: AttachmentMediaType;
}

/** Scales an image down to `MAX_EDGE`. Images already small enough come back untouched. */
export class ImageResizer extends Context.Service<
  ImageResizer,
  { readonly fit: (image: FittedImage) => Effect.Effect<FittedImage> }
>()('attachments/ImageResizer') {}

/** Keeps images as they are, for tests that run without Electron. */
export const layerImageResizerTest: Layer.Layer<ImageResizer> = Layer.succeed(
  ImageResizer,
  ImageResizer.of({ fit: (image) => Effect.succeed(image) }),
);
