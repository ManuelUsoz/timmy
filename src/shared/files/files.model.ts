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

/** Every folder that holds at least one of `paths`: each proper prefix ending before a `/`. */
export const foldersOf = (paths: ReadonlyArray<string>): ReadonlySet<string> => {
  const folders = new Set<string>();
  for (const file of paths) {
    for (let slash = file.indexOf('/'); slash !== -1; slash = file.indexOf('/', slash + 1)) {
      folders.add(file.slice(0, slash));
    }
  }
  return folders;
};
