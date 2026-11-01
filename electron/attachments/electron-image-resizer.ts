import { nativeImage } from 'electron';
import { Effect, Layer } from 'effect';
import { ImageResizer, MAX_EDGE, type FittedImage } from './image-resizer';

/** Electron's `nativeImage`. It cannot encode GIF or WebP, so an oversized one is stored as PNG. */
export const layerElectronImageResizer: Layer.Layer<ImageResizer> = Layer.succeed(
  ImageResizer,
  ImageResizer.of({
    fit: (image) =>
      Effect.sync((): FittedImage => {
        const source = nativeImage.createFromBuffer(Buffer.from(image.bytes));
        const { width, height } = source.getSize();
        const longest = Math.max(width, height);
        // An unreadable image (size 0) is kept as it is: the provider will say what it thinks of it.
        if (longest === 0 || longest <= MAX_EDGE) return image;
        const scale = MAX_EDGE / longest;
        const resized = source.resize({
          width: Math.round(width * scale),
          height: Math.round(height * scale),
          quality: 'best',
        });
        return image.mediaType === 'image/jpeg'
          ? { bytes: new Uint8Array(resized.toJPEG(90)), mediaType: 'image/jpeg' }
          : { bytes: new Uint8Array(resized.toPNG()), mediaType: 'image/png' };
      }),
  }),
);
