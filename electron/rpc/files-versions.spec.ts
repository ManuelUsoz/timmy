import { mkdirSync, mkdtempSync, rmSync, unlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from '@effect/vitest';
import { Effect, Layer } from 'effect';
import { DesktopApi } from '../../src/app/core/desktop-api';
import { layerProjectsUnused, layerSettingsUnused, layerWindowUnused, makeDesktopTestLayer } from '../../src/app/core/desktop-layers';
import { AppInfoRpcs } from '../../src/shared/app-info/app-info.rpc';
import { MAX_PREVIEW_BYTES } from '../../src/shared/files/files.model';
import { layerFilesState } from '../files/files-state';
import { layerFileOpenerTest } from '../files/file-opener';
import { layerProjectFiles } from '../files/project-files';
import { layerProjectStore, ProjectStore } from '../projects/project-store';
import { layerFilesHandlers } from './files';

const roots: string[] = [];
const db = path.join(mkdtempSync(path.join(tmpdir(), 'timmy-versions-db-')), 'timmy.db');
roots.push(path.dirname(db));
const tempProject = () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'timmy-versions-'));
  roots.push(dir);
  Effect.runSync(Effect.flatMap(ProjectStore, (store) => store.add(dir)).pipe(Effect.provide(layerProjectStore(db))));
  return dir;
};
/** Writes `file` and sets its modified time to `seconds` since the epoch, so a spec never waits for the clock to move. */
const write = (root: string, file: string, content: string, seconds = 1_000) => {
  mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  writeFileSync(path.join(root, file), content);
  utimesSync(path.join(root, file), seconds, seconds);
};

const layer = makeDesktopTestLayer(
  Layer.mergeAll(
    layerFilesHandlers.pipe(
      Layer.provide(layerProjectFiles()),
      Layer.provide(layerFileOpenerTest()),
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

const versions = (cwd: string, files: ReadonlyArray<string>) => Effect.flatMap(DesktopApi, (api) => api['Files.versions']({ cwd, files }));

describe('Files.versions', () => {
  it.effect('answers the modified time and size of each file asked, one answer per file', () => {
    const root = tempProject();
    write(root, 'src/a.ts', 'hello', 1_000);
    write(root, 'b.md', 'longer text', 2_000);
    return Effect.gen(function* () {
      expect(yield* versions(root, ['src/a.ts', 'b.md'])).toEqual([
        { file: 'src/a.ts', version: { modified: 1_000_000, size: 5 } },
        { file: 'b.md', version: { modified: 2_000_000, size: 11 } },
      ]);
    }).pipe(Effect.provide(layer));
  });

  it.effect('tells a changed file from an unchanged one by its modified time and by its size', () => {
    const root = tempProject();
    write(root, 'same.ts', 'abc', 1_000);
    write(root, 'touched.ts', 'abc', 1_000);
    write(root, 'grown.ts', 'abc', 1_000);
    return Effect.gen(function* () {
      const before = yield* versions(root, ['same.ts', 'touched.ts', 'grown.ts']);
      write(root, 'touched.ts', 'xyz', 1_001);
      write(root, 'grown.ts', 'abcd', 1_000);
      const after = yield* versions(root, ['same.ts', 'touched.ts', 'grown.ts']);
      expect(after[0]).toEqual(before[0]);
      expect(after[1]!.version).not.toEqual(before[1]!.version);
      expect(after[2]!.version).not.toEqual(before[2]!.version);
    }).pipe(Effect.provide(layer));
  });

  it.effect('answers a deleted file, and a folder, as gone, and the file again when its path comes back', () => {
    const root = tempProject();
    write(root, 'a.ts', 'abc', 1_000);
    write(root, 'dir/inner.ts', 'x');
    return Effect.gen(function* () {
      expect(yield* versions(root, ['a.ts', 'dir', 'never.ts'])).toEqual([
        { file: 'a.ts', version: { modified: 1_000_000, size: 3 } },
        { file: 'dir', version: null },
        { file: 'never.ts', version: null },
      ]);
      unlinkSync(path.join(root, 'a.ts'));
      expect(yield* versions(root, ['a.ts'])).toEqual([{ file: 'a.ts', version: null }]);
      write(root, 'a.ts', 'abc', 1_000);
      expect(yield* versions(root, ['a.ts'])).toEqual([{ file: 'a.ts', version: { modified: 1_000_000, size: 3 } }]);
    }).pipe(Effect.provide(layer));
  });

  it.effect('reads no content: a file over the preview limit has a version like any other', () => {
    const root = tempProject();
    write(root, 'big.txt', 'x'.repeat(MAX_PREVIEW_BYTES + 1));
    return Effect.gen(function* () {
      expect((yield* versions(root, ['big.txt']))[0]!.version?.size).toBe(MAX_PREVIEW_BYTES + 1);
    }).pipe(Effect.provide(layer));
  });

  it.effect('leaves a path outside the Project unanswered, without failing the rest, and refuses a folder that is not a Project', () => {
    const root = tempProject();
    write(root, 'a.ts', 'abc');
    const stranger = mkdtempSync(path.join(tmpdir(), 'timmy-versions-stranger-'));
    roots.push(stranger);
    return Effect.gen(function* () {
      expect((yield* versions(root, ['../x', 'a.ts'])).map((answer) => answer.file)).toEqual(['a.ts']);
      expect((yield* Effect.flip(versions(stranger, ['a.ts']))).reason).toBe('UnknownProject');
    }).pipe(Effect.provide(layer));
  });
});
