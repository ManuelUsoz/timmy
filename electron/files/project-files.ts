import { execFile } from 'node:child_process';
import { stat } from 'node:fs/promises';
import { Context, Effect, Layer } from 'effect';
import { FilesError } from '../../src/shared/files/files-error.model';
import { MAX_LISTED_PATHS, type FileList } from '../../src/shared/files/files.model';

/** The file listing of a working directory. Git is the source of truth: there is no disk walk. */
export class ProjectFiles extends Context.Service<
  ProjectFiles,
  { readonly list: (cwd: string) => Effect.Effect<FileList, FilesError> }
>()('files/ProjectFiles') {}

const gitFailure = (error: unknown, stderr: string): FilesError => {
  const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined;
  if (code === 'ENOENT') {
    return new FilesError({ reason: 'GitUnavailable', detail: 'git is not installed, or it is not on the PATH' });
  }
  const text = stderr.trim();
  return /not a git repository/i.test(text)
    ? new FilesError({ reason: 'NotAGitRepository', detail: text })
    : new FilesError({ reason: 'GitFailed', detail: text === '' ? 'git ls-files failed' : text });
};

const isDirectory = (target: string): Effect.Effect<boolean> =>
  Effect.tryPromise(() => stat(target)).pipe(
    Effect.map((info) => info.isDirectory()),
    Effect.orElseSucceed(() => false),
  );

const runLsFiles = (cwd: string): Effect.Effect<string, FilesError> =>
  Effect.callback<string, FilesError>((resume) => {
    execFile(
      'git',
      ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--deduplicate'],
      { cwd, windowsHide: true, maxBuffer: 256 * 1024 * 1024 },
      (error, stdout, stderr) => {
        resume(error === null ? Effect.succeed(stdout) : Effect.fail(gitFailure(error, stderr)));
      },
    );
  });

/** Splits git's NUL-separated output and applies the cap. */
export const toFileList = (output: string, limit: number): FileList => {
  const all = output.split('\0').filter((entry) => entry !== '');
  return { paths: all.slice(0, limit), truncated: all.length > limit };
};

export const layerProjectFiles = (limit: number = MAX_LISTED_PATHS) =>
  Layer.succeed(ProjectFiles, {
    list: Effect.fn('ProjectFiles.list')(function* (cwd: string) {
      if (!(yield* isDirectory(cwd))) {
        return yield* new FilesError({ reason: 'FolderNotFound', detail: `${cwd} is not a folder` });
      }
      return toFileList(yield* runLsFiles(cwd), limit);
    }),
  });
