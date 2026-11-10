import { Effect } from 'effect';
import type { FilesError } from '../../../shared/files/files-error.model';
import type { ImageType } from '../../../shared/files/files.model';
import { DesktopApi } from '../../core/desktop-api';

/** A picture main sent: its bytes, type, weight and size in pixels (none for an SVG until it is drawn). */
export interface Picture {
  readonly type: ImageType;
  readonly bytes: Uint8Array;
  readonly size: number;
  readonly width: number | null;
  readonly height: number | null;
}

/**
 * What reading the file of a File View gave. `gone` is a file deleted since it was listed or opened. `binary` carries its
 * size once main has said it is not an image; `imageTooLarge` names the cap the picture is over.
 */
export type FileState =
  | { readonly status: 'loading' }
  | { readonly status: 'text'; readonly content: string }
  | { readonly status: 'image'; readonly picture: Picture }
  | { readonly status: 'binary'; readonly size: number }
  | { readonly status: 'tooLarge'; readonly size: number }
  | { readonly status: 'imageTooLarge'; readonly limit: 'bytes'; readonly size: number }
  | { readonly status: 'imageTooLarge'; readonly limit: 'pixels'; readonly width: number; readonly height: number }
  | { readonly status: 'notAnImage' }
  | { readonly status: 'gone' }
  | { readonly status: 'unreadable' }
  | { readonly status: 'failed'; readonly detail: string };

const fromError = (error: FilesError): FileState =>
  error.reason === 'FileNotFound' ? { status: 'gone' } : error.reason === 'Unreadable' ? { status: 'unreadable' } : { status: 'failed', detail: error.detail };

/**
 * The file as a picture, from `Files.readImage` (its type from its bytes, the caps checked in main). `otherwise` is what
 * shows when it is not an image at all, given its size.
 */
export const readPicture = (cwd: string, file: string, otherwise: (size: number) => FileState) =>
  Effect.flatMap(DesktopApi, (desktop) => desktop['Files.readImage']({ cwd, file })).pipe(
    Effect.map((content): FileState => {
      switch (content.kind) {
        case 'image':
          return { status: 'image', picture: { type: content.type, bytes: content.bytes, size: content.size, width: content.width, height: content.height } };
        case 'tooLarge':
          return content.limit === 'bytes'
            ? { status: 'imageTooLarge', limit: 'bytes', size: content.size }
            : { status: 'imageTooLarge', limit: 'pixels', width: content.width, height: content.height };
        case 'notAnImage':
          return otherwise(content.size);
      }
    }),
    Effect.catchTag('FilesError', (error) => Effect.succeed(fromError(error))),
  );

/**
 * Reads a file of the Project into what a File View shows. Text is text, whatever its name (an SVG too: it is drawn only on
 * request). What is not text is asked for as an image, so a picture is told by its bytes, under or over the text limit;
 * anything else is binary (with its size) or too large.
 */
export const readFile = (cwd: string, file: string) =>
  Effect.flatMap(DesktopApi, (desktop) => desktop['Files.read']({ cwd, file })).pipe(
    Effect.flatMap((content) => {
      switch (content.kind) {
        case 'text':
          return Effect.succeed<FileState>({ status: 'text', content: content.content });
        case 'binary':
          return readPicture(cwd, file, (size) => ({ status: 'binary', size }));
        case 'tooLarge':
          return readPicture(cwd, file, () => ({ status: 'tooLarge', size: content.size }));
      }
    }),
    Effect.catchTag('FilesError', (error) => Effect.succeed(fromError(error))),
  );
