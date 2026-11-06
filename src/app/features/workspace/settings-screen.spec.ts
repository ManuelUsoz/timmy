import { TestBed } from '@angular/core/testing';
import { Effect, Layer, Ref } from 'effect';
import { HooksError } from '../../../shared/hooks/hooks-error.model';
import type { HookStatus } from '../../../shared/hooks/hooks.model';
import { HooksRpcs } from '../../../shared/hooks/hooks.rpc';
import { defaultSettings, withChannelChange, type Settings } from '../../../shared/settings/settings.model';
import { SettingsRpcs } from '../../../shared/settings/settings.rpc';
import { makeDesktopTestLayer } from '../../core/desktop-layers';
import { EffectRuntime } from '../../core/effect-runtime';
import { ProviderSettings } from '../../core/provider-settings';
import { ToastService } from '../../core/toast';
import { SettingsScreen } from './settings-screen';

/** The real client against a main whose settings are a Ref. `failSave` makes storing a Provider die; `failLoad` makes reading die. */
const setup = async (options: { stored?: Settings; failSave?: boolean; failLoad?: boolean; slowFirstSave?: boolean; hooks?: ReadonlyArray<HookStatus>; failHooksLoad?: boolean; hooksError?: HooksError } = {}) => {
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
    'Settings.setChannel': ({ channel, change }) =>
      options.failSave
        ? Effect.die('disk full')
        : Ref.updateAndGet(stored, (s) => ({ ...s, channels: { ...s.channels, [channel]: withChannelChange(s.channels[channel], change) } })),
  });
  const hooks = Ref.makeUnsafe<ReadonlyArray<HookStatus>>(options.hooks ?? []);
  const hooksHandlers = HooksRpcs.toLayer({
    'Hooks.list': () => (options.failHooksLoad ? Effect.die('config gone') : Ref.get(hooks)),
    'Hooks.setActive': ({ provider, active }) =>
      options.hooksError
        ? Effect.fail(options.hooksError)
        : Ref.updateAndGet(hooks, (all) => all.flatMap((hook) => (hook.provider !== provider ? [hook] : active || hook.enabled ? [{ ...hook, active }] : []))),
  });
  const layer = makeDesktopTestLayer(Layer.merge(handlers, hooksHandlers));
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
  const hookRows = () =>
    Array.from(el.querySelectorAll<HTMLElement>('[data-testid="hook-row"]')).map((row) => ({
      name: row.querySelector('.name')?.textContent?.trim(),
      status: row.querySelector('.status')?.textContent?.trim(),
    }));
  return { el, stored, hooks, settle, byLabel, rows, hookRows, section, providers: TestBed.inject(ProviderSettings) };
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
    const { rows, byLabel } = await setup({ stored: { ...defaultSettings, language: 'es', providers: ['ClaudeCode'] } });
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
    const { rows, byLabel, stored, settle } = await setup({ stored: { ...defaultSettings, language: 'es', providers: ['OpenCode', 'Codex'] } });
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
    const { byLabel, providers, settle } = await setup({ stored: { ...defaultSettings, language: 'es', providers: ['OpenCode'] } });
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

describe('SettingsScreen: Hooks', () => {
  const claude = (active: boolean, enabled = true): HookStatus => ({ provider: 'ClaudeCode', enabled, active });

  const openHooks = async (options: Parameters<typeof setup>[0] = {}) => {
    const screen = await setup(options);
    screen.section('Hooks').click();
    await screen.settle();
    return screen;
  };

  it('lists Claude Code with its Hook inactive, and no other Provider', async () => {
    const { hookRows, el } = await openHooks({ hooks: [claude(false)] });
    expect(el.querySelector('h2')?.textContent).toBe('Hooks');
    expect(hookRows()).toEqual([{ name: 'Claude Code', status: 'Inactivo' }]);
  });

  it('activates the Hook, which main stores, and offers to deactivate it', async () => {
    const { hookRows, byLabel, hooks, settle } = await openHooks({ hooks: [claude(false)] });
    byLabel('Activar Hook de Claude Code')!.click();
    await settle();
    expect(Effect.runSync(Ref.get(hooks))).toEqual([claude(true)]);
    expect(hookRows()).toEqual([{ name: 'Claude Code', status: 'Activo' }]);
    expect(byLabel('Desactivar Hook de Claude Code')).not.toBeNull();
  });

  it('deactivates it again', async () => {
    const { hookRows, byLabel, settle } = await openHooks({ hooks: [claude(true)] });
    byLabel('Desactivar Hook de Claude Code')!.click();
    await settle();
    expect(hookRows()).toEqual([{ name: 'Claude Code', status: 'Inactivo' }]);
  });

  it('says what to do when no enabled Provider has a Hook', async () => {
    const { el, hookRows } = await openHooks({ hooks: [] });
    expect(hookRows()).toEqual([]);
    expect(el.querySelector('[data-testid="hooks-empty"]')?.textContent).toContain('Activa un proveedor');
  });

  it('says the Hooks could not be read, instead of an empty list', async () => {
    const { el, hookRows } = await openHooks({ failHooksLoad: true });
    expect(el.querySelector('[role="alert"]')?.textContent).toContain('No se pudieron leer los Hooks');
    expect(hookRows()).toEqual([]);
  });

  it('leaves the Hook as it was and says so when main refuses', async () => {
    const hooksError = new HooksError({ reason: 'ConfigUnreadable', detail: 'settings.json is not valid JSON' });
    const { hookRows, byLabel, settle } = await openHooks({ hooks: [claude(false)], hooksError });
    byLabel('Activar Hook de Claude Code')!.click();
    await settle();
    expect(hookRows()).toEqual([{ name: 'Claude Code', status: 'Inactivo' }]);
    expect(TestBed.inject(ToastService).toasts().map((toast) => [toast.tone, toast.body])).toEqual([['error', 'settings.hooks.saveFailed']]);
  });

  it('reads the list again each time the section is opened, so a Provider enabled meanwhile shows up', async () => {
    const { hooks, section, hookRows, settle } = await openHooks({ hooks: [] });
    expect(hookRows()).toEqual([]);
    Effect.runSync(Ref.set(hooks, [claude(false)]));
    section('Proveedores').click();
    await settle();
    section('Hooks').click();
    await settle();
    expect(hookRows()).toEqual([{ name: 'Claude Code', status: 'Inactivo' }]);
  });
});

