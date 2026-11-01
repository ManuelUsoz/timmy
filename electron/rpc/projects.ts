import { Effect, Option } from 'effect';
import { ProjectsRpcs } from '../../src/shared/projects/projects.rpc';
import { ProjectsService } from '../projects/projects-service';

export const layerProjectsHandlers = ProjectsRpcs.toLayer(
  Effect.gen(function* () {
    const projects = yield* ProjectsService;
    return {
      'Projects.list': () => projects.list,
      'Projects.add': ({ path, name }) => projects.add(path, name),
      'Projects.remove': ({ projectId }) => projects.remove(projectId),
      'Projects.pickFolder': () => Effect.map(projects.pickFolder, Option.getOrNull),
      'Projects.inspectFolder': ({ path }) => projects.inspectFolder(path),
      'Projects.initGit': ({ path }) => projects.initGit(path),
      'Projects.checkFolder': ({ projectId }) => projects.checkFolder(projectId),
      'Projects.markUsed': ({ projectId }) => projects.markUsed(projectId),
    };
  }),
);
