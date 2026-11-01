import { Effect, Layer, Stream } from 'effect';
import { AppInfoRpcs } from '../../../shared/app-info/app-info.rpc';
import { SessionId } from '../../../shared/chat/ids.model';
import type { FolderInspection, Project } from '../../../shared/projects/projects.model';
import { ProjectsError } from '../../../shared/projects/projects-error.model';
import { ProjectsRpcs } from '../../../shared/projects/projects.rpc';
import { ProjectId, ProviderSessionId, type SessionSummary } from '../../../shared/sessions/sessions.model';
import { SessionsRpcs } from '../../../shared/sessions/sessions.rpc';
import { SettingsRpcs } from '../../../shared/settings/settings.rpc';
import { layerChatUnused, layerWindowUnused, makeDesktopTestLayer } from '../../core/desktop-layers';

export const project = (name: string, overrides: Partial<Project> = {}): Project => ({
  projectId: ProjectId.make(`p-${name}`),
  cwd: `/work/${name}`,
  name,
  createdAt: 0,
  lastUsedAt: null,
  ...overrides,
});

export const session = (projectName: string, id: string, title: string, updatedAt = 0): SessionSummary => ({
  sessionId: SessionId.make(id),
  projectId: ProjectId.make(`p-${projectName}`),
  provider: 'Claude',
  providerSessionId: ProviderSessionId.make(`native-${id}`),
  cwd: `/work/${projectName}`,
  title,
  createdAt: 0,
  updatedAt,
});

/** The main process as the Workspace sees it, in memory. Tests read and change `state` while the UI runs. */
export interface FakeBackend {
  projects: Project[];
  sessions: SessionSummary[];
  /** Projects whose folder is gone. */
  missing: Set<ProjectId>;
  /** Folders on the fake disk: a branch, or null for a folder without git. */
  folders: Record<string, string | null>;
  /** What the folder dialog answers next; empty means the user cancels. */
  picks: string[];
  gitMissing: boolean;
  /** Makes `Projects.list` break, as a failing disk would. */
  listFails: boolean;
  /** Calls the UI made, as `Name` or `Name:argument`. */
  calls: string[];
}

/** Each backend owns its own copy of what it is given, so one test cannot change another's disk. */
export const makeBackend = (initial: Partial<FakeBackend> = {}): FakeBackend => ({
  gitMissing: false,
  listFails: false,
  calls: [],
  ...initial,
  projects: [...(initial.projects ?? [])],
  sessions: [...(initial.sessions ?? [])],
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

/** Handlers for the Projects and Sessions RPCs over `backend`, and dying ones for chat, window and app info. */
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
          if (path in backend.folders && backend.folders[path] === null) backend.folders[path] = 'master';
          return yield* inspect(backend, path);
        }),
      'Projects.checkFolder': ({ projectId }) =>
        Effect.gen(function* () {
          backend.calls.push(`Projects.checkFolder:${projectId}`);
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
    SessionsRpcs.toLayer({
      'Sessions.list': ({ cwd }) => Effect.sync(() => backend.sessions.filter((candidate) => candidate.cwd === cwd)),
      'Sessions.history': ({ ref }) =>
        Effect.succeed([
          { _tag: 'Message' as const, role: 'User' as const, text: `question ${ref.sessionId}` },
          { _tag: 'Message' as const, role: 'Assistant' as const, text: `answer ${ref.sessionId}` },
        ]),
      'Sessions.listSubagents': () => Effect.succeed([]),
      'Sessions.rename': () => Effect.void,
      'Sessions.delete': () => Effect.void,
      'Sessions.changes': () => Stream.empty,
    }),
    AppInfoRpcs.toLayer({ 'AppInfo.get': () => Effect.die('unused') }),
    layerChatUnused,
    layerWindowUnused,
  );

/** The same, with settings that answer Spanish and accept any language. */
export const layerFakeBackend = (backend: FakeBackend) =>
  Layer.mergeAll(
    layerFakeProjects(backend),
    SettingsRpcs.toLayer({
      'Settings.get': () => Effect.succeed({ language: 'es' as const }),
      'Settings.setLanguage': ({ language }) => Effect.succeed({ language }),
    }),
  );

/** The `EffectRuntime` stand-in tests provide: the real client served by the fake backend. */
export const fakeRuntime = (backend: FakeBackend) => {
  const layer = makeDesktopTestLayer(layerFakeBackend(backend));
  return { run: (effect: Effect.Effect<unknown, unknown, never>) => Effect.runPromiseExit(Effect.provide(effect as never, layer)) };
};
