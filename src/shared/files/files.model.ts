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

/** How a Changed file differs from the last commit (GLOSSARY: Changed file). Staged and unstaged are not told apart. */
export const ChangeKind = Schema.Literals(['modified', 'added', 'untracked', 'deleted', 'renamed']).annotate({ identifier: 'ChangeKind' });
export type ChangeKind = typeof ChangeKind.Type;

/**
 * One entry of the Project's `git status`. `path` is relative to the Project, with `/` and no trailing slash. `folder` is a
 * wholly untracked folder (one entry, whatever it holds) or a submodule (one `modified` entry, never its files).
 */
export const ChangedFile = Schema.Struct({
  path: Schema.String,
  kind: ChangeKind,
  folder: Schema.Boolean,
}).annotate({ identifier: 'ChangedFile' });
export type ChangedFile = typeof ChangedFile.Type;

/** Every Changed file of a Project, as git reports them; a staged rename is one `renamed` entry at its new path. */
export const ChangedFiles = Schema.Struct({
  entries: Schema.Array(ChangedFile),
}).annotate({ identifier: 'ChangedFiles' });
export type ChangedFiles = typeof ChangedFiles.Type;

/** One thing inside a folder. `ignored` is what git ignores (dimmed in the tree). A symlink is a file: it is never followed. */
export const FolderEntry = Schema.Struct({
  name: Schema.String,
  kind: Schema.Literals(['file', 'folder']),
  ignored: Schema.Boolean,
}).annotate({ identifier: 'FolderEntry' });
export type FolderEntry = typeof FolderEntry.Type;

/** The direct children of one folder, folders first, each group by name. `.git` is never listed. */
export const FolderListing = Schema.Struct({
  entries: Schema.Array(FolderEntry),
}).annotate({ identifier: 'FolderListing' });
export type FolderListing = typeof FolderListing.Type;

/** Largest file the browser previews, in bytes. A bigger one is not read at all. */
export const MAX_PREVIEW_BYTES = 1_048_576;

/**
 * What the browser can show of a file. Text is the whole content, decoded as UTF-8; a file that is not valid UTF-8 or
 * holds a NUL byte near its start is `binary`; one over `MAX_PREVIEW_BYTES` is `tooLarge` and its content never leaves main.
 */
export const FileContent = Schema.Union([
  Schema.Struct({ kind: Schema.Literal('text'), content: Schema.String }),
  Schema.Struct({ kind: Schema.Literal('binary') }),
  Schema.Struct({ kind: Schema.Literal('tooLarge'), size: Schema.Number }),
]).annotate({ identifier: 'FileContent' });
export type FileContent = typeof FileContent.Type;

/**
 * Where a Path link leads (GLOSSARY: Path link): a file of the Project, relative to it with `/`, and the lines its
 * position names (`:42` and `(42,7)` are line 42, `:42-50` lines 42 to 50; a column is dropped). No position: both null.
 */
export const PathLinkTarget = Schema.Struct({
  path: Schema.String,
  start: Schema.NullOr(Schema.Int),
  end: Schema.NullOr(Schema.Int),
}).annotate({ identifier: 'PathLinkTarget' });
export type PathLinkTarget = typeof PathLinkTarget.Type;

/** Width of the Files browser the first time, in pixels. */
export const DEFAULT_BROWSER_WIDTH = 360;

/**
 * What the Files browser remembers of one Project: the folders open in its tree, and the last file picked, which the
 * tree highlights. A file is read in a File View (ADR 0013), never in the sidebar; a state saved while the sidebar was
 * also a reader still decodes, its `view` ignored.
 */
export const ProjectBrowserState = Schema.Struct({
  expanded: Schema.Array(Schema.String),
  lastFile: Schema.NullOr(Schema.String),
}).annotate({ identifier: 'ProjectBrowserState' });
export type ProjectBrowserState = typeof ProjectBrowserState.Type;

/** A Project's remembered state with the width, which is one for the whole window. */
export const FilesBrowserState = Schema.Struct({
  width: Schema.Int,
  ...ProjectBrowserState.fields,
}).annotate({ identifier: 'FilesBrowserState' });
export type FilesBrowserState = typeof FilesBrowserState.Type;

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
