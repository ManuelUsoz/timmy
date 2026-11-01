import { Context, Effect, Layer, Option } from 'effect';

/** The system dialog that asks the user for a folder. The only part of project management that needs a window. */
export class FolderPicker extends Context.Service<
  FolderPicker,
  {
    /** The chosen folder; `None` when the user cancels. */
    readonly pick: Effect.Effect<Option.Option<string>>;
  }
>()('projects/FolderPicker') {}

/** A picker that answers with `choice` every time, for tests of the layers above it. */
export const layerFolderPickerTest = (choice: Option.Option<string> = Option.none()): Layer.Layer<FolderPicker> =>
  Layer.succeed(FolderPicker, { pick: Effect.succeed(choice) });
