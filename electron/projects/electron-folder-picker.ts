import { dialog } from 'electron';
import { Effect, Layer, Option } from 'effect';
import { appWindow } from '../window/app-window';
import { FolderPicker } from './folder-picker';

/** The native folder dialog, attached to the app window when there is one. */
export const layerElectronFolderPicker: Layer.Layer<FolderPicker> = Layer.succeed(FolderPicker, {
  pick: Effect.promise(async () => {
    const options = { properties: ['openDirectory' as const] };
    const win = appWindow();
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
    return Option.fromNullishOr(result.canceled ? undefined : result.filePaths[0]);
  }),
});
