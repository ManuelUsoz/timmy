import { Effect, Option } from 'effect';
import { FilesError } from '../../src/shared/files/files-error.model';
import { FilesRpcs } from '../../src/shared/files/files.rpc';
import { FilesState } from '../files/files-state';
import { ProjectFiles } from '../files/project-files';
import { ProjectStore } from '../projects/project-store';

export const layerFilesHandlers = FilesRpcs.toLayer(
  Effect.gen(function* () {
    const files = yield* ProjectFiles;
    const state = yield* FilesState;
    const projects = yield* ProjectStore;
    /** The renderer is untrusted: main reads only the folder of a Project the user added, never one the renderer names. */
    const inProject = <A>(cwd: string, read: Effect.Effect<A, FilesError>) =>
      projects.findByCwd(cwd).pipe(
        Effect.flatMap(
          Option.match({
            onNone: () => Effect.fail(new FilesError({ reason: 'UnknownProject', detail: `${cwd} is not a Project` })),
            onSome: () => read,
          }),
        ),
      );
    return {
      'Files.list': ({ cwd }) => inProject(cwd, files.list(cwd)),
      'Files.listDir': ({ cwd, dir }) => inProject(cwd, files.listDir(cwd, dir)),
      'Files.read': ({ cwd, file }) => inProject(cwd, files.read(cwd, file)),
      'Files.changes': ({ cwd }) => inProject(cwd, files.changes(cwd)),
      'Files.diff': ({ cwd, file }) => inProject(cwd, files.diff(cwd, file)),
      'Files.getState': ({ projectId }) => state.get(projectId),
      'Files.saveState': ({ projectId, ...saved }) => state.saveProject(projectId, saved),
      'Files.saveWidth': ({ width }) => state.saveWidth(width),
    };
  }),
);
