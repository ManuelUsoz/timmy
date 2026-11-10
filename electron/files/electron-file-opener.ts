import { shell } from 'electron';
import { Effect, Layer } from 'effect';
import { FileOpener } from './file-opener';

/** The system's app for the file, through Electron's shell. A failure to launch it is not something the user can act on here. */
export const layerElectronFileOpener: Layer.Layer<FileOpener> = Layer.succeed(FileOpener, {
  open: (absolutePath) =>
    Effect.promise(() => shell.openPath(absolutePath)).pipe(
      Effect.flatMap((failure) => (failure === '' ? Effect.void : Effect.die(`${absolutePath} could not be opened: ${failure}`))),
    ),
});
