import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from '@effect/vitest';
import { Effect, Layer } from 'effect';
import { DesktopApi } from '../../src/app/core/desktop-api';
import {
  layerProjectsUnused,
  layerSettingsUnused,
  layerWindowUnused,
  makeDesktopTestLayer,
} from '../../src/app/core/desktop-layers';
import { AppInfoRpcs } from '../../src/shared/app-info/app-info.rpc';
import { MAX_PREVIEW_BYTES } from '../../src/shared/files/files.model';
import { layerFilesState } from '../files/files-state';
import { fsFailure, layerProjectFiles } from '../files/project-files';
import { layerProjectStore, ProjectStore } from '../projects/project-store';
import { layerFilesHandlers } from './files';

const roots: string[] = [];
/** One database for the whole file: a folder is only readable once it is a Project, so each folder made here is added. */
const db = path.join(mkdtempSync(path.join(tmpdir(), 'timmy-files-db-')), 'timmy.db');
roots.push(path.dirname(db));
const register = (dir: string) => Effect.runSync(Effect.flatMap(ProjectStore, (store) => store.add(dir)).pipe(Effect.provide(layerProjectStore(db))));
const tempDir = () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'timmy-files-'));
  roots.push(dir);
  register(dir);
  return dir;
};
const write = (root: string, file: string, content = 'x') => {
  mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  writeFileSync(path.join(root, file), content);
};
const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, stdio: 'ignore' });

const makeLayer = (limit?: number) =>
  makeDesktopTestLayer(
    Layer.mergeAll(
      layerFilesHandlers.pipe(
        Layer.provide(layerProjectFiles(limit)),
        Layer.provide(layerFilesState),
        Layer.provide(layerProjectStore(db)),
      ),
      AppInfoRpcs.toLayer({ 'AppInfo.get': () => Effect.die('unused') }),
      layerWindowUnused,
      layerSettingsUnused,
      layerProjectsUnused,
    ),
  );

afterAll(() => roots.forEach((root) => rmSync(root, { recursive: true, force: true })));

describe('Files.listDir', () => {
  it.effect('lists one level, folders first, hiding .git and flagging what git ignores', () => {
    const root = tempDir();
    git(root, 'init');
    write(root, '.gitignore', '.env\nnode_modules/\n');
    write(root, 'src/deep/a.ts');
    write(root, 'node_modules/pkg/index.js');
    write(root, '.env', 'SECRET=1');
    write(root, 'README.md');
    return Effect.gen(function* () {
      const api = yield* DesktopApi;
      const listing = yield* api['Files.listDir']({ cwd: root, dir: '' });
      expect(listing.entries).toEqual([
        { name: 'node_modules', kind: 'folder', ignored: true },
        { name: 'src', kind: 'folder', ignored: false },
        { name: '.env', kind: 'file', ignored: true },
        { name: '.gitignore', kind: 'file', ignored: false },
        { name: 'README.md', kind: 'file', ignored: false },
      ]);
    }).pipe(Effect.provide(makeLayer()));
  });

  it.effect('lists a nested folder, and flags an ignored folder found inside it', () => {
    const root = tempDir();
    git(root, 'init');
    write(root, '.gitignore', 'build/\n');
    write(root, 'packages/app/src/main.ts');
    write(root, 'packages/app/build/out.js');
    return Effect.gen(function* () {
      const api = yield* DesktopApi;
      const listing = yield* api['Files.listDir']({ cwd: root, dir: 'packages/app' });
      expect(listing.entries).toEqual([
        { name: 'build', kind: 'folder', ignored: true },
        { name: 'src', kind: 'folder', ignored: false },
      ]);
      const inner = yield* api['Files.listDir']({ cwd: root, dir: 'packages/app/build' });
      expect(inner.entries).toEqual([{ name: 'out.js', kind: 'file', ignored: true }]);
    }).pipe(Effect.provide(makeLayer()));
  });

  it.effect('still lists a folder that is not a git repository, with nothing dimmed', () => {
    const root = tempDir();
    write(root, 'node_modules/pkg/index.js');
    write(root, 'a.txt');
    return Effect.gen(function* () {
      const api = yield* DesktopApi;
      const listing = yield* api['Files.listDir']({ cwd: root, dir: '' });
      expect(listing.entries).toEqual([
        { name: 'node_modules', kind: 'folder', ignored: false },
        { name: 'a.txt', kind: 'file', ignored: false },
      ]);
    }).pipe(Effect.provide(makeLayer()));
  });

  it.effect('fails with FolderNotFound for a folder that does not exist', () => {
    const root = tempDir();
    return Effect.gen(function* () {
      const api = yield* DesktopApi;
      const error = yield* Effect.flip(api['Files.listDir']({ cwd: root, dir: 'nope' }));
      expect(error.reason).toBe('FolderNotFound');
    }).pipe(Effect.provide(makeLayer()));
  });

  it.effect('lists a link to a folder as a file and refuses to enter it', () => {
    const root = tempDir();
    const outside = tempDir();
    write(outside, 'secret.txt');
    symlinkSync(outside, path.join(root, 'link'), 'junction');
    return Effect.gen(function* () {
      const api = yield* DesktopApi;
      const listing = yield* api['Files.listDir']({ cwd: root, dir: '' });
      expect(listing.entries).toEqual([{ name: 'link', kind: 'file', ignored: false }]);
      const error = yield* Effect.flip(api['Files.listDir']({ cwd: root, dir: 'link' }));
      expect(error.reason).toBe('OutsideProject');
    }).pipe(Effect.provide(makeLayer()));
  });

  it.effect('refuses a folder outside the Project, however it is written', () => {
    const root = tempDir();
    const sibling = tempDir();
    write(sibling, 'secret.txt');
    return Effect.gen(function* () {
      const api = yield* DesktopApi;
      for (const dir of ['..', `../${path.basename(sibling)}`, 'a/../..', sibling]) {
        const error = yield* Effect.flip(api['Files.listDir']({ cwd: root, dir }));
        expect(error.reason, dir).toBe('OutsideProject');
      }
    }).pipe(Effect.provide(makeLayer()));
  });
});

