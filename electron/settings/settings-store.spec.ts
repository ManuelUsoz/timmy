import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from '@effect/vitest';
import { Effect } from 'effect';
import { defaultSettings } from '../../src/shared/settings/settings.model';
import { SettingsStore, layerSettingsStore, layerSettingsStoreTest } from './settings-store';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'timmy-settings-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const withFile = <A, E>(file: string, effect: Effect.Effect<A, E, SettingsStore>) =>
  effect.pipe(Effect.provide(layerSettingsStore(file)));

describe('SettingsStore', () => {
  it.effect('defaults to Spanish and no Providers when nothing was stored', () =>
    Effect.gen(function* () {
      const settings = yield* withFile(path.join(dir, 'settings.json'), SettingsStore.use((s) => s.get));
      expect(settings).toEqual({ ...defaultSettings, language: 'es', providers: [] });
    }),
  );

  it.effect('keeps the language across restarts', () =>
    Effect.gen(function* () {
      const file = path.join(dir, 'settings.json');
      const saved = yield* withFile(file, SettingsStore.use((s) => s.setLanguage('en')));
      expect(saved).toEqual({ ...defaultSettings, language: 'en', providers: [] });
      // A second layer reads the file again, as a restart would.
      expect(yield* withFile(file, SettingsStore.use((s) => s.get))).toEqual({ ...defaultSettings, language: 'en', providers: [] });
    }),
  );

  it.effect('keeps the enabled Providers across restarts, in a stable order', () =>
    Effect.gen(function* () {
      const file = path.join(dir, 'settings.json');
      yield* withFile(file, SettingsStore.use((s) => s.setProvider('Codex', true)));
      const saved = yield* withFile(file, SettingsStore.use((s) => s.setProvider('OpenCode', true)));
      expect(saved.providers).toEqual(['OpenCode', 'Codex']);
      expect((yield* withFile(file, SettingsStore.use((s) => s.get))).providers).toEqual(['OpenCode', 'Codex']);
      const fewer = yield* withFile(file, SettingsStore.use((s) => s.setProvider('OpenCode', false)));
      expect(fewer.providers).toEqual(['Codex']);
      expect((yield* withFile(file, SettingsStore.use((s) => s.get))).providers).toEqual(['Codex']);
    }),
  );

  it.effect('enabling a Provider twice, or disabling one that is off, changes nothing', () =>
    Effect.gen(function* () {
      const file = path.join(dir, 'settings.json');
      yield* withFile(file, SettingsStore.use((s) => s.setProvider('ClaudeCode', true)));
      const again = yield* withFile(file, SettingsStore.use((s) => s.setProvider('ClaudeCode', true)));
      expect(again.providers).toEqual(['ClaudeCode']);
      const off = yield* withFile(file, SettingsStore.use((s) => s.setProvider('Codex', false)));
      expect(off.providers).toEqual(['ClaudeCode']);
    }),
  );

  it.effect('keeps the language of a file written before Providers existed', () =>
    Effect.gen(function* () {
      const file = path.join(dir, 'settings.json');
      writeFileSync(file, JSON.stringify({ language: 'en' }));
      expect(yield* withFile(file, SettingsStore.use((s) => s.get))).toEqual({ ...defaultSettings, language: 'en', providers: [] });
    }),
  );

  it.effect('setting the language keeps the enabled Providers', () =>
    Effect.gen(function* () {
      const file = path.join(dir, 'settings.json');
      yield* withFile(file, SettingsStore.use((s) => s.setProvider('Codex', true)));
      const saved = yield* withFile(file, SettingsStore.use((s) => s.setLanguage('en')));
      expect(saved).toEqual({ ...defaultSettings, language: 'en', providers: ['Codex'] });
    }),
  );

  it.effect('creates the directory when it does not exist yet', () =>
    Effect.gen(function* () {
      const file = path.join(dir, 'nested', 'settings.json');
      yield* withFile(file, SettingsStore.use((s) => s.setLanguage('en')));
      expect(yield* withFile(file, SettingsStore.use((s) => s.get))).toEqual({ ...defaultSettings, language: 'en', providers: [] });
    }),
  );

  it.effect('alerts through the toast Channel for Waiting, Done and Error until the user says otherwise', () =>
    Effect.gen(function* () {
      const settings = yield* withFile(path.join(dir, 'settings.json'), SettingsStore.use((s) => s.get));
      expect(settings.channels).toEqual({ Toast: { enabled: true, types: ['Waiting', 'Done', 'Error'] } });
    }),
  );

  it.effect('keeps a Channel switched off, with the types it alerts for, across restarts', () =>
    Effect.gen(function* () {
      const file = path.join(dir, 'settings.json');
      const saved = yield* withFile(file, SettingsStore.use((s) => s.setChannel('Toast', { _tag: 'Switch', enabled: false })));
      expect(saved.channels.Toast).toEqual({ enabled: false, types: ['Waiting', 'Done', 'Error'] });
      expect((yield* withFile(file, SettingsStore.use((s) => s.get))).channels.Toast).toEqual({ enabled: false, types: ['Waiting', 'Done', 'Error'] });
    }),
  );

  it.effect('keeps the types a Channel alerts for across restarts, in a stable order', () =>
    Effect.gen(function* () {
      const file = path.join(dir, 'settings.json');
      yield* withFile(file, SettingsStore.use((s) => s.setChannel('Toast', { _tag: 'Type', type: 'Waiting', enabled: false })));
      const fewer = yield* withFile(file, SettingsStore.use((s) => s.setChannel('Toast', { _tag: 'Type', type: 'Done', enabled: false })));
      expect(fewer.channels.Toast).toEqual({ enabled: true, types: ['Error'] });
      const back = yield* withFile(file, SettingsStore.use((s) => s.setChannel('Toast', { _tag: 'Type', type: 'Waiting', enabled: true })));
      expect(back.channels.Toast.types).toEqual(['Waiting', 'Error']);
      expect((yield* withFile(file, SettingsStore.use((s) => s.get))).channels.Toast.types).toEqual(['Waiting', 'Error']);
    }),
  );

  it.effect('gives a file written before Channels existed the default Channels and keeps the rest', () =>
    Effect.gen(function* () {
      const file = path.join(dir, 'settings.json');
      writeFileSync(file, JSON.stringify({ language: 'en', providers: ['Codex'] }));
      expect(yield* withFile(file, SettingsStore.use((s) => s.get))).toEqual({
        language: 'en',
        providers: ['Codex'],
        channels: { Toast: { enabled: true, types: ['Waiting', 'Done', 'Error'] } },
      });
    }),
  );

  it.effect('changing a Channel keeps the language and the Providers', () =>
    Effect.gen(function* () {
      const file = path.join(dir, 'settings.json');
      yield* withFile(file, SettingsStore.use((s) => s.setProvider('Codex', true)));
      yield* withFile(file, SettingsStore.use((s) => s.setLanguage('en')));
      const saved = yield* withFile(file, SettingsStore.use((s) => s.setChannel('Toast', { _tag: 'Switch', enabled: false })));
      expect(saved.language).toEqual('en');
      expect(saved.providers).toEqual(['Codex']);
    }),
  );

  const invalid: ReadonlyArray<readonly [string, string]> = [
    ['not json', '{oops'],
    ['an unknown language', JSON.stringify({ language: 'xx' })],
    ['an unknown Provider', JSON.stringify({ language: 'en', providers: ['Gemini'] })],
    ['the wrong shape', JSON.stringify([1])],
    ['a Channel alerting for a status that never alerts', JSON.stringify({ language: 'en', channels: { Toast: { enabled: true, types: ['Working'] } } })],
  ];
  for (const [name, content] of invalid) {
    it.effect(`falls back to the defaults when the stored file is ${name}`, () =>
      Effect.gen(function* () {
        const file = path.join(dir, 'settings.json');
        writeFileSync(file, content);
        expect(yield* withFile(file, SettingsStore.use((s) => s.get))).toEqual({ ...defaultSettings, language: 'es', providers: [] });
      }),
    );
  }

  it.effect('the in-memory double behaves the same without touching the disk', () =>
    Effect.gen(function* () {
      const store = layerSettingsStoreTest({ ...defaultSettings, language: 'en' });
      const settings = yield* SettingsStore.use((s) => s.setLanguage('es')).pipe(Effect.provide(store));
      expect(settings).toEqual({ ...defaultSettings, language: 'es', providers: [] });
      const enabled = yield* SettingsStore.use((s) => s.setProvider('OpenCode', true)).pipe(Effect.provide(store));
      expect(enabled.providers).toEqual(['OpenCode']);
    }),
  );
});
