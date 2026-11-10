import { Context, Effect, Layer, Option, Schema } from 'effect';
import {
  DEFAULT_BROWSER_WIDTH,
  ProjectBrowserState,
  type FilesBrowserState,
} from '../../src/shared/files/files.model';
import type { ProjectId } from '../../src/shared/projects/projects.model';
import { ProjectStore } from '../projects/project-store';

/** What the Files browser remembers across restarts: per Project, and the width for the whole window. */
export class FilesState extends Context.Service<
  FilesState,
  {
    /** The Project's state with the width; the defaults for whatever was never saved or can no longer be read. */
    readonly get: (projectId: ProjectId) => Effect.Effect<FilesBrowserState>;
    readonly saveProject: (projectId: ProjectId, state: ProjectBrowserState) => Effect.Effect<void>;
    readonly saveWidth: (width: number) => Effect.Effect<void>;
  }
>()('files/FilesState') {}

const WIDTH_KEY = 'files.width';
const projectKey = (projectId: ProjectId) => `files.project.${projectId}`;

const defaults: ProjectBrowserState = { expanded: [], lastFile: null };

const ProjectJson = Schema.fromJsonString(ProjectBrowserState);
const WidthJson = Schema.fromJsonString(Schema.Int);

export const layerFilesState = Layer.effect(
  FilesState,
  Effect.gen(function* () {
    const store = yield* ProjectStore;
    // A row that no longer decodes (an older shape, a hand edit) is the same as no row: the browser starts fresh.
    const stored = <A, I>(key: string, schema: Schema.Codec<A, I>, fallback: A) =>
      store.getState(key).pipe(
        Effect.flatMap(
          Option.match({
            onNone: () => Effect.succeed(fallback),
            onSome: (text) => Schema.decodeUnknownEffect(schema)(text).pipe(Effect.orElseSucceed(() => fallback)),
          }),
        ),
      );
    return FilesState.of({
      get: Effect.fn('FilesState.get')(function* (projectId) {
        const project = yield* stored(projectKey(projectId), ProjectJson, defaults);
        const width = yield* stored(WIDTH_KEY, WidthJson, DEFAULT_BROWSER_WIDTH);
        return { width, ...project };
      }),
      saveProject: Effect.fn('FilesState.saveProject')(function* (projectId, state) {
        yield* store.putState(projectKey(projectId), yield* Schema.encodeEffect(ProjectJson)(state).pipe(Effect.orDie));
      }),
      saveWidth: Effect.fn('FilesState.saveWidth')(function* (width) {
        yield* store.putState(WIDTH_KEY, yield* Schema.encodeEffect(WidthJson)(width).pipe(Effect.orDie));
      }),
    });
  }),
);
