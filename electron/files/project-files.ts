import { execFile } from 'node:child_process';
import { readdir, readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { Context, Effect, Layer } from 'effect';
import { FilesError } from '../../src/shared/files/files-error.model';
import {
  MAX_LISTED_PATHS,
  MAX_PREVIEW_BYTES,
  type ChangedFile,
  type ChangedFiles,
  type ChangeKind,
  type DiffLine,
  type FileContent, type FileDiff, type FileList, type FolderEntry, type FolderListing } from '../../src/shared/files/files.model';

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
    /** The absolute path of an existing file of `cwd`, confined to it as `read` is. */
    readonly locate: (cwd: string, file: string) => Effect.Effect<string, FilesError>;
    readonly changes: (cwd: string) => Effect.Effect<ChangedFiles, FilesError>;
    readonly diff: (cwd: string, file: string) => Effect.Effect<FileDiff, FilesError>;
  }
>()('files/ProjectFiles') {}

const gitFailure = (error: unknown, stderr: string, command: string): FilesError => {
  const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined;
  if (code === 'ENOENT') {
    return new FilesError({ reason: 'GitUnavailable', detail: 'git is not installed, or it is not on the PATH' });
  }
  const text = stderr.trim();
  return /not a git repository/i.test(text)
    ? new FilesError({ reason: 'NotAGitRepository', detail: text })
    : new FilesError({ reason: 'GitFailed', detail: text === '' ? `git ${command} failed` : text });
};

const isDirectory = (target: string): Effect.Effect<boolean> =>
  Effect.tryPromise(() => stat(target)).pipe(
    Effect.map((info) => info.isDirectory()),
    Effect.orElseSucceed(() => false),
  );

/**
 * Runs git in `cwd` and answers its output. Always without optional locks: a read must never write the user's index, nor
 * hold a lock another git command of theirs could trip on.
 */
const runGit = (cwd: string, args: ReadonlyArray<string>): Effect.Effect<string, FilesError> =>
  Effect.callback<string, FilesError>((resume) => {
    execFile('git', ['--no-optional-locks', ...args], { cwd, windowsHide: true, maxBuffer: 256 * 1024 * 1024 }, (error, stdout, stderr) => {
      resume(error === null ? Effect.succeed(stdout) : Effect.fail(gitFailure(error, stderr, args[0] ?? '')));
    });
  });

const splitNul = (output: string): ReadonlyArray<string> => output.split('\0').filter((entry) => entry !== '');

/** What `status --porcelain=v2` puts before the path, per kind of record: ordinary, rename or copy, unmerged. */
const FIELDS_BEFORE_PATH: Readonly<Record<string, number>> = { '1': 8, '2': 9, u: 10 };

/** The kind of a tracked entry from its staged and unstaged letters. Not on disk is deleted, whatever was staged. */
const kindOf = (record: string, xy: string): ChangeKind => {
  if (xy.includes('D')) return 'deleted';
  if (record === '2') return xy[0] === 'C' ? 'added' : 'renamed';
  if (xy[0] === 'A') return 'added';
  return 'modified';
};

/**
 * Reads `git status --porcelain=v2 -z` output. Paths in it are relative to the repository root; `prefix` (the Project's
 * place in the repository, ending in `/`, or '') is cut off, so they are relative to the Project. A rename carries its old
 * path as one more field, which is skipped: git's own view puts the rename at its new path.
 */
export const parseStatus = (output: string, prefix: string): ReadonlyArray<ChangedFile> => {
  const fields = output.split('\0');
  const entries: ChangedFile[] = [];
  for (let at = 0; at < fields.length; at++) {
    const line = fields[at]!;
    const record = line.slice(0, 1);
    let raw: string;
    let kind: ChangeKind;
    let submodule = false;
    if (record === '?') {
      raw = line.slice(2);
      kind = 'untracked';
    } else if (record in FIELDS_BEFORE_PATH) {
      const parts = line.split(' ');
      const count = FIELDS_BEFORE_PATH[record]!;
      raw = parts.slice(count).join(' ');
      kind = kindOf(record, parts[1] ?? '');
      submodule = (parts[2] ?? '').startsWith('S');
      if (record === '2') at++;
    } else {
      // Headers, ignored entries and the empty field after the last NUL.
      continue;
    }
    const folder = submodule || raw.endsWith('/');
    const fromRoot = raw.replace(/\/$/, '');
    if (!fromRoot.startsWith(prefix) || fromRoot.length <= prefix.length) continue;
    entries.push({ path: fromRoot.slice(prefix.length), kind, folder });
  }
  return entries;
};

/** The Project's Changed files: one `status` scoped to its folder, in the default untracked mode (never `-uall`). */
const readChanges = Effect.fn('ProjectFiles.changes')(function* (cwd: string) {
  if (!(yield* isDirectory(cwd))) return yield* new FilesError({ reason: 'FolderNotFound', detail: `${cwd} is not a folder` });
  const prefix = (yield* runGit(cwd, ['rev-parse', '--show-prefix'])).trim();
  const output = yield* runGit(cwd, ['status', '--porcelain=v2', '-z', '--', '.']);
  return { entries: parseStatus(output, prefix) } satisfies ChangedFiles;
});

