import { Context, Effect, Layer } from 'effect';

/**
 * Opens a file outside Timmy, with the app the system has for it (the user's editor for source files). The only part of
 * the Files domain that needs Electron's shell; it is given an absolute path already confined to a Project.
 */
export class FileOpener extends Context.Service<
  FileOpener,
  {
    readonly open: (absolutePath: string) => Effect.Effect<void>;
  }
>()('files/FileOpener') {}

/** An opener that only records what it was asked to open, for tests of the layers above it and for the e2e app. */
export const layerFileOpenerTest = (opened: string[] = []): Layer.Layer<FileOpener> =>
  Layer.succeed(FileOpener, { open: (absolutePath) => Effect.sync(() => void opened.push(absolutePath)) });
