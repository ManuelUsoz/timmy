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
import { layerProjectFiles } from '../files/project-files';
import { layerProjectStore } from '../projects/project-store';
import { layerFilesHandlers } from './files';

const roots: string[] = [];
const tempDir = () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'timmy-files-'));
  roots.push(dir);
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
        Layer.provide(layerFilesState.pipe(Layer.provide(layerProjectStore(':memory:')))),
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
      const error = yield* Effect.flip(api['Files.list']({ cwd: path.join(tempDir(), 'nope') }));
      expect(error.reason).toBe('FolderNotFound');
    }).pipe(Effect.provide(makeLayer())),
  );
});
