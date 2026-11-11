import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Context, Effect, Layer, Option, Ref, Schema, Semaphore } from 'effect';
import {
  allProviders,
  defaultSettings,
  Settings,
  withChannelChange,
  type Channel,
  type ChannelChange,
  type Language,
  type Provider,
  type ReaderMode,
} from '../../src/shared/settings/settings.model';

/** The user's settings. Storage failures are defects: no caller can act on them. */
export class SettingsStore extends Context.Service<
  SettingsStore,
  {
    readonly get: Effect.Effect<Settings>;
    /** Stores the language and answers with the settings as they are afterwards. */
    readonly setLanguage: (language: Language) => Effect.Effect<Settings>;
    /** Enables or disables a Provider and answers with the settings as they are afterwards. */
    readonly setProvider: (provider: Provider, enabled: boolean) => Effect.Effect<Settings>;
    /** Applies one change to a Channel and answers with the settings as they are afterwards. */
    readonly setChannel: (channel: Channel, change: ChannelChange) => Effect.Effect<Settings>;
    /** Stores the reader's Renderizado/Fuente choice and answers with the settings as they are afterwards. */
    readonly setReader: (reader: ReaderMode) => Effect.Effect<Settings>;
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

/** The Providers with `provider` switched on or off, always in the order Settings lists them. */
const withProvider = (providers: ReadonlyArray<Provider>, provider: Provider, enabled: boolean): ReadonlyArray<Provider> =>
  allProviders.filter((candidate) => (candidate === provider ? enabled : providers.includes(candidate)));

const makeStore = Effect.fnUntraced(function* (initial: Settings, persist: (settings: Settings) => Effect.Effect<void>) {
  const ref = yield* Ref.make(initial);
  // Each change is read, stored and kept as one step, so two quick changes never lose one another.
  const lock = yield* Semaphore.make(1);
  const update = (change: (current: Settings) => Settings) =>
    lock.withPermits(1)(
      Effect.gen(function* () {
        const next = change(yield* Ref.get(ref));
        yield* persist(next);
        yield* Ref.set(ref, next);
        return next;
      }),
    );
  return SettingsStore.of({
    get: Ref.get(ref),
    setLanguage: Effect.fn('SettingsStore.setLanguage')(function* (language: Language) {
      return yield* update((current) => ({ ...current, language }));
    }),
    setProvider: Effect.fn('SettingsStore.setProvider')(function* (provider: Provider, enabled: boolean) {
      return yield* update((current) => ({ ...current, providers: withProvider(current.providers, provider, enabled) }));
    }),
    setChannel: Effect.fn('SettingsStore.setChannel')(function* (channel: Channel, change: ChannelChange) {
      return yield* update((current) => ({
        ...current,
        channels: { ...current.channels, [channel]: withChannelChange(current.channels[channel], change) },
      }));
    }),
    setReader: Effect.fn('SettingsStore.setReader')(function* (reader: ReaderMode) {
      return yield* update((current) => ({ ...current, reader }));
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
