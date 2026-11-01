import { Effect } from 'effect';
import { FilesRpcs } from '../../src/shared/files/files.rpc';
import { ProjectFiles } from '../files/project-files';

export const layerFilesHandlers = FilesRpcs.toLayer(
  Effect.gen(function* () {
    const files = yield* ProjectFiles;
    return { 'Files.list': ({ cwd }) => files.list(cwd) };
  }),
);
