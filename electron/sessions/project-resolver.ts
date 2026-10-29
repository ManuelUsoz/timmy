import { Context, Effect, Layer } from 'effect';
import { ProjectId } from '../../src/shared/sessions/sessions.model';
import { projectIdOfCwd } from './project-id';
import { SessionRepo } from './session-repo';

/**
 * The only place that knows how a working directory maps to a Timmy project. Projects are
 * implicit for now (id derived from the cwd); real project entities replace this layer.
 */
export class ProjectResolver extends Context.Service<
  ProjectResolver,
  {
    /** The project of `cwd`, registering it on first use. */
    readonly resolveByCwd: (cwd: string) => Effect.Effect<ProjectId>;
  }
>()('sessions/ProjectResolver') {}

export const layerProjectResolver = Layer.effect(
  ProjectResolver,
  Effect.gen(function* () {
    const repo = yield* SessionRepo;
    return ProjectResolver.of({
      resolveByCwd: Effect.fn('ProjectResolver.resolveByCwd')(function* (cwd) {
        const projectId = projectIdOfCwd(cwd);
        yield* repo.ensureProject(projectId, cwd);
        return projectId;
      }),
    });
  }),
);
