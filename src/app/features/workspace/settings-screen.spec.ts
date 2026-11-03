import { TestBed } from '@angular/core/testing';
import { Effect, Ref } from 'effect';
import { defaultSettings, type Settings } from '../../../shared/settings/settings.model';
import { SettingsRpcs } from '../../../shared/settings/settings.rpc';
import { makeDesktopTestLayer } from '../../core/desktop-layers';
import { EffectRuntime } from '../../core/effect-runtime';
import { ProviderSettings } from '../../core/provider-settings';
import { ToastService } from '../../core/toast';
import { SettingsScreen } from './settings-screen';

/** The real client against a main whose settings are a Ref. `failSave` makes storing a Provider die; `failLoad` makes reading die. */
const setup = async (options: { stored?: Settings; failSave?: boolean; failLoad?: boolean; slowFirstSave?: boolean } = {}) => {
  let saves = 0;
  const stored = Ref.makeUnsafe<Settings>(options.stored ?? defaultSettings);
  const handlers = SettingsRpcs.toLayer({
    'Settings.get': () => (options.failLoad ? Effect.die('disk gone') : Ref.get(stored)),
    'Settings.setLanguage': ({ language }) => Ref.updateAndGet(stored, (s) => ({ ...s, language })),
    'Settings.setProvider': ({ provider, enabled }) => {
      // The first save answers late, as when main is busy: its answer arrives after the second one's.
      const delay = options.slowFirstSave && saves++ === 0 ? Effect.sleep(60) : Effect.void;
      return options.failSave
        ? Effect.die('disk full')
        : Ref.updateAndGet(stored, (s) => ({
            ...s,
            providers: enabled ? [...s.providers.filter((p) => p !== provider), provider] : s.providers.filter((p) => p !== provider),
          })).pipe(Effect.tap(() => delay));
    },
  });
  const layer = makeDesktopTestLayer(handlers);
  TestBed.configureTestingModule({
    providers: [
      {
        provide: EffectRuntime,
        useValue: { run: (e: Effect.Effect<unknown, unknown, never>) => Effect.runPromiseExit(Effect.provide(e as never, layer)) },
      },
    ],
  });
  const fixture = TestBed.createComponent(SettingsScreen);
  const el: HTMLElement = fixture.nativeElement;
  const settle = async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
    fixture.detectChanges();
    await fixture.whenStable();
  };
  fixture.detectChanges();
  await settle();
  const byLabel = (label: string) => el.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
  const rows = () =>
    Array.from(el.querySelectorAll<HTMLElement>('[data-testid="provider-row"]')).map((row) => ({
      name: row.querySelector('.name')?.textContent?.trim(),
      status: row.querySelector('.status')?.textContent?.trim(),
    }));
  const section = (name: string) => Array.from(el.querySelectorAll<HTMLButtonElement>('nav button')).find((b) => b.textContent?.trim() === name)!;
  return { el, stored, settle, byLabel, rows, section, providers: TestBed.inject(ProviderSettings) };
};

describe('SettingsScreen: Providers', () => {
  it('lists the three Providers, none enabled until the user picks', async () => {
    const { rows } = await setup();
    expect(rows()).toEqual([
      { name: 'OpenCode', status: 'Desactivado' },
      { name: 'Claude Code', status: 'Desactivado' },
      { name: 'Codex', status: 'Desactivado' },
    ]);
  });

  it('shows the Providers that were stored as enabled', async () => {
    const { rows, byLabel } = await setup({ stored: { language: 'es', providers: ['ClaudeCode'] } });
    expect(rows().map((r) => r.status)).toEqual(['Desactivado', 'Activado', 'Desactivado']);
    expect(byLabel('Desactivar Claude Code')).not.toBeNull();
    expect(byLabel('Activar OpenCode')).not.toBeNull();
  });

  it('enables a Provider, stores it in main and offers to disable it', async () => {
    const { rows, byLabel, stored, settle } = await setup();
    byLabel('Activar Codex')!.click();
    await settle();
    expect(Effect.runSync(Ref.get(stored)).providers).toEqual(['Codex']);
    expect(rows().map((r) => r.status)).toEqual(['Desactivado', 'Desactivado', 'Activado']);
    expect(byLabel('Desactivar Codex')).not.toBeNull();
  });

  it('disables a Provider again', async () => {
    const { rows, byLabel, stored, settle } = await setup({ stored: { language: 'es', providers: ['OpenCode', 'Codex'] } });
    byLabel('Desactivar OpenCode')!.click();
    await settle();
    expect(Effect.runSync(Ref.get(stored)).providers).toEqual(['Codex']);
    expect(rows().map((r) => r.status)).toEqual(['Desactivado', 'Desactivado', 'Activado']);
  });

  it('leaves the Provider as it was and says so when storing fails', async () => {
    const { rows, byLabel, settle } = await setup({ failSave: true });
    byLabel('Activar OpenCode')!.click();
    await settle();
    expect(rows()[0]).toEqual({ name: 'OpenCode', status: 'Desactivado' });
    expect(TestBed.inject(ToastService).toasts().map((toast) => [toast.tone, toast.body])).toEqual([['error', 'settings.providers.saveFailed']]);
  });

  it('says the settings could not be read, instead of showing Providers that are not known', async () => {
    const { el, rows } = await setup({ failLoad: true });
    expect(el.querySelector('[role="alert"]')?.textContent).toContain('No se pudieron leer los ajustes');
    expect(rows()).toEqual([]);
  });

  it('shows what main holds when two quick changes are answered out of order', async () => {
    const { byLabel, rows, providers, settle } = await setup({ slowFirstSave: true });
    byLabel('Activar OpenCode')!.click();
    byLabel('Activar Codex')!.click();
    await new Promise((resolve) => setTimeout(resolve, 150));
    await settle();
    expect(providers.enabled()).toEqual(['OpenCode', 'Codex']);
    expect(rows().map((r) => r.status)).toEqual(['Activado', 'Desactivado', 'Activado']);
  });

  it('makes the enabled Providers available to the rest of the app', async () => {
    const { byLabel, providers, settle } = await setup({ stored: { language: 'es', providers: ['OpenCode'] } });
    expect(providers.enabled()).toEqual(['OpenCode']);
    byLabel('Activar Codex')!.click();
    await settle();
    expect(providers.enabled()).toEqual(['OpenCode', 'Codex']);
  });
});

describe('SettingsScreen: Language', () => {
  it('moves between sections, marking the current one', async () => {
    const { el, section, settle } = await setup();
    expect(section('Proveedores').getAttribute('aria-current')).toBe('page');
    section('Idioma').click();
    await settle();
    expect(section('Idioma').getAttribute('aria-current')).toBe('page');
    expect(section('Proveedores').getAttribute('aria-current')).toBe('false');
    expect(el.querySelector('h2')?.textContent).toBe('Idioma');
  });

  it('picks the language from a radio list and stores it', async () => {
    const { el, section, stored, settle } = await setup();
    section('Idioma').click();
    await settle();
    const radio = (name: string) => Array.from(el.querySelectorAll<HTMLButtonElement>('[role="radio"]')).find((b) => b.textContent?.trim() === name)!;
    expect(radio('Español').getAttribute('aria-checked')).toBe('true');
    radio('English').click();
    await settle();
    expect(Effect.runSync(Ref.get(stored)).language).toBe('en');
    expect(radio('English').getAttribute('aria-checked')).toBe('true');
    expect(radio('Español').getAttribute('aria-checked')).toBe('false');
  });
});
