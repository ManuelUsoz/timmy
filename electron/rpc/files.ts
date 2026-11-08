import { Effect } from 'effect';
import { FilesRpcs } from '../../src/shared/files/files.rpc';
import { FilesState } from '../files/files-state';
import { ProjectFiles } from '../files/project-files';

export const layerFilesHandlers = FilesRpcs.toLayer(
  Effect.gen(function* () {
    const files = yield* ProjectFiles;
    const state = yield* FilesState;
    return {
      'Files.list': ({ cwd }) => files.list(cwd),
      'Files.listDir': ({ cwd, dir }) => files.listDir(cwd, dir),
      'Files.read': ({ cwd, file }) => files.read(cwd, file),
      'Files.getState': ({ projectId }) => state.get(projectId),
      'Files.saveState': ({ projectId, ...saved }) => state.saveProject(projectId, saved),
      'Files.saveWidth': ({ width }) => state.saveWidth(width),
    };
  }),
);
