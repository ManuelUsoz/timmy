import path from 'node:path';
import { describe, expect, it } from '@effect/vitest';
import { Effect, Layer, Option } from 'effect';
import { DesktopApi } from '../../src/app/core/desktop-api';
import {
  layerChatUnused,
  layerSessionsUnused,
  layerSettingsUnused,
  layerWindowUnused,
  makeDesktopTestLayer,
} from '../../src/app/core/desktop-layers';
import { AppInfoRpcs } from '../../src/shared/app-info/app-info.rpc';
import { layerFolderPickerTest } from '../projects/folder-picker';
import { layerProjectFoldersTest } from '../projects/project-folders';
import { layerProjectsService } from '../projects/projects-service';
import { layerProjectResolver } from '../sessions/project-resolver';
import { layerSessionRepo } from '../sessions/session-repo';
import { layerProjectsHandlers } from './projects';

const at = (...parts: string[]) => path.resolve('/disk', ...parts);

/** The Projects RPCs end to end: the real client, the real handlers and services, an in-memory store and disk. */
const makeLayer = (picked: Option.Option<string> = Option.none()) =>
  makeDesktopTestLayer(
    Layer.mergeAll(
      layerProjectsHandlers.pipe(
        Layer.provide(layerProjectsService),
        Layer.provide(layerProjectResolver),
        Layer.provide(layerProjectFoldersTest({ folders: { [at('app')]: 'main', [at('plain')]: null } })),
        Layer.provide(layerFolderPickerTest(picked)),
        Layer.provide(layerSessionRepo(':memory:')),
      ),
      AppInfoRpcs.toLayer({ 'AppInfo.get': () => Effect.die('unused') }),
      layerChatUnused,
      layerSessionsUnused,
      layerWindowUnused,
      layerSettingsUnused,
    ),
  );

describe('Projects RPCs', () => {
  it.effect('start with an empty list and add a project from a git folder', () =>
    Effect.gen(function* () {
      const api = yield* DesktopApi;
      expect(yield* api['Projects.list']()).toEqual([]);
      const added = yield* api['Projects.add']({ path: at('app') });
      expect(added).toMatchObject({ name: 'app', cwd: at('app') });
      expect(yield* api['Projects.list']()).toEqual([added]);
    }).pipe(Effect.provide(makeLayer())),
  );

  it.effect('reject a duplicate folder with a typed error the client can match', () =>
    Effect.gen(function* () {
      const api = yield* DesktopApi;
      yield* api['Projects.add']({ path: at('app'), name: 'timmy' });
      const error = yield* api['Projects.add']({ path: at('app') }).pipe(Effect.flip);
      expect(error).toMatchObject({ _tag: 'ProjectsError', reason: 'AlreadyAdded' });
      const inspected = yield* api['Projects.inspectFolder']({ path: at('app') });
      expect(inspected.existingName).toBe('timmy');
    }).pipe(Effect.provide(makeLayer())),
  );

  it.effect('inspect a folder, init git in a plain one, and then add it', () =>
    Effect.gen(function* () {
      const api = yield* DesktopApi;
      expect((yield* api['Projects.inspectFolder']({ path: at('plain') })).branch).toBeNull();
      expect((yield* api['Projects.add']({ path: at('plain') }).pipe(Effect.flip)).reason).toBe('NotAGitRepository');
      expect((yield* api['Projects.initGit']({ path: at('plain') })).branch).toBe('master');
      expect((yield* api['Projects.add']({ path: at('plain') })).cwd).toBe(at('plain'));
    }).pipe(Effect.provide(makeLayer())),
  );

  it.effect('remove a project, check its folder and remember it as used', () =>
    Effect.gen(function* () {
      const api = yield* DesktopApi;
      const { projectId } = yield* api['Projects.add']({ path: at('app') });
      expect(yield* api['Projects.checkFolder']({ projectId })).toBe('Present');
      yield* api['Projects.markUsed']({ projectId });
      expect((yield* api['Projects.list']())[0]?.lastUsedAt).not.toBeNull();
      yield* api['Projects.remove']({ projectId });
      expect(yield* api['Projects.list']()).toEqual([]);
      expect((yield* api['Projects.checkFolder']({ projectId }).pipe(Effect.flip)).reason).toBe('ProjectNotFound');
    }).pipe(Effect.provide(makeLayer())),
  );

  it.effect('pick a folder, or null when the user cancels', () =>
    Effect.gen(function* () {
      expect(yield* (yield* DesktopApi)['Projects.pickFolder']()).toBe(at('app'));
    }).pipe(Effect.provide(makeLayer(Option.some(at('app'))))),
  );

  it.effect('answer null when the folder dialog is cancelled', () =>
    Effect.gen(function* () {
      expect(yield* (yield* DesktopApi)['Projects.pickFolder']()).toBeNull();
    }).pipe(Effect.provide(makeLayer())),
  );
});