describe('SettingsScreen: Notifications', () => {
  const openNotifications = async (options: Parameters<typeof setup>[0] = {}) => {
    const screen = await setup(options);
    screen.section('Notificaciones').click();
    await screen.settle();
    const channelRows = () =>
      Array.from(screen.el.querySelectorAll<HTMLElement>('[data-testid="channel-row"]')).map((row) => ({
        name: row.querySelector('.name')?.textContent?.trim(),
        on: row.querySelector('[role="switch"]')?.getAttribute('aria-checked'),
        types: Array.from(row.querySelectorAll<HTMLButtonElement>('[aria-pressed="true"]')).map((button) => button.textContent?.trim()),
      }));
    const type = (name: string) => Array.from(screen.el.querySelectorAll<HTMLButtonElement>('[aria-pressed]')).find((b) => b.textContent?.trim() === name)!;
    return { ...screen, channelRows, type };
  };

  it('shows one row for the toast Channel, on for Waiting, Done and Error by default', async () => {
    const { channelRows, byLabel } = await openNotifications();
    expect(channelRows()).toEqual([{ name: 'Avisos en la app', on: 'true', types: ['Esperando', 'Terminado', 'Con error'] }]);
    expect(byLabel('Avisar con Avisos en la app')).not.toBeNull();
  });

  it('switches the Channel off, which main stores, and on again', async () => {
    const { channelRows, byLabel, stored, settle } = await openNotifications();
    byLabel('Avisar con Avisos en la app')!.click();
    await settle();
    expect(Effect.runSync(Ref.get(stored)).channels.Toast.enabled).toBe(false);
    expect(channelRows()[0].on).toBe('false');
    byLabel('Avisar con Avisos en la app')!.click();
    await settle();
    expect(channelRows()[0].on).toBe('true');
  });

  it('switches one type off and keeps the others', async () => {
    const { channelRows, type, stored, settle } = await openNotifications();
    type('Terminado').click();
    await settle();
    expect(Effect.runSync(Ref.get(stored)).channels.Toast.types).toEqual(['Waiting', 'Error']);
    expect(channelRows()[0].types).toEqual(['Esperando', 'Con error']);
  });

  it('shows what was stored', async () => {
    const { channelRows } = await openNotifications({ stored: { ...defaultSettings, channels: { Toast: { enabled: false, types: ['Error'] } } } });
    expect(channelRows()).toEqual([{ name: 'Avisos en la app', on: 'false', types: ['Con error'] }]);
  });

  it('leaves the Channel as it was and says so when storing fails', async () => {
    const { channelRows, byLabel, settle } = await openNotifications({ failSave: true });
    byLabel('Avisar con Avisos en la app')!.click();
    await settle();
    expect(channelRows()[0].on).toBe('true');
    expect(TestBed.inject(ToastService).toasts().map((toast) => [toast.tone, toast.body])).toEqual([['error', 'settings.notifications.saveFailed']]);
  });

  it('says the settings could not be read, instead of showing Channels that are not known', async () => {
    const { el, channelRows } = await openNotifications({ failLoad: true });
    expect(el.querySelector('[role="alert"]')?.textContent).toContain('No se pudieron leer los ajustes');
    expect(channelRows()).toEqual([]);
  });
});
