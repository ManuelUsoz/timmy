import { TestBed } from '@angular/core/testing';
import { Effect, Layer, Ref } from 'effect';
import { AppInfoRpcs } from '../../shared/app-info/app-info.rpc';
import type { Language } from '../../shared/settings/settings.model';
import { SettingsRpcs } from '../../shared/settings/settings.rpc';
import { layerChatUnused, layerProjectsUnused, layerSessionsUnused, layerWindowUnused, makeDesktopTestLayer } from './desktop-layers';
import { EffectRuntime } from './effect-runtime';
import { dictionaries, en, es } from './i18n-dictionaries';
import { I18n } from './i18n';
import { ToastService } from './toast';

/** The real client against a main whose stored language is a Ref. `failSave` makes storing die. */
const setup = (options: { stored?: Language; failSave?: boolean } = {}) => {
  const stored = Ref.makeUnsafe<Language>(options.stored ?? 'es');
  const saves: Language[] = [];
  const handlers = Layer.mergeAll(
    SettingsRpcs.toLayer({
      'Settings.get': () => Effect.map(Ref.get(stored), (language) => ({ language })),
      'Settings.setLanguage': ({ language }) =>
        options.failSave
          ? Effect.die('disk full')
          : Effect.sync(() => void saves.push(language)).pipe(
              Effect.andThen(Ref.set(stored, language)),
              Effect.as({ language }),
            ),
    }),
    AppInfoRpcs.toLayer({ 'AppInfo.get': () => Effect.die('unused') }),
    layerChatUnused,
    layerSessionsUnused,
    layerWindowUnused,
    layerProjectsUnused,
  );
  const layer = makeDesktopTestLayer(handlers);
  TestBed.configureTestingModule({
    providers: [
      {
        provide: EffectRuntime,
        useValue: { run: (e: Effect.Effect<unknown, unknown, never>) => Effect.runPromiseExit(Effect.provide(e as never, layer)) },
      },
    ],
  });
  const i18n = TestBed.inject(I18n);
  const settle = () => new Promise((resolve) => setTimeout(resolve, 10));
  return { i18n, saves, stored, settle };
};

describe('dictionaries', () => {
  it('have the same keys in both languages, all with text', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(es).sort());
    for (const dictionary of Object.values(dictionaries)) {
      for (const text of Object.values(dictionary)) expect(text.trim()).not.toBe('');
    }
  });
});

describe('I18n', () => {
  it('speaks Spanish until told otherwise', () => {
    const { i18n } = setup();
    expect(i18n.language()).toBe('es');
    expect(i18n.t('workspace.comingSoon')).toBe('Próximamente');
  });

  it('fills the {placeholders} of a text with the given values', () => {
    const { i18n } = setup();
    expect(i18n.t('projects.live', { count: 3 })).toBe('3 sesiones vivas');
    expect(i18n.t('newProject.duplicate', { name: 'timmy' })).toContain('como timmy');
    expect(i18n.t('projects.live', {})).toBe('{count} sesiones vivas');
  });

  it('adopts the language stored in main', async () => {
    const { i18n, settle } = setup({ stored: 'en' });
    await settle();
    expect(i18n.language()).toBe('en');
    expect(i18n.t('workspace.comingSoon')).toBe('Coming soon');
  });

  it('applies a new language at once and stores it in main', async () => {
    const { i18n, saves, stored, settle } = setup();
    await settle();
    i18n.setLanguage('en');
    expect(i18n.t('workspace.comingSoon')).toBe('Coming soon'); // before main has answered
    await settle();
    expect(saves).toEqual(['en']);
    expect(Effect.runSync(Ref.get(stored))).toBe('en');
    expect(i18n.error()).toBeNull();
  });

  it('goes back to the previous language and says so when storing fails', async () => {
    const { i18n, settle } = setup({ failSave: true });
    await settle();
    i18n.setLanguage('en');
    await settle();
    expect(i18n.language()).toBe('es');
    expect(i18n.error()).not.toBeNull();
    expect(TestBed.inject(ToastService).toasts().map((toast) => [toast.tone, toast.body])).toEqual([['error', 'settings.saveFailed']]);
  });

  it('marks the document with the language', async () => {
    const { i18n, settle } = setup();
    i18n.setLanguage('en');
    await settle();
    expect(document.documentElement.lang).toBe('en');
  });
});
