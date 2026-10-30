import path from 'node:path';
import { Context, Effect, Layer, Option } from 'effect';
import type { Project } from '../../src/shared/projects/projects.model';
import { ProjectId } from '../../src/shared/sessions/sessions.model';
import { projectIdOfCwd } from './project-id';
import { SessionRepo } from './session-repo';

/** The name a project gets when the user does not choose one: the name of its folder. */
export const defaultProjectName = (cwd: string): string => path.basename(cwd) || cwd;

/**
 * The only place that knows how a working directory maps to a Timmy project. The id stays derived from the
 * cwd, so a session started in a folder belongs to the same project whether or not it is in the user's list.
 * Whatever is in the list is persisted by the `SessionRepo`.
 */
export class ProjectResolver extends Context.Service<
  ProjectResolver,
  {
    /** The project of `cwd`, registering it on first use (without putting it in the list). */
    readonly resolveByCwd: (cwd: string) => Effect.Effect<ProjectId>;
    /** The projects in the user's list. */
    readonly list: Effect.Effect<ReadonlyArray<Project>>;
    /** The project in the list that owns the folder `cwd`. */
    readonly findByCwd: (cwd: string) => Effect.Effect<Option.Option<Project>>;
    readonly find: (projectId: ProjectId) => Effect.Effect<Option.Option<Project>>;
    /** Puts the folder in the list. Sessions it already had are kept. */
    readonly add: (cwd: string, name?: string) => Effect.Effect<Project>;
    /** Takes the project out of the list; nothing else changes. */
    readonly remove: (projectId: ProjectId) => Effect.Effect<void>;
    /** Remembers the project as the last one opened. */
    readonly touch: (projectId: ProjectId) => Effect.Effect<void>;
    /**
     * Puts the projects that only exist because they have sessions into the list, once in the life of the
     * store, and only those `eligible` says are still worth listing.
     */
    readonly importImplicit: (eligible: (cwd: string) => Effect.Effect<boolean>) => Effect.Effect<void>;
  }
>()('sessions/ProjectResolver') {}

export const layerProjectResolver = Layer.effect(
  ProjectResolver,
  Effect.gen(function* () {
    const repo = yield* SessionRepo;

    const find = (projectId: ProjectId) => repo.getProject(projectId);

    return ProjectResolver.of({
      resolveByCwd: Effect.fn('ProjectResolver.resolveByCwd')(function* (cwd) {
        const projectId = projectIdOfCwd(cwd);
        yield* repo.ensureProject(projectId, cwd);
        return projectId;
      }),
      list: repo.listProjects,
      find,
      findByCwd: (cwd) => find(projectIdOfCwd(cwd)),
      add: Effect.fn('ProjectResolver.add')(function* (cwd, name) {
        const projectId = projectIdOfCwd(cwd);
        const trimmed = name?.trim() ?? '';
        yield* repo.saveProject(projectId, cwd, trimmed === '' ? defaultProjectName(cwd) : trimmed);
        return yield* find(projectId).pipe(
          Effect.flatMap(
            Option.match({
              onNone: () => Effect.die(`Project ${projectId} vanished right after it was saved`),
              onSome: Effect.succeed,
            }),
          ),
        );
      }),
      remove: repo.unlistProject,
      touch: repo.markProjectUsed,
      importImplicit: Effect.fn('ProjectResolver.importImplicit')(function* (eligible) {
        if (yield* repo.implicitProjectsImported) return;
        for (const implicit of yield* repo.implicitProjects) {
          if (yield* eligible(implicit.cwd)) {
            yield* repo.saveProject(implicit.projectId, implicit.cwd, defaultProjectName(implicit.cwd));
          }
        }
        yield* repo.markImplicitProjectsImported;
      }),
    });
  }),
);
