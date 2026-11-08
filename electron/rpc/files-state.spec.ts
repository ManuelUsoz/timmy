import { mkdtempSync, rmSync } from 'node:fs';
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
import { DEFAULT_BROWSER_WIDTH } from '../../src/shared/files/files.model';
import { ProjectId } from '../../src/shared/projects/projects.model';
import { layerFilesState } from '../files/files-state';
import { layerProjectFiles } from '../files/project-files';
import { layerProjectStore, ProjectStore } from '../projects/project-store';
import { layerFilesHandlers } from './files';

const roots: string[] = [];
const dbFile = () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'timmy-files-state-'));
  roots.push(dir);
  return path.join(dir, 'timmy.db');
};
afterAll(() => roots.forEach((root) => rmSync(root, { recursive: true, force: true })));

/** The handlers over the database `file`; providing it again later is the app restarting. */
const appOn = (file: string) =>
  makeDesktopTestLayer(
    Layer.mergeAll(
      layerFilesHandlers.pipe(Layer.provide(layerProjectFiles()), Layer.provide(layerFilesState)),
      AppInfoRpcs.toLayer({ 'AppInfo.get': () => Effect.die('unused') }),
      layerWindowUnused,
      layerSettingsUnused,
      layerProjectsUnused,
    ).pipe(Layer.provideMerge(layerProjectStore(file))),
  );

const alpha = ProjectId.make('alpha');
const beta = ProjectId.make('beta');

describe('Files browser state', () => {
  it.effect('starts a Project closed on the tree, with nothing expanded and the default width', () =>
    Effect.gen(function* () {
      const api = yield* DesktopApi;
      expect(yield* api['Files.getState']({ projectId: alpha })).toEqual({
        width: DEFAULT_BROWSER_WIDTH,
        expanded: [],
        lastFile: null,
        view: 'tree',
      });
    }).pipe(Effect.provide(appOn(dbFile()))),
  );

  it.effect('remembers each Project on its own, and the width for all of them, across a restart', () => {
    const file = dbFile();
    const first = Effect.gen(function* () {
      const api = yield* DesktopApi;
      yield* api['Files.saveState']({ projectId: alpha, expanded: ['src', 'src/app'], lastFile: 'src/app/a.ts', view: 'file' });
      yield* api['Files.saveState']({ projectId: beta, expanded: ['docs'], lastFile: null, view: 'tree' });
      yield* api['Files.saveWidth']({ width: 520 });
    }).pipe(Effect.provide(appOn(file)));
    const afterRestart = Effect.gen(function* () {
      const api = yield* DesktopApi;
      expect(yield* api['Files.getState']({ projectId: alpha })).toEqual({
        width: 520,
        expanded: ['src', 'src/app'],
        lastFile: 'src/app/a.ts',
        view: 'file',
      });
      expect(yield* api['Files.getState']({ projectId: beta })).toEqual({
        width: 520,
        expanded: ['docs'],
        lastFile: null,
        view: 'tree',
      });
    }).pipe(Effect.provide(appOn(file)));
    return first.pipe(Effect.andThen(afterRestart));
  });

  it.effect('falls back to the defaults when what was stored cannot be read', () => {
    const file = dbFile();
    const corrupt = Effect.gen(function* () {
      const store = yield* ProjectStore;
      yield* store.putState('files.project.alpha', '{not json');
      yield* store.putState('files.width', '"wide"');
    }).pipe(Effect.provide(layerProjectStore(file)));
    const read = Effect.gen(function* () {
      const api = yield* DesktopApi;
      expect(yield* api['Files.getState']({ projectId: alpha })).toEqual({
        width: DEFAULT_BROWSER_WIDTH,
        expanded: [],
        lastFile: null,
        view: 'tree',
      });
    }).pipe(Effect.provide(appOn(file)));
    return corrupt.pipe(Effect.andThen(read));
  });
});
