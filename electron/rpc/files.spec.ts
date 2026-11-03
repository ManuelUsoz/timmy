import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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
import { layerProjectFiles } from '../files/project-files';
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
      layerFilesHandlers.pipe(Layer.provide(layerProjectFiles(limit))),
      AppInfoRpcs.toLayer({ 'AppInfo.get': () => Effect.die('unused') }),
      layerWindowUnused,
      layerSettingsUnused,
      layerProjectsUnused,
    ),
  );

afterAll(() => roots.forEach((root) => rmSync(root, { recursive: true, force: true })));

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
