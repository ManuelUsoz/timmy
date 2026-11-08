import { execFile } from 'node:child_process';
import { readdir, readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { Context, Effect, Layer } from 'effect';
import { FilesError } from '../../src/shared/files/files-error.model';
import { MAX_LISTED_PATHS, MAX_PREVIEW_BYTES, type FileContent, type FileList, type FolderEntry, type FolderListing } from '../../src/shared/files/files.model';

/**
 * What the Files browser reads of a working directory. `list` is the flat index of what git sees (no disk walk);
 * `listDir` reads one folder from disk when the user expands it, so ignored folders can be browsed without being crawled.
 */
export class ProjectFiles extends Context.Service<
  ProjectFiles,
  {
    readonly list: (cwd: string) => Effect.Effect<FileList, FilesError>;
    readonly listDir: (cwd: string, dir: string) => Effect.Effect<FolderListing, FilesError>;
    readonly read: (cwd: string, file: string) => Effect.Effect<FileContent, FilesError>;
  }
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

/**
 * Which of `candidates` git ignores. Folders end in `/` so patterns like `node_modules/` match them. Outside a repository,
 * or when git is missing, nothing is reported as ignored: the tree still works, it just does not dim anything.
 */
const ignoredAmong = (cwd: string, candidates: ReadonlyArray<string>): Effect.Effect<ReadonlySet<string>> =>
  candidates.length === 0
    ? Effect.succeed(new Set<string>())
    : Effect.callback<ReadonlySet<string>>((resume) => {
        const child = execFile(
          'git',
          ['check-ignore', '-z', '--stdin'],
          { cwd, windowsHide: true, maxBuffer: 64 * 1024 * 1024 },
          // Exit 1 means none is ignored, 128 means not a repository: both read as "nothing ignored".
          (error, stdout) => resume(Effect.succeed(new Set(error === null ? stdout.split('\0').filter((entry) => entry !== '') : []))),
        );
        // Git missing or exiting early closes the pipe under the write: that is the callback's answer ("nothing ignored"), not a crash.
        child.stdin?.on('error', () => undefined);
        child.stdin?.end(candidates.join('\0') + '\0');
      });

const byFoldersThenName = (a: FolderEntry, b: FolderEntry): number =>
  a.kind === b.kind ? (a.name.toLowerCase() < b.name.toLowerCase() ? -1 : 1) : a.kind === 'folder' ? -1 : 1;

/** Whether `target` is `root` or something below it. */
const isInside = (root: string, target: string): boolean => {
  const from = path.relative(root, target);
  return !path.isAbsolute(from) && from !== '..' && !from.startsWith(`..${path.sep}`);
};

/**
 * The real path, links resolved. What does not exist yet (a file deleted since it was listed) keeps its own name but gets the
 * real path of the deepest folder that does exist, so it is compared with the Project root on the same terms: a Project
 * reached through a link or a short Windows name must report a missing file as missing, not as outside.
 */
const resolveExisting = async (target: string): Promise<string> => {
  try {
    return await realpath(target);
  } catch (error) {
    const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined;
    const parent = path.dirname(target);
    if ((code !== 'ENOENT' && code !== 'ENOTDIR') || parent === target) return Promise.reject(error);
    return path.join(await resolveExisting(parent), path.basename(target));
  }
};

const realPathOr = (target: string): Effect.Effect<string> =>
  Effect.tryPromise(() => resolveExisting(target)).pipe(Effect.orElseSucceed(() => target));

/**
 * The absolute path of `relative` inside `cwd`. The renderer is untrusted, so `..`, an absolute path, another drive and a
 * link that leads out of the Project are refused before the disk is touched.
 */
const confine = Effect.fn('ProjectFiles.confine')(function* (cwd: string, relative: string) {
  const root = path.resolve(cwd);
  const target = path.resolve(root, relative);
  const outside = new FilesError({ reason: 'OutsideProject', detail: `${relative} is outside the Project folder` });
  if (path.isAbsolute(relative) || !isInside(root, target)) return yield* outside;
  if (!isInside(yield* realPathOr(root), yield* realPathOr(target))) return yield* outside;
  return target;
});

/**
 * What a failed disk call means for the caller: the file or folder is not there (it was deleted since it was listed), or it
 * is there and cannot be read (permissions, a lock). Both are things the user can act on, so neither is a defect.
 */
export const fsFailure = (error: unknown, kind: 'file' | 'folder', subject: string): FilesError => {
  const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined;
  if (code === 'ENOENT' || code === 'ENOTDIR') {
    return new FilesError({ reason: kind === 'file' ? 'FileNotFound' : 'FolderNotFound', detail: `${subject} does not exist` });
  }
  return new FilesError({ reason: 'Unreadable', detail: `${subject} could not be read` });
};

const readFolder = Effect.fn('ProjectFiles.listDir')(function* (cwd: string, dir: string) {
  const target = yield* confine(cwd, dir);
  const subject = dir === '' ? cwd : dir;
  const info = yield* Effect.tryPromise({ try: () => stat(target), catch: (error) => fsFailure(error, 'folder', subject) });
  if (!info.isDirectory()) return yield* new FilesError({ reason: 'FolderNotFound', detail: `${subject} is not a folder` });
  const dirents = yield* Effect.tryPromise({
    try: () => readdir(target, { withFileTypes: true }),
    catch: (error) => fsFailure(error, 'folder', subject),
  });
  const children = dirents
    .filter((dirent) => dirent.name !== '.git')
    .map((dirent) => ({ name: dirent.name, kind: dirent.isDirectory() ? ('folder' as const) : ('file' as const) }));
  const relative = (child: { readonly name: string; readonly kind: 'file' | 'folder' }) =>
    `${dir === '' ? '' : `${dir}/`}${child.name}${child.kind === 'folder' ? '/' : ''}`;
  const ignored = yield* ignoredAmong(cwd, children.map(relative));
  const entries = children.map((child) => ({ ...child, ignored: ignored.has(relative(child)) })).sort(byFoldersThenName);
  return { entries } satisfies FolderListing;
});

/** How far into a file a NUL byte still marks it as binary. */
const BINARY_SNIFF_BYTES = 8192;

const utf8 = new TextDecoder('utf-8', { fatal: true });

/** Text when the bytes are UTF-8 with no NUL near the start; binary otherwise. */
const toFileContent = (bytes: Uint8Array): FileContent => {
  if (bytes.subarray(0, BINARY_SNIFF_BYTES).includes(0)) return { kind: 'binary' };
  try {
    return { kind: 'text', content: utf8.decode(bytes) };
  } catch {
    return { kind: 'binary' };
  }
};

/** The size of a regular file. A folder, or a path that is not there, is not a file. */
const fileSize = (target: string, file: string): Effect.Effect<number, FilesError> =>
  Effect.tryPromise({ try: () => stat(target), catch: (error) => fsFailure(error, 'file', file) }).pipe(
    Effect.flatMap((info) =>
      info.isFile() ? Effect.succeed(info.size) : Effect.fail(new FilesError({ reason: 'FileNotFound', detail: `${file} is not a file` })),
    ),
  );

const readFileContent = Effect.fn('ProjectFiles.read')(function* (cwd: string, file: string) {
  const target = yield* confine(cwd, file);
  const size = yield* fileSize(target, file);
  // Checked before reading: a big file's content never reaches memory, let alone the renderer.
  if (size > MAX_PREVIEW_BYTES) return { kind: 'tooLarge', size } satisfies FileContent;
  const bytes = yield* Effect.tryPromise({ try: () => readFile(target), catch: (error) => fsFailure(error, 'file', file) });
  return toFileContent(bytes);
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
    listDir: readFolder,
    read: readFileContent,
  });
