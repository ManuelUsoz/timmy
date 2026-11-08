import { Schema } from 'effect';
import { Rpc, RpcGroup } from 'effect/rpc';
import { FilesError } from './files-error.model';
import { ProjectId } from '../projects/projects.model';
import { FileContent, FileList, FilesBrowserState, FolderListing, ProjectBrowserState } from './files.model';

/** What the `@` popup (and later Mention validation) knows about a working directory's files. */
export const FilesRpcs = RpcGroup.make(
  /** Files of `cwd` as git sees them (tracked plus untracked, ignored ones excluded). Fails if git does. */
  Rpc.make('Files.list', {
    payload: { cwd: Schema.String },
    success: FileList,
    error: FilesError,
  }),
  /** The children of one folder of `cwd`, read when the user expands it. `dir` is relative to `cwd`, with `/`; '' is the root. */
  Rpc.make('Files.listDir', {
    payload: { cwd: Schema.String, dir: Schema.String },
    success: FolderListing,
    error: FilesError,
  }),
  /** One file of `cwd` for the preview. `file` is relative to `cwd`, with `/`. */
  Rpc.make('Files.read', {
    payload: { cwd: Schema.String, file: Schema.String },
    success: FileContent,
    error: FilesError,
  }),
  /** What the browser remembers for a Project, with the window's width. Defaults when nothing (readable) was saved. */
  Rpc.make('Files.getState', { payload: { projectId: ProjectId }, success: FilesBrowserState }),
  /** Remembers the browser's state for a Project. */
  Rpc.make('Files.saveState', { payload: { projectId: ProjectId, ...ProjectBrowserState.fields } }),
  /** Remembers the browser's width, which is the same for every Project. */
  Rpc.make('Files.saveWidth', { payload: { width: Schema.Int } }),
);
