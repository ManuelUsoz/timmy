import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Context, Effect, Layer, Option, Ref, Schema } from 'effect';
import { defaultSettings, Settings, type Language } from '../../src/shared/settings/settings.model';

/** The user's settings. Storage failures are defects: no caller can act on them. */
export class SettingsStore extends Context.Service<
  SettingsStore,
  {
    readonly get: Effect.Effect<Settings>;
    /** Stores the language and answers with the settings as they are afterwards. */
    readonly setLanguage: (language: Language) => Effect.Effect<Settings>;
  }
>()('settings/SettingsStore') {}

const decodeSettings = Schema.decodeUnknownOption(Settings);

/** A missing, unreadable or invalid file is the same as a first run: the defaults. */
const readSettings = (file: string): Effect.Effect<Settings> =>
  Effect.tryPromise(() => readFile(file, 'utf8')).pipe(
    Effect.flatMap((text) => Effect.try(() => JSON.parse(text) as unknown)),
    Effect.map((json) => Option.getOrElse(decodeSettings(json), () => defaultSettings)),
    Effect.orElseSucceed(() => defaultSettings),
  );

/** Written next to the target and renamed over it, so a crash never leaves half a file. */
const writeSettings = (file: string, settings: Settings): Effect.Effect<void> =>
  Effect.tryPromise(async () => {
    await mkdir(path.dirname(file), { recursive: true });
    const partial = `${file}.tmp`;
    await writeFile(partial, JSON.stringify(settings), 'utf8');
    await rename(partial, file);
  }).pipe(Effect.orDie);

const makeStore = (initial: Settings, persist: (settings: Settings) => Effect.Effect<void>) =>
  Effect.gen(function* () {
    const ref = yield* Ref.make(initial);
    return SettingsStore.of({
      get: Ref.get(ref),
      setLanguage: Effect.fn('SettingsStore.setLanguage')(function* (language: Language) {
        const next: Settings = { ...(yield* Ref.get(ref)), language };
        yield* persist(next);
        yield* Ref.set(ref, next);
        return next;
      }),
    });
  });

/** Settings in one JSON file, read once when the layer is built. */
export const layerSettingsStore = (file: string): Layer.Layer<SettingsStore> =>
  Layer.effect(
    SettingsStore,
    Effect.flatMap(readSettings(file), (initial) => makeStore(initial, (settings) => writeSettings(file, settings))),
  );

/** In memory, for tests of the layers above it. */
export const layerSettingsStoreTest = (initial: Settings = defaultSettings): Layer.Layer<SettingsStore> =>
  Layer.effect(SettingsStore, makeStore(initial, () => Effect.void));
