import { Effect, Layer } from 'effect';
import { AppInfoRpcs } from '../../../shared/app-info/app-info.rpc';
import type { FolderInspection, Project } from '../../../shared/projects/projects.model';
import { ProjectsError } from '../../../shared/projects/projects-error.model';
import { ProjectsRpcs } from '../../../shared/projects/projects.rpc';
import { ProjectId } from '../../../shared/sessions/sessions.model';
import { SettingsRpcs } from '../../../shared/settings/settings.rpc';
import { layerFilesUnused, layerWindowUnused, makeDesktopTestLayer } from '../../core/desktop-layers';

export const project = (name: string, overrides: Partial<Project> = {}): Project => ({
  projectId: ProjectId.make(`p-${name}`),
  cwd: `/work/${name}`,
  name,
  createdAt: 0,
  lastUsedAt: null,
  ...overrides,
});

/** The main process as the Workspace sees it, in memory. Tests read and change `state` while the UI runs. */
export interface FakeBackend {
  projects: Project[];
  /** Projects whose folder is gone. */
  missing: Set<ProjectId>;
  /** Folders on the fake disk: a branch, or null for a folder without git. */
  folders: Record<string, string | null>;
  /** What the folder dialog answers next; empty means the user cancels. */
  picks: string[];
  gitMissing: boolean;
  /** Makes `Projects.list` break, as a failing disk would. */
  listFails: boolean;
  /** Makes `Projects.checkFolder` and `Projects.remove` break, and `git init` fail. */
  checkFails: boolean;
  removeFails: boolean;
  initFails: boolean;
  /** Calls the UI made, as `Name` or `Name:argument`. */
  calls: string[];
}

/** Each backend owns its own copy of what it is given, so one test cannot change another's disk. */
export const makeBackend = (initial: Partial<FakeBackend> = {}): FakeBackend => ({
  gitMissing: false,
  listFails: false,
  checkFails: false,
  removeFails: false,
  initFails: false,
  calls: [],
  ...initial,
  projects: [...(initial.projects ?? [])],
  missing: new Set(initial.missing),
  folders: { ...initial.folders },
  picks: [...(initial.picks ?? [])],
});

const inspect = (backend: FakeBackend, path: string): Effect.Effect<FolderInspection, ProjectsError> => {
  if (!(path in backend.folders)) {
    return Effect.fail(new ProjectsError({ reason: 'FolderNotFound', detail: `${path} is not a folder` }));
  }
  return Effect.succeed({
    path,
    branch: backend.folders[path] ?? null,
    existingName: backend.projects.find((candidate) => candidate.cwd === path)?.name ?? null,
  });
};

const notFound = (projectId: ProjectId) => new ProjectsError({ reason: 'ProjectNotFound', detail: projectId });

/** Handlers for the Projects RPCs over `backend`, and dying ones for window, files and app info. */
export const layerFakeProjects = (backend: FakeBackend) =>
  Layer.mergeAll(
    ProjectsRpcs.toLayer({
      'Projects.list': () => (backend.listFails ? Effect.die('the store is unreadable') : Effect.sync(() => [...backend.projects])),
      'Projects.add': ({ path, name }) =>
        Effect.gen(function* () {
          const found = yield* inspect(backend, path);
          if (found.existingName !== null) {
            return yield* new ProjectsError({ reason: 'AlreadyAdded', detail: path });
          }
          if (found.branch === null) {
            return yield* new ProjectsError({ reason: 'NotAGitRepository', detail: path });
          }
          const added = project(path.split('/').at(-1) ?? path, { cwd: path, ...(name === undefined ? {} : { name }) });
          backend.projects.push(added);
          backend.calls.push(`Projects.add:${path}`);
          return added;
        }),
      'Projects.remove': ({ projectId }) =>
        Effect.gen(function* () {
          if (backend.removeFails) return yield* Effect.die('the store is read-only');
          if (!backend.projects.some((candidate) => candidate.projectId === projectId)) return yield* notFound(projectId);
          backend.projects = backend.projects.filter((candidate) => candidate.projectId !== projectId);
          backend.calls.push(`Projects.remove:${projectId}`);
        }),
      'Projects.pickFolder': () => Effect.sync(() => backend.picks.shift() ?? null),
      'Projects.inspectFolder': ({ path }) => inspect(backend, path),
      'Projects.initGit': ({ path }) =>
        Effect.gen(function* () {
          backend.calls.push(`Projects.initGit:${path}`);
          if (backend.gitMissing) {
            return yield* new ProjectsError({ reason: 'GitUnavailable', detail: 'git is not installed' });
          }
          if (backend.initFails) return yield* new ProjectsError({ reason: 'GitInitFailed', detail: 'fatal: cannot mkdir .git' });
          if (path in backend.folders && backend.folders[path] === null) backend.folders[path] = 'master';
          return yield* inspect(backend, path);
        }),
      'Projects.checkFolder': ({ projectId }) =>
        Effect.gen(function* () {
          backend.calls.push(`Projects.checkFolder:${projectId}`);
          if (backend.checkFails) return yield* Effect.die('the disk is unreadable');
          if (!backend.projects.some((candidate) => candidate.projectId === projectId)) return yield* notFound(projectId);
          return backend.missing.has(projectId) ? ('Missing' as const) : ('Present' as const);
        }),
      'Projects.markUsed': ({ projectId }) =>
        Effect.sync(() => {
          backend.calls.push(`Projects.markUsed:${projectId}`);
          backend.projects = backend.projects.map((candidate) =>
            candidate.projectId === projectId ? { ...candidate, lastUsedAt: Date.now() } : candidate,
          );
        }),
    }),
    AppInfoRpcs.toLayer({ 'AppInfo.get': () => Effect.die('unused') }),
    layerWindowUnused,
    layerFilesUnused,
  );

/** The same, with settings that answer Spanish and accept any language. */
export const layerFakeBackend = (backend: FakeBackend) =>
  Layer.mergeAll(
    layerFakeProjects(backend),
    SettingsRpcs.toLayer({
      'Settings.get': () => Effect.succeed({ language: 'es' as const, providers: [] }),
      'Settings.setLanguage': ({ language }) => Effect.succeed({ language, providers: [] }),
      'Settings.setProvider': ({ enabled, provider }) => Effect.succeed({ language: 'es' as const, providers: enabled ? [provider] : [] }),
    }),
  );

/** The `EffectRuntime` stand-in tests provide: the real client served by the fake backend. */
export const fakeRuntime = (backend: FakeBackend) => {
  const layer = makeDesktopTestLayer(layerFakeBackend(backend));
  return { run: (effect: Effect.Effect<unknown, unknown, never>) => Effect.runPromiseExit(Effect.provide(effect as never, layer)) };
};
