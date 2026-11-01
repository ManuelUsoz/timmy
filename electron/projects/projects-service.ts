import path from 'node:path';
import { Context, Effect, Layer, Option } from 'effect';
import type { FolderInspection, FolderStatus, Project } from '../../src/shared/projects/projects.model';
import { ProjectsError } from '../../src/shared/projects/projects-error.model';
import type { ProjectId } from '../../src/shared/sessions/sessions.model';
import { ProjectResolver } from '../sessions/project-resolver';
import { FolderPicker } from './folder-picker';
import { ProjectFolders } from './project-folders';

/** Projects as the renderer manages them: the list, adding a folder, removing, and checking the folder is still there. */
export class ProjectsService extends Context.Service<
  ProjectsService,
  {
    readonly list: Effect.Effect<ReadonlyArray<Project>>;
    /** The folder the user picked; `None` when they cancel. */
    readonly pickFolder: Effect.Effect<Option.Option<string>>;
    readonly inspectFolder: (folder: string) => Effect.Effect<FolderInspection, ProjectsError>;
    readonly initGit: (folder: string) => Effect.Effect<FolderInspection, ProjectsError>;
    readonly add: (folder: string, name?: string) => Effect.Effect<Project, ProjectsError>;
    readonly remove: (projectId: ProjectId) => Effect.Effect<void, ProjectsError>;
    readonly checkFolder: (projectId: ProjectId) => Effect.Effect<FolderStatus, ProjectsError>;
    readonly markUsed: (projectId: ProjectId) => Effect.Effect<void, ProjectsError>;
  }
>()('projects/ProjectsService') {}

/** Also puts the projects that already have sessions into the list the first time, if their folder is still a git repository. */
export const layerProjectsService: Layer.Layer<ProjectsService, never, ProjectResolver | ProjectFolders | FolderPicker> =
  Layer.effect(
    ProjectsService,
    Effect.gen(function* () {
      const resolver = yield* ProjectResolver;
      const folders = yield* ProjectFolders;
      const picker = yield* FolderPicker;

      yield* resolver.importImplicit((cwd) =>
        Effect.gen(function* () {
          return (yield* folders.exists(cwd)) && Option.isSome(yield* folders.gitBranch(cwd));
        }),
      );

      const requireProject = Effect.fn('ProjectsService.requireProject')(function* (projectId: ProjectId) {
        const project = yield* resolver.find(projectId);
        if (Option.isNone(project)) {
          return yield* new ProjectsError({ reason: 'ProjectNotFound', detail: `No project ${projectId} in the list` });
        }
        return project.value;
      });

      const inspectFolder = Effect.fn('ProjectsService.inspectFolder')(function* (input: string) {
        const folder = path.resolve(input);
        if (!(yield* folders.exists(folder))) {
          return yield* new ProjectsError({ reason: 'FolderNotFound', detail: `${folder} is not a folder` });
        }
        const branch = yield* folders.gitBranch(folder);
        const existing = yield* resolver.findByCwd(folder);
        return {
          path: folder,
          branch: Option.getOrNull(branch),
          existingName: Option.getOrNull(Option.map(existing, (project) => project.name)),
        } satisfies FolderInspection;
      });

      return ProjectsService.of({
        list: resolver.list,
        pickFolder: picker.pick,
        inspectFolder,
        initGit: Effect.fn('ProjectsService.initGit')(function* (input) {
          const inspection = yield* inspectFolder(input);
          if (inspection.branch === null) yield* folders.initGit(inspection.path);
          return yield* inspectFolder(inspection.path);
        }),
        add: Effect.fn('ProjectsService.add')(function* (input, name) {
          const inspection = yield* inspectFolder(input);
          if (inspection.existingName !== null) {
            return yield* new ProjectsError({
              reason: 'AlreadyAdded',
              detail: `${inspection.path} is already in the list as ${inspection.existingName}`,
            });
          }
          if (inspection.branch === null) {
            return yield* new ProjectsError({
              reason: 'NotAGitRepository',
              detail: `${inspection.path} is not a git repository`,
            });
          }
          return yield* resolver.add(inspection.path, name);
        }),
        remove: Effect.fn('ProjectsService.remove')(function* (projectId) {
          yield* requireProject(projectId);
          yield* resolver.remove(projectId);
        }),
        checkFolder: Effect.fn('ProjectsService.checkFolder')(function* (projectId) {
          const project = yield* requireProject(projectId);
          return (yield* folders.exists(project.cwd)) ? 'Present' : 'Missing';
        }),
        markUsed: Effect.fn('ProjectsService.markUsed')(function* (projectId) {
          yield* requireProject(projectId);
          yield* resolver.touch(projectId);
        }),
      });
    }),
  );