/**
 * The files the filter searches: what the index tracks, plus what is untracked and not ignored, read from `status` rather
 * than walking the whole tree for untracked files. Only a wholly untracked folder is walked, and only that folder.
 */
const listFiles = Effect.fnUntraced(function* (cwd: string) {
  const tracked = splitNul(yield* runGit(cwd, ['ls-files', '-z', '--cached', '--deduplicate']));
  const { entries } = yield* readChanges(cwd);
  const untracked = entries.filter((entry) => entry.kind === 'untracked');
  const folders = untracked.filter((entry) => entry.folder).map((entry) => `${entry.path}/`);
  const inFolders =
    folders.length === 0 ? [] : splitNul(yield* runGit(cwd, ['ls-files', '-z', '--others', '--exclude-standard', '--', ...folders]));
  return [...tracked, ...untracked.filter((entry) => !entry.folder).map((entry) => entry.path), ...inFolders];
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

/** `@@ -oldStart,oldLines +newStart,newLines @@`; a count left out is 1. */
const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

const MARKS: Readonly<Record<string, DiffLine['kind']>> = { ' ': 'context', '+': 'added', '-': 'removed' };

/**
 * Reads the output of `git diff` for one file into its hunks. A line's text loses its mark and a final `\r` (a Windows
 * line ending). "\ No newline at end of file" is not a line of the file and is skipped. Nothing to show is `unchanged`;
 * git's "Binary files ... differ" is `binary`.
 */
export const parseDiff = (output: string): FileDiff => {
  const hunks: Array<{ oldStart: number; oldLines: number; newStart: number; newLines: number; lines: DiffLine[] }> = [];
  for (const line of output.split('\n')) {
    const header = HUNK_HEADER.exec(line);
    if (header !== null) {
      const count = (value: string | undefined) => (value === undefined ? 1 : Number(value));
      hunks.push({ oldStart: Number(header[1]), oldLines: count(header[2]), newStart: Number(header[3]), newLines: count(header[4]), lines: [] });
      continue;
    }
    const hunk = hunks.at(-1);
    if (hunk === undefined) {
      if (line.startsWith('Binary files ') || line === 'GIT binary patch') return { kind: 'binary' };
      continue;
    }
    const kind = MARKS[line.slice(0, 1)];
    if (kind !== undefined) hunk.lines.push({ kind, text: line.slice(1).replace(/\r$/, '') });
  }
  return hunks.length === 0 ? { kind: 'unchanged' } : { kind: 'changes', hunks };
};

/** A file git does not track yet, as a diff: one hunk with every line added. */
const allAdded = (content: string): FileDiff => {
  if (content === '') return { kind: 'changes', hunks: [] };
  const lines = content.split('\n');
  if (lines.at(-1) === '') lines.pop();
  return {
    kind: 'changes',
    hunks: [{ oldStart: 0, oldLines: 0, newStart: 1, newLines: lines.length, lines: lines.map((text) => ({ kind: 'added', text: text.replace(/\r$/, '') })) }],
  };
};

/**
 * The file's change against HEAD. `status` tells first whether git knows the file at all: an untracked one is read from
 * disk as all lines added (`git diff HEAD` has nothing to say of it), an unchanged one needs no diff. Paths are literal, so
 * a name with `*` is not a pattern.
 */
const readDiff = Effect.fn('ProjectFiles.diff')(function* (cwd: string, file: string) {
  if (!(yield* isDirectory(cwd))) return yield* new FilesError({ reason: 'FolderNotFound', detail: `${cwd} is not a folder` });
  const target = yield* confine(cwd, file);
  const status = splitNul(yield* runGit(cwd, ['--literal-pathspecs', 'status', '--porcelain=v2', '-z', '--', file]));
  if (status.length === 0) return { kind: 'unchanged' } satisfies FileDiff;
  const size = yield* fileSize(target, file).pipe(Effect.catchTag('FilesError', () => Effect.succeed(0)));
  if (size > MAX_PREVIEW_BYTES) return { kind: 'tooLarge', size } satisfies FileDiff;
  if (status.some((record) => record.startsWith('? '))) {
    const content = yield* readFileContent(cwd, file);
    return content.kind === 'text' ? allAdded(content.content) : ({ kind: 'binary' } satisfies FileDiff);
  }
  return parseDiff(yield* runGit(cwd, ['--literal-pathspecs', 'diff', 'HEAD', '--no-color', '--no-ext-diff', '--no-textconv', '--', file]));
});

const locateFile = Effect.fn('ProjectFiles.locate')(function* (cwd: string, file: string) {
  const target = yield* confine(cwd, file);
  yield* fileSize(target, file);
  return target;
});

/** Applies the cap. */
export const toFileList = (all: ReadonlyArray<string>, limit: number): FileList => ({ paths: all.slice(0, limit), truncated: all.length > limit });

export const layerProjectFiles = (limit: number = MAX_LISTED_PATHS) =>
  Layer.succeed(ProjectFiles, {
    list: Effect.fn('ProjectFiles.list')(function* (cwd: string) {
      if (!(yield* isDirectory(cwd))) {
        return yield* new FilesError({ reason: 'FolderNotFound', detail: `${cwd} is not a folder` });
      }
      return toFileList(yield* listFiles(cwd), limit);
    }),
    listDir: readFolder,
    read: readFileContent,
    locate: locateFile,
    changes: readChanges,
    diff: readDiff,
  });
