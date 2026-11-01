import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from '@effect/vitest';
import { Effect } from 'effect';
import { SettingsStore, layerSettingsStore, layerSettingsStoreTest } from './settings-store';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'timmy-settings-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const withFile = <A, E>(file: string, effect: Effect.Effect<A, E, SettingsStore>) =>
  effect.pipe(Effect.provide(layerSettingsStore(file)));

describe('SettingsStore', () => {
  it.effect('defaults to Spanish when nothing was stored', () =>
    Effect.gen(function* () {
      const settings = yield* withFile(path.join(dir, 'settings.json'), SettingsStore.use((s) => s.get));
      expect(settings).toEqual({ language: 'es' });
    }),
  );

  it.effect('keeps the language across restarts', () =>
    Effect.gen(function* () {
      const file = path.join(dir, 'settings.json');
      const saved = yield* withFile(file, SettingsStore.use((s) => s.setLanguage('en')));
      expect(saved).toEqual({ language: 'en' });
      // A second layer reads the file again, as a restart would.
      expect(yield* withFile(file, SettingsStore.use((s) => s.get))).toEqual({ language: 'en' });
    }),
  );

  it.effect('creates the directory when it does not exist yet', () =>
    Effect.gen(function* () {
      const file = path.join(dir, 'nested', 'settings.json');
      yield* withFile(file, SettingsStore.use((s) => s.setLanguage('en')));
      expect(yield* withFile(file, SettingsStore.use((s) => s.get))).toEqual({ language: 'en' });
    }),
  );

  const invalid: ReadonlyArray<readonly [string, string]> = [
    ['not json', '{oops'],
    ['an unknown language', JSON.stringify({ language: 'xx' })],
    ['the wrong shape', JSON.stringify([1])],
  ];
  for (const [name, content] of invalid) {
    it.effect(`falls back to the defaults when the stored file is ${name}`, () =>
      Effect.gen(function* () {
        const file = path.join(dir, 'settings.json');
        writeFileSync(file, content);
        expect(yield* withFile(file, SettingsStore.use((s) => s.get))).toEqual({ language: 'es' });
      }),
    );
  }

  it.effect('the in-memory double behaves the same without touching the disk', () =>
    Effect.gen(function* () {
      const store = layerSettingsStoreTest({ language: 'en' });
      const settings = yield* SettingsStore.use((s) => s.setLanguage('es')).pipe(Effect.provide(store));
      expect(settings).toEqual({ language: 'es' });
    }),
  );
});
