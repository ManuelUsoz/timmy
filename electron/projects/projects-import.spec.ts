import path from 'node:path';
import { describe, expect, it } from '@effect/vitest';
import { Effect, Layer } from 'effect';
import { SessionId } from '../../src/shared/chat/ids.model';
import { ProviderSessionId } from '../../src/shared/sessions/sessions.model';
import { layerProjectResolver, ProjectResolver } from '../sessions/project-resolver';
import { layerSessionRepo, SessionRepo } from '../sessions/session-repo';
import { layerFolderPickerTest } from './folder-picker';
import { layerProjectFoldersTest, type FakeFolders } from './project-folders';
import { layerProjectsService, ProjectsService } from './projects-service';

const at = (...parts: string[]) => path.resolve('/disk', ...parts);

/** The store a previous version of Timmy left behind, with a session in each of these folders. */
const layerStore = layerProjectResolver.pipe(Layer.provideMerge(layerSessionRepo(':memory:')));

const startSessionIn = (cwd: string) =>
  Effect.gen(function* () {
    const projectId = yield* (yield* ProjectResolver).resolveByCwd(cwd);
    yield* (yield* SessionRepo).createSession({
      sessionId: SessionId.make(`s-${cwd}`),
      projectId,
      cwd,
      provider: 'Claude',
      providerSessionId: ProviderSessionId.make(`native-${cwd}`),
    });
    return projectId;
  });

/** Starts the app: builds the projects service over the store as it is now, on a disk like `fake`. */
const startApp = (fake: FakeFolders) =>
  Effect.service(ProjectsService).pipe(
    Effect.provide(
      layerProjectsService.pipe(Layer.provide(layerProjectFoldersTest(fake)), Layer.provide(layerFolderPickerTest())),
    ),
  );

describe('importing the projects that already have sessions', () => {
  it.effect('lists the ones whose folder is still a git repository, and only those', () =>
    Effect.gen(function* () {
      yield* startSessionIn(at('repo'));
      yield* startSessionIn(at('plain'));
      yield* startSessionIn(at('gone'));
      const projects = yield* startApp({ folders: { [at('repo')]: 'main', [at('plain')]: null } });
      expect((yield* projects.list).map((p) => [p.name, p.cwd])).toEqual([['repo', at('repo')]]);
    }).pipe(Effect.provide(layerStore)),
  );

  it.effect('happens once: a folder that was not eligible at the time is not imported by a later start', () =>
    Effect.gen(function* () {
      yield* startSessionIn(at('late'));
      yield* startApp({ folders: { [at('late')]: null } });
      const projects = yield* startApp({ folders: { [at('late')]: 'main' } });
      expect(yield* projects.list).toEqual([]);
    }).pipe(Effect.provide(layerStore)),
  );

  it.effect('does not bring back a project the user removed', () =>
    Effect.gen(function* () {
      yield* startSessionIn(at('repo'));
      const first = yield* startApp({ folders: { [at('repo')]: 'main' } });
      const [imported] = yield* first.list;
      yield* first.remove(imported!.projectId);
      const restarted = yield* startApp({ folders: { [at('repo')]: 'main' } });
      expect(yield* restarted.list).toEqual([]);
    }).pipe(Effect.provide(layerStore)),
  );

  it.effect('gives an imported project the same id its sessions already have', () =>
    Effect.gen(function* () {
      const projectId = yield* startSessionIn(at('repo'));
      const projects = yield* startApp({ folders: { [at('repo')]: 'main' } });
      expect((yield* projects.list).map((p) => p.projectId)).toEqual([projectId]);
      expect((yield* (yield* SessionRepo).list(projectId)).map((s) => s.sessionId)).toHaveLength(1);
    }).pipe(Effect.provide(layerStore)),
  );
});
