import { Schema } from 'effect';

/** Most paths one listing returns. Beyond it the list is cut and `truncated` is set. */
export const MAX_LISTED_PATHS = 20_000;

/**
 * The files of a working directory: tracked plus untracked that are not ignored. Paths are
 * relative to the directory and use `/`. Folders are not listed; they derive from the paths.
 */
export const FileList = Schema.Struct({
  paths: Schema.Array(Schema.String),
  truncated: Schema.Boolean,
}).annotate({ identifier: 'FileList' });
export type FileList = typeof FileList.Type;
