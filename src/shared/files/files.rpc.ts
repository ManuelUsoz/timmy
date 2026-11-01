import { Schema } from 'effect';
import { Rpc, RpcGroup } from 'effect/rpc';
import { FilesError } from './files-error.model';
import { FileList } from './files.model';

/** What the `@` popup (and later Mention validation) knows about a working directory's files. */
export const FilesRpcs = RpcGroup.make(
  /** Files of `cwd` as git sees them (tracked plus untracked, ignored ones excluded). Fails if git does. */
  Rpc.make('Files.list', {
    payload: { cwd: Schema.String },
    success: FileList,
    error: FilesError,
  }),
);
