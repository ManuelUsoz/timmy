import { Effect } from 'effect';
import { FilesError } from '../../../shared/files/files-error.model';
import { FilesRpcs } from '../../../shared/files/files.rpc';
import {
  DEFAULT_BROWSER_WIDTH,
  type ChangedFile,
  type FileContent,
  type FileDiff,
  type FolderEntry,
  type ImageContent,
  type PathLinkTarget,
  type ProjectBrowserState,
} from '../../../shared/files/files.model';

/** One Project's folder on the fake disk. */
export interface FakeDisk {
  /** The children of each folder, '' being the root. A folder missing here does not exist. */
  dirs: Record<string, ReadonlyArray<FolderEntry>>;
  /** What reading each file gives. A file missing here does not exist. */
  files: Record<string, FileContent>;
  /** What reading each file as an image gives; a file of `files` missing here is not an image (size 0). */
  images?: Record<string, ImageContent>;
  /** The modified time `Files.versions` answers per file (0 when absent); `rewrite` bumps it with the content. */
  mtimes?: Record<string, number>;
  /** Files that exist and cannot be read (no permission). */
  unreadable?: ReadonlyArray<string>;
  /** What `Files.list` answers (non-ignored paths); null for a folder without git. */
  index: ReadonlyArray<string> | null;
  /** What `Files.changes` answers; none when absent. A folder without git (`index` null) fails instead. */
  changes?: ReadonlyArray<ChangedFile>;
  /** What `Files.diff` answers per file; `unchanged` when absent. A folder without a repository (`index` null) fails instead. */
  diffs?: Record<string, FileDiff>;
  /** What `Files.resolvePathLink` answers, by the candidate as printed (with its position); anything else is not a Path link. */
  links?: Record<string, PathLinkTarget>;
}

/** The Files RPCs as main answers them, in memory. Tests read `calls` and `saved`, and change `disks` while the UI runs. */
export interface FakeFiles {
  /** By the Project's folder (its `cwd`). */
  disks: Record<string, FakeDisk>;
  /** What the browser saved, by Project id. */
  saved: Record<string, ProjectBrowserState>;
  width: number;
  /** Folders whose listing breaks (a defect, as a failing disk would), by folder path. */
  broken: Set<string>;
  /** Calls the UI made, as `Name` or `Name:argument`, in order. */
  calls: string[];
  /** Makes `Files.changes` fail, as a broken `git status` would. */
  changesFail: boolean;
  /** Holds every `Files.changes` answer until it is resolved, to see what shows while a run is in flight. */
  changesGate: Promise<void> | undefined;
  /** Holds every `Files.resolvePathLink` answer until it is resolved, to see how many are asked at once. */
  linksGate?: Promise<void>;
}

export const folder = (name: string, ignored = false): FolderEntry => ({ name, kind: 'folder', ignored });
export const file = (name: string, ignored = false): FolderEntry => ({ name, kind: 'file', ignored });
export const text = (content: string): FileContent => ({ kind: 'text', content });
/** A Changed file as main reports it; `folder` for a wholly untracked folder or a submodule. */
export const change = (path: string, kind: ChangedFile['kind'], folder = false): ChangedFile => ({ path, kind, folder });
/** A diff of one hunk from `lines` written as git does: ` kept`, `+added`, `-removed`, starting at line 1 on both sides. */
export const hunkOf = (...lines: ReadonlyArray<string>): FileDiff => {
  const parsed = lines.map((line) => ({ kind: line[0] === '+' ? ('added' as const) : line[0] === '-' ? ('removed' as const) : ('context' as const), text: line.slice(1) }));
  const oldLines = parsed.filter((line) => line.kind !== 'added').length;
  const newLines = parsed.filter((line) => line.kind !== 'removed').length;
  return { kind: 'changes', hunks: [{ oldStart: oldLines === 0 ? 0 : 1, oldLines, newStart: newLines === 0 ? 0 : 1, newLines, lines: parsed }] };
};

/**
 * Changes a file of the fake disk as an agent would: its content and its version move together (`path` is created or
 * recreated if it was not there). Deleting is `delete disk.files[path]`.
 */
export const rewrite = (fake: FakeFiles, cwd: string, path: string, content: string): void => {
  const disk = fake.disks[cwd]!;
  disk.files[path] = text(content);
  disk.mtimes = { ...disk.mtimes, [path]: (disk.mtimes?.[path] ?? 0) + 1 };
};

/** The size `Files.versions` answers for a file of the fake disk. */
const sizeOf = (content: FileContent): number => (content.kind === 'text' ? content.content.length : content.kind === 'tooLarge' ? content.size : 0);

export const makeFakeFiles = (initial: Partial<FakeFiles> = {}): FakeFiles => ({
  disks: {},
  saved: {},
  width: DEFAULT_BROWSER_WIDTH,
  calls: [],
  changesFail: false,
  changesGate: undefined,
  ...initial,
  broken: new Set(initial.broken),
});

