import { Effect } from 'effect';
import { FilesError } from '../../../shared/files/files-error.model';
import { FilesRpcs } from '../../../shared/files/files.rpc';
import {
  DEFAULT_BROWSER_WIDTH,
  type FileContent,
  type FolderEntry,
  type ProjectBrowserState,
} from '../../../shared/files/files.model';

/** One Project's folder on the fake disk. */
export interface FakeDisk {
  /** The children of each folder, '' being the root. A folder missing here does not exist. */
  dirs: Record<string, ReadonlyArray<FolderEntry>>;
  /** What reading each file gives. A file missing here does not exist. */
  files: Record<string, FileContent>;
  /** What `Files.list` answers (non-ignored paths); null for a folder without git. */
  index: ReadonlyArray<string> | null;
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
}

export const folder = (name: string, ignored = false): FolderEntry => ({ name, kind: 'folder', ignored });
export const file = (name: string, ignored = false): FolderEntry => ({ name, kind: 'file', ignored });
export const text = (content: string): FileContent => ({ kind: 'text', content });

export const makeFakeFiles = (initial: Partial<FakeFiles> = {}): FakeFiles => ({
  disks: {},
  saved: {},
  width: DEFAULT_BROWSER_WIDTH,
  calls: [],
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
        const content = fake.disks[cwd]?.files[path];
        if (content === undefined) return yield* new FilesError({ reason: 'FileNotFound', detail: path });
        return content;
      }),
    'Files.getState': ({ projectId }) =>
      Effect.sync(() => {
        fake.calls.push('Files.getState');
        return { width: fake.width, ...(fake.saved[projectId] ?? { expanded: [], lastFile: null, view: 'tree' as const }) };
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