describe('Files.read', () => {
  it.effect('reads a text file as it is, including accents and Windows line endings', () => {
    const root = tempDir();
    write(root, 'src/a.ts', 'const ñ = "café";\r\nexport {};\r\n');
    return Effect.gen(function* () {
      const api = yield* DesktopApi;
      const file = yield* api['Files.read']({ cwd: root, file: 'src/a.ts' });
      expect(file).toEqual({ kind: 'text', content: 'const ñ = "café";\r\nexport {};\r\n' });
    }).pipe(Effect.provide(makeLayer()));
  });

  it.effect('reports a file with a NUL byte near its start as binary, without its content', () => {
    const root = tempDir();
    writeFileSync(path.join(root, 'logo.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x1a, 0x0a]));
    return Effect.gen(function* () {
      const api = yield* DesktopApi;
      expect(yield* api['Files.read']({ cwd: root, file: 'logo.png' })).toEqual({ kind: 'binary' });
    }).pipe(Effect.provide(makeLayer()));
  });

  it.effect('reports bytes that are not valid UTF-8 as binary rather than showing replacement characters', () => {
    const root = tempDir();
    writeFileSync(path.join(root, 'latin1.txt'), Buffer.from([0x63, 0x61, 0x66, 0xe9]));
    return Effect.gen(function* () {
      const api = yield* DesktopApi;
      expect(yield* api['Files.read']({ cwd: root, file: 'latin1.txt' })).toEqual({ kind: 'binary' });
    }).pipe(Effect.provide(makeLayer()));
  });

  it.effect('does not read a file over 1 MB: it reports the size only', () => {
    const root = tempDir();
    writeFileSync(path.join(root, 'big.log'), 'a'.repeat(MAX_PREVIEW_BYTES + 1));
    writeFileSync(path.join(root, 'exact.log'), 'a'.repeat(MAX_PREVIEW_BYTES));
    return Effect.gen(function* () {
      const api = yield* DesktopApi;
      expect(yield* api['Files.read']({ cwd: root, file: 'big.log' })).toEqual({ kind: 'tooLarge', size: MAX_PREVIEW_BYTES + 1 });
      expect(yield* api['Files.read']({ cwd: root, file: 'exact.log' })).toMatchObject({ kind: 'text' });
    }).pipe(Effect.provide(makeLayer()));
  });

  it.effect('fails with FileNotFound for a missing file and for a folder', () => {
    const root = tempDir();
    write(root, 'src/a.ts');
    return Effect.gen(function* () {
      const api = yield* DesktopApi;
      for (const file of ['nope.ts', 'src']) {
        const error = yield* Effect.flip(api['Files.read']({ cwd: root, file }));
        expect(error.reason, file).toBe('FileNotFound');
      }
    }).pipe(Effect.provide(makeLayer()));
  });

  it.effect('tells a missing file from an outside one when the Project is reached through a link', () => {
    const real = tempDir();
    write(real, 'src/a.ts', 'ok');
    const via = path.join(tempDir(), 'via');
    symlinkSync(real, via, 'junction');
    register(via);
    return Effect.gen(function* () {
      const api = yield* DesktopApi;
      expect(yield* api['Files.read']({ cwd: via, file: 'src/a.ts' })).toEqual({ kind: 'text', content: 'ok' });
      const missingFile = yield* Effect.flip(api['Files.read']({ cwd: via, file: 'src/nope.ts' }));
      expect(missingFile.reason).toBe('FileNotFound');
      const missingFolder = yield* Effect.flip(api['Files.listDir']({ cwd: via, dir: 'nope/deeper' }));
      expect(missingFolder.reason).toBe('FolderNotFound');
    }).pipe(Effect.provide(makeLayer()));
  });

  it.effect('refuses a file outside the Project, also through a link', () => {
    const root = tempDir();
    const outside = tempDir();
    write(outside, 'secret.txt', 'SECRET');
    symlinkSync(outside, path.join(root, 'link'), 'junction');
    return Effect.gen(function* () {
      const api = yield* DesktopApi;
      for (const file of ['../secret.txt', path.join(outside, 'secret.txt'), 'link/secret.txt']) {
        const error = yield* Effect.flip(api['Files.read']({ cwd: root, file }));
        expect(error.reason, file).toBe('OutsideProject');
      }
    }).pipe(Effect.provide(makeLayer()));
  });
});

describe('Files.list', () => {
  it.effect('lists tracked and untracked files, never the ignored ones', () => {
    const root = tempDir();
    git(root, 'init');
    write(root, '.gitignore', '.env\nnode_modules/\n');
    write(root, 'src/a.ts');
    write(root, 'mi carpeta/a b.ts');
    write(root, '.env', 'SECRET=1');
    write(root, 'node_modules/pkg/index.js');
    git(root, 'add', 'src/a.ts');
    return Effect.gen(function* () {
      const api = yield* DesktopApi;
      const list = yield* api['Files.list']({ cwd: root });
      expect([...list.paths].sort()).toEqual(['.gitignore', 'mi carpeta/a b.ts', 'src/a.ts']);
      expect(list.truncated).toBe(false);
    }).pipe(Effect.provide(makeLayer()));
  });

  it.effect('lists the files of a Project inside a larger repository relative to the Project, and nothing outside it', () => {
    const repo = tempDir();
    git(repo, 'init');
    write(repo, 'outside.ts');
    write(repo, 'app/tracked.ts');
    git(repo, 'add', '.');
    write(repo, 'app/loose.ts');
    write(repo, 'app/new/deep/file.ts');
    write(repo, 'elsewhere/x.ts');
    const project = path.join(repo, 'app');
    register(project);
    return Effect.gen(function* () {
      const api = yield* DesktopApi;
      const list = yield* api['Files.list']({ cwd: project });
      expect([...list.paths].sort()).toEqual(['loose.ts', 'new/deep/file.ts', 'tracked.ts']);
    }).pipe(Effect.provide(makeLayer()));
  });

  it.effect('cuts the list at the cap and says so', () => {
    const root = tempDir();
    git(root, 'init');
    for (const name of ['a', 'b', 'c']) write(root, `${name}.txt`);
    return Effect.gen(function* () {
      const api = yield* DesktopApi;
      const list = yield* api['Files.list']({ cwd: root });
      expect(list.paths).toHaveLength(2);
      expect(list.truncated).toBe(true);
    }).pipe(Effect.provide(makeLayer(2)));
  });

  it.effect('fails with NotAGitRepository outside a repository', () => {
    const root = tempDir();
    return Effect.gen(function* () {
      const api = yield* DesktopApi;
      const error = yield* Effect.flip(api['Files.list']({ cwd: root }));
      expect(error.reason).toBe('NotAGitRepository');
    }).pipe(Effect.provide(makeLayer()));
  });

  it.effect('fails with FolderNotFound for a missing folder', () =>
    Effect.gen(function* () {
      const api = yield* DesktopApi;
      const gone = path.join(tempDir(), 'nope');
      register(gone);
      const error = yield* Effect.flip(api['Files.list']({ cwd: gone }));
      expect(error.reason).toBe('FolderNotFound');
    }).pipe(Effect.provide(makeLayer())),
  );
});

describe('Files.changes', () => {
  /** A repository with one commit holding `files`, as an agent would find it. */
  const committed = (files: Record<string, string>) => {
    const root = tempDir();
    git(root, 'init');
    git(root, 'config', 'user.email', 'timmy@example.com');
    git(root, 'config', 'user.name', 'timmy');
    git(root, 'config', 'core.autocrlf', 'false');
    for (const [file, content] of Object.entries(files)) write(root, file, content);
    git(root, 'add', '.');
    git(root, 'commit', '-m', 'start');
    return root;
  };
  const changes = (cwd: string) => Effect.flatMap(DesktopApi, (api) => api['Files.changes']({ cwd }));
  const sorted = (entries: ReadonlyArray<{ readonly path: string }>) => [...entries].sort((a, b) => (a.path < b.path ? -1 : 1));

  it.effect('marks modified, added, untracked and deleted files, staged or not', () => {
    const root = committed({ 'src/a.ts': 'a', 'src/b.ts': 'b', 'gone.ts': 'g', 'staged-gone.ts': 's' });
    write(root, 'src/a.ts', 'changed');
    write(root, 'src/b.ts', 'changed');
    git(root, 'add', 'src/b.ts');
    write(root, 'src/new.ts', 'new');
    git(root, 'add', 'src/new.ts');
    write(root, 'notes.md', 'untracked');
    rmSync(path.join(root, 'gone.ts'));
    git(root, 'rm', '-q', 'staged-gone.ts');
    return Effect.gen(function* () {
      expect(sorted((yield* changes(root)).entries)).toEqual([
        { path: 'gone.ts', kind: 'deleted', folder: false },
        { path: 'notes.md', kind: 'untracked', folder: false },
        { path: 'src/a.ts', kind: 'modified', folder: false },
        { path: 'src/b.ts', kind: 'modified', folder: false },
        { path: 'src/new.ts', kind: 'added', folder: false },
        { path: 'staged-gone.ts', kind: 'deleted', folder: false },
      ]);
    }).pipe(Effect.provide(makeLayer()));
  });

  it.effect('shows a staged rename as one renamed file at its new path, and a plain move as deleted plus untracked', () => {
    const root = committed({ 'old name.ts': 'same content here', 'moved.ts': 'other content here' });
    git(root, 'mv', 'old name.ts', 'new name.ts');
    write(root, 'elsewhere/moved.ts', 'other content here');
    rmSync(path.join(root, 'moved.ts'));
    return Effect.gen(function* () {
      expect(sorted((yield* changes(root)).entries)).toEqual([
        { path: 'elsewhere', kind: 'untracked', folder: true },
        { path: 'moved.ts', kind: 'deleted', folder: false },
        { path: 'new name.ts', kind: 'renamed', folder: false },
      ]);
    }).pipe(Effect.provide(makeLayer()));
  });

  it.effect('counts a wholly untracked folder as one entry, however many files it holds, and skips what git ignores', () => {
    const root = committed({ '.gitignore': 'node_modules/\n', 'src/a.ts': 'a' });
    for (const name of ['a', 'b', 'c']) write(root, `generated/deep/${name}.ts`);
    write(root, 'node_modules/pkg/index.js');
    write(root, 'src/fresh.ts');
    return Effect.gen(function* () {
      expect(sorted((yield* changes(root)).entries)).toEqual([
        { path: 'generated', kind: 'untracked', folder: true },
        { path: 'src/fresh.ts', kind: 'untracked', folder: false },
      ]);
    }).pipe(Effect.provide(makeLayer()));
  });

  it.effect('shows a submodule with changes as one modified folder, never its files', () => {
    const library = committed({ 'lib.ts': 'lib' });
    const root = committed({ 'a.ts': 'a' });
    execFileSync('git', ['-c', 'protocol.file.allow=always', 'submodule', 'add', '-q', library, 'vendor/lib'], { cwd: root, stdio: 'ignore' });
    git(root, 'commit', '-qm', 'submodule');
    write(root, 'vendor/lib/lib.ts', 'changed inside');
    write(root, 'vendor/lib/extra.ts', 'new inside');
    return Effect.gen(function* () {
      expect((yield* changes(root)).entries).toEqual([{ path: 'vendor/lib', kind: 'modified', folder: true }]);
    }).pipe(Effect.provide(makeLayer()));
  });

  it.effect('reads only the Project folder, with paths relative to it, when the Project is inside a larger repository', () => {
    const repo = committed({ 'outside.ts': 'o', 'app/inside.ts': 'i' });
    write(repo, 'outside.ts', 'changed');
    write(repo, 'app/inside.ts', 'changed');
    write(repo, 'app/new/file.ts');
    const project = path.join(repo, 'app');
    register(project);
    return Effect.gen(function* () {
      expect(sorted((yield* changes(project)).entries)).toEqual([
        { path: 'inside.ts', kind: 'modified', folder: false },
        { path: 'new', kind: 'untracked', folder: true },
      ]);
    }).pipe(Effect.provide(makeLayer()));
  });

  it.effect('has nothing to report for a clean repository', () => {
    const root = committed({ 'a.ts': 'a' });
    return Effect.gen(function* () {
      expect((yield* changes(root)).entries).toEqual([]);
    }).pipe(Effect.provide(makeLayer()));
  });

  it.effect('fails with NotAGitRepository for a folder that is not a repository', () => {
    const root = tempDir();
    write(root, 'a.ts');
    return Effect.gen(function* () {
      const error = yield* Effect.flip(changes(root));
      expect(error.reason).toBe('NotAGitRepository');
    }).pipe(Effect.provide(makeLayer()));
  });

  it.effect('fails with GitFailed when git cannot read the repository', () => {
    const root = committed({ 'a.ts': 'a' });
    writeFileSync(path.join(root, '.git', 'index'), 'not an index');
    return Effect.gen(function* () {
      const error = yield* Effect.flip(changes(root));
      expect(error.reason).toBe('GitFailed');
    }).pipe(Effect.provide(makeLayer()));
  });
});

describe('Files access', () => {
  it.effect('refuses a folder that is not a Project, whatever the call: the renderer does not choose what main reads', () => {
    const stranger = mkdtempSync(path.join(tmpdir(), 'timmy-files-stranger-'));
    roots.push(stranger);
    write(stranger, 'secret.txt', 'SECRET');
    return Effect.gen(function* () {
      const api = yield* DesktopApi;
      const errors = [
        yield* Effect.flip(api['Files.list']({ cwd: stranger })),
        yield* Effect.flip(api['Files.listDir']({ cwd: stranger, dir: '' })),
        yield* Effect.flip(api['Files.read']({ cwd: stranger, file: 'secret.txt' })),
        yield* Effect.flip(api['Files.read']({ cwd: path.parse(stranger).root, file: path.relative(path.parse(stranger).root, path.join(stranger, 'secret.txt')) })),
        yield* Effect.flip(api['Files.changes']({ cwd: stranger })),
      ];
      expect(errors.map((error) => error.reason)).toEqual(['UnknownProject', 'UnknownProject', 'UnknownProject', 'UnknownProject', 'UnknownProject']);
    }).pipe(Effect.provide(makeLayer()));
  });
});

describe('fsFailure', () => {
  const failure = (code: string) => Object.assign(new Error(code), { code });

  it('tells a missing file or folder from one that cannot be read', () => {
    expect(fsFailure(failure('ENOENT'), 'file', 'a.ts').reason).toBe('FileNotFound');
    expect(fsFailure(failure('ENOTDIR'), 'folder', 'src').reason).toBe('FolderNotFound');
    expect(fsFailure(failure('EACCES'), 'file', 'a.ts').reason).toBe('Unreadable');
    expect(fsFailure(failure('EPERM'), 'folder', 'src').reason).toBe('Unreadable');
    expect(fsFailure('not an error object', 'file', 'a.ts').reason).toBe('Unreadable');
  });
});