/** Handlers for the Files RPCs over `fake`. */
export const layerFakeFiles = (fake: FakeFiles) =>
  FilesRpcs.toLayer({
    'Files.list': ({ cwd }) =>
      Effect.gen(function* () {
        fake.calls.push('Files.list');
        const index = fake.disks[cwd]?.index;
        if (index === undefined) return yield* new FilesError({ reason: 'FolderNotFound', detail: cwd });
        if (index === null) return yield* new FilesError({ reason: 'NotAGitRepository', detail: 'not a git repository' });
        return { paths: [...index], truncated: false };
      }),
    'Files.listDir': ({ cwd, dir }) =>
      Effect.gen(function* () {
        fake.calls.push(`Files.listDir:${dir}`);
        if (fake.broken.has(dir)) return yield* Effect.die('the disk is unreadable');
        const entries = fake.disks[cwd]?.dirs[dir];
        if (entries === undefined) return yield* new FilesError({ reason: 'FolderNotFound', detail: dir });
        return { entries: [...entries] };
      }),
    'Files.read': ({ cwd, file: path }) =>
      Effect.gen(function* () {
        fake.calls.push(`Files.read:${path}`);
        if (fake.disks[cwd]?.unreadable?.includes(path) === true) return yield* new FilesError({ reason: 'Unreadable', detail: path });
        const content = fake.disks[cwd]?.files[path];
        if (content === undefined) return yield* new FilesError({ reason: 'FileNotFound', detail: path });
        return content;
      }),
    'Files.openExternal': ({ cwd, file: path }) =>
      Effect.gen(function* () {
        fake.calls.push(`Files.openExternal:${path}`);
        if (fake.disks[cwd]?.files[path] === undefined) return yield* new FilesError({ reason: 'FileNotFound', detail: path });
      }),
    'Files.changes': ({ cwd }) =>
      Effect.gen(function* () {
        fake.calls.push('Files.changes');
        const gate = fake.changesGate;
        if (gate !== undefined) yield* Effect.promise(() => gate);
        const disk = fake.disks[cwd];
        if (disk === undefined) return yield* new FilesError({ reason: 'FolderNotFound', detail: cwd });
        if (disk.index === null) return yield* new FilesError({ reason: 'NotAGitRepository', detail: 'not a git repository' });
        if (fake.changesFail) return yield* new FilesError({ reason: 'GitFailed', detail: 'index file corrupt' });
        return { entries: [...(disk.changes ?? [])] };
      }),
    'Files.diff': ({ cwd, file: path }) =>
      Effect.gen(function* () {
        fake.calls.push(`Files.diff:${path}`);
        const disk = fake.disks[cwd];
        if (disk === undefined) return yield* new FilesError({ reason: 'FolderNotFound', detail: cwd });
        if (disk.index === null) return yield* new FilesError({ reason: 'NotAGitRepository', detail: 'not a git repository' });
        return disk.diffs?.[path] ?? ({ kind: 'unchanged' } as const);
      }),
    'Files.resolvePathLink': ({ cwd, candidate, folder }) =>
      Effect.gen(function* () {
        fake.calls.push(`Files.resolvePathLink:${candidate}${folder === null ? '' : `@${folder}`}`);
        const gate = fake.linksGate;
        if (gate !== undefined) yield* Effect.promise(() => gate);
        const disk = fake.disks[cwd];
        if (disk === undefined) return yield* new FilesError({ reason: 'UnknownProject', detail: cwd });
        return disk.links?.[candidate] ?? null;
      }),
    'Files.readImage': ({ cwd, file: path }) =>
      Effect.gen(function* () {
        fake.calls.push(`Files.readImage:${path}`);
        const disk = fake.disks[cwd];
        if (disk?.unreadable?.includes(path) === true) return yield* new FilesError({ reason: 'Unreadable', detail: path });
        if (disk?.files[path] === undefined) return yield* new FilesError({ reason: 'FileNotFound', detail: path });
        return disk.images?.[path] ?? { kind: 'notAnImage' as const, size: 0 };
      }),
    'Files.versions': ({ cwd, files }) =>
      Effect.sync(() => {
        fake.calls.push(`Files.versions:${files.join(',')}`);
        const disk = fake.disks[cwd];
        return files.map((path) => {
          const content = disk?.files[path];
          return { file: path, version: content === undefined ? null : { modified: disk?.mtimes?.[path] ?? 0, size: sizeOf(content) } };
        });
      }),
    'Files.getState': ({ projectId }) =>
      Effect.sync(() => {
        fake.calls.push('Files.getState');
        return { width: fake.width, ...(fake.saved[projectId] ?? { expanded: [], lastFile: null }) };
      }),
    'Files.saveState': ({ projectId, ...state }) =>
      Effect.sync(() => {
        fake.calls.push('Files.saveState');
        fake.saved[projectId] = state;
      }),
    'Files.saveWidth': ({ width }) =>
      Effect.sync(() => {
        fake.calls.push(`Files.saveWidth:${width}`);
        fake.width = width;
      }),
  });
