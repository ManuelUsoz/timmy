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
import { SettingsDialog } from './settings-dialog';
import { SettingsDialogState, type SettingsSection } from './settings-dialog-state';

interface SetupOptions {
  readonly stored?: Settings;
  readonly failSave?: boolean;
  readonly failLoad?: boolean;
  readonly slowFirstSave?: boolean;
  readonly hooks?: ReadonlyArray<HookStatus>;
  readonly failHooksLoad?: boolean;
  readonly hooksError?: HooksError;
  /** The section Settings was left on, so it opens there. */
  readonly section?: SettingsSection;
}

/** The real client against a main whose settings are a Ref. `failSave` makes storing a Provider die; `failLoad` makes reading die. */
const setup = async (options: SetupOptions = {}) => {
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
    'Settings.setReader': () => Effect.die('unused'),
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
  const state = TestBed.inject(SettingsDialogState);
  if (options.section) state.section.set(options.section);
  state.toggle();
  const fixture = TestBed.createComponent(SettingsDialog);
  const el: HTMLElement = fixture.nativeElement;
  const settle = async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
    fixture.detectChanges();
    await fixture.whenStable();
  };
  fixture.detectChanges();
  await settle();
  const byLabel = (label: string) => el.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
  const navButtons = () => Array.from(el.querySelectorAll<HTMLButtonElement>('nav button'));
  const section = (name: string) => navButtons().find((b) => b.querySelector('.label')?.textContent?.trim() === name)!;
  const go = async (name: string) => {
    section(name).click();
    await settle();
    // Opening Agents reads the Hooks; their answer needs one more round.
    await settle();
  };
  const heading = () => el.querySelector('.header h2')?.textContent?.trim();
  const cards = () =>
    Array.from(el.querySelectorAll<HTMLElement>('[data-testid="provider-card"]')).map((card) => ({
      name: card.querySelector('.name')?.textContent?.trim(),
      status: card.querySelector('.status')?.textContent?.trim(),
    }));
  const hookRows = () =>
    Array.from(el.querySelectorAll<HTMLElement>('[data-testid="provider-card"]')).flatMap((card) => {
      const row = card.querySelector('[data-testid="hook-row"]');
      return row === null ? [] : [{ name: card.querySelector('.name')?.textContent?.trim(), on: row.querySelector('[role="switch"]')?.getAttribute('aria-checked') }];
    });
  return { el, fixture, state, stored, hooks, settle, byLabel, navButtons, section, go, heading, cards, hookRows, providers: TestBed.inject(ProviderSettings) };
};

describe('SettingsDialog: the dialog', () => {
  it('is a modal dialog named Ajustes that opens on General', async () => {
    const { el, heading, section } = await setup();
    const dialog = el.querySelector('[role="dialog"]')!;
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.getAttribute('aria-label')).toBe('Ajustes');
    expect(el.querySelector('nav')?.getAttribute('aria-label')).toBe('Secciones de ajustes');
    expect(heading()).toBe('General');
    expect(section('General').getAttribute('aria-current')).toBe('page');
    expect(el.querySelector('.footer')?.textContent).toContain('Los cambios se guardan solos');
  });

  it('moves the focus into the dialog', async () => {
    const { el } = await setup();
    expect(el.querySelector('[role="dialog"]')!.contains(document.activeElement)).toBe(true);
  });

  it('closes with Esc', async () => {
    const { state } = await setup();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(state.open()).toBe(false);
  });

  it('closes with the cross', async () => {
    const { state, byLabel } = await setup();
    byLabel('Cerrar ajustes (Esc)')!.click();
    expect(state.open()).toBe(false);
  });

  it('closes with a click on the backdrop', async () => {
    const { el, state } = await setup();
    el.querySelector<HTMLElement>('.backdrop')!.click();
    expect(state.open()).toBe(false);
  });

  it('lists the sections in order and marks the current one, which the state remembers', async () => {
    const { navButtons, section, go, heading, state } = await setup();
    expect(navButtons().map((b) => b.querySelector('.label')?.textContent?.trim())).toEqual([
      'General',
      'Apariencia',
      'Atajos',
      'Agentes y proveedores',
      'Notificaciones',
      'Permisos',
      'Terminal',
      'Proyectos',
      'Integraciones',
      'Consumo y límites',
    ]);
    await go('Notificaciones');
    expect(section('Notificaciones').getAttribute('aria-current')).toBe('page');
    expect(section('General').hasAttribute('aria-current')).toBe(false);
    expect(heading()).toBe('Notificaciones');
    expect(state.section()).toBe('notifications');
  });

  it('opens on the section it was left on', async () => {
    const { heading, section } = await setup({ section: 'shortcuts' });
    expect(heading()).toBe('Atajos');
    expect(section('Atajos').getAttribute('aria-current')).toBe('page');
  });

  it('tags the sections that have no settings yet, and says so when one is opened', async () => {
    const { el, section, go, heading } = await setup();
    const soon = (name: string) => section(name).querySelector('ui-tag')?.textContent?.trim();
    expect(soon('Apariencia')).toBe('Pronto');
    expect(soon('Consumo y límites')).toBe('Pronto');
    expect(soon('Atajos')).toBeUndefined();
    expect(soon('Agentes y proveedores')).toBeUndefined();
    await go('Apariencia');
    expect(heading()).toBe('Apariencia');
    expect(el.querySelector('.subtitle')?.textContent).toContain('Tema, colores y tipografía.');
    expect(el.querySelector('[data-testid="coming-soon"]')?.textContent).toContain('Próximamente');
    await go('General');
    expect(el.querySelector('[data-testid="coming-soon"]')).toBeNull();
  });
});

describe('SettingsDialog: General', () => {
  it('picks the language from a radio group and stores it', async () => {
    const { el, stored, settle } = await setup();
    expect(el.querySelector('[role="radiogroup"]')?.getAttribute('aria-label')).toBe('Idioma');
    const radio = (name: string) => Array.from(el.querySelectorAll<HTMLButtonElement>('[role="radio"]')).find((b) => b.textContent?.trim() === name)!;
    expect(radio('Español').getAttribute('aria-checked')).toBe('true');
    radio('English').click();
    await settle();
    expect(Effect.runSync(Ref.get(stored)).language).toBe('en');
    expect(radio('English').getAttribute('aria-checked')).toBe('true');
    expect(radio('Español').getAttribute('aria-checked')).toBe('false');
  });
});

describe('SettingsDialog: Shortcuts', () => {
  it('lists every shortcut with its keys', async () => {
    const { el } = await setup({ section: 'shortcuts' });
    const groups = Array.from(el.querySelectorAll<HTMLElement>('section.group')).map((group) => ({
      title: group.querySelector('h3')?.textContent?.trim(),
      rows: Array.from(group.querySelectorAll<HTMLElement>('[data-testid="shortcut-row"]')).map((row) => ({
        action: row.querySelector('.action-text')?.textContent?.trim(),
        keys: Array.from(row.querySelectorAll('kbd')).map((kbd) => kbd.textContent?.trim()),
      })),
    }));
    expect(groups).toEqual([
      {
        title: 'Workspace',
        rows: [
          { action: 'Colapsar o expandir la barra lateral', keys: ['Ctrl', 'B'] },
          { action: 'Abrir o cerrar Ajustes', keys: ['Ctrl', ','] },
          { action: 'Nueva pestaña', keys: ['Ctrl', 'T'] },
          { action: 'Buscar un archivo del proyecto', keys: ['Ctrl', 'P'] },
          { action: 'Ir a la pestaña con ese número', keys: ['Ctrl', '1–9'] },
          { action: 'Cambiar de pestaña o proyecto (soltar Ctrl confirma)', keys: ['Ctrl', 'Tab'] },
          { action: 'Cerrar Ajustes o un diálogo', keys: ['Esc'] },
        ],
      },
      {
        title: 'Paneles y pilas',
        rows: [
          { action: 'Dividir el panel a la derecha', keys: ['Alt', 'Shift', 'R'] },
          { action: 'Dividir el panel hacia abajo', keys: ['Alt', 'Shift', 'D'] },
          { action: 'Añadir una terminal a la pila', keys: ['Alt', 'Shift', 'S'] },
          { action: 'Mostrar la terminal de la pila en esa posición', keys: ['Alt', '1–3'] },
          { action: 'Subir la terminal en la pila', keys: ['Alt', 'Shift', '↑'] },
          { action: 'Bajar la terminal en la pila', keys: ['Alt', 'Shift', '↓'] },
          { action: 'Sacar la terminal de la pila a un panel nuevo', keys: ['Alt', 'Shift', '⏎'] },
        ],
      },
    ]);
  });
});

describe('SettingsDialog: Agents and providers', () => {
  const openAgents = async (options: SetupOptions = {}) => {
    const dialog = await setup(options);
    await dialog.go('Agentes y proveedores');
    return dialog;
  };
  const claude = (active: boolean, enabled = true): HookStatus => ({ provider: 'ClaudeCode', enabled, active });
  const onlyClaude: Settings = { ...defaultSettings, language: 'es', providers: ['ClaudeCode'] };

  it('lists the three Providers, none enabled until the user picks', async () => {
    const { cards, heading } = await openAgents();
    expect(heading()).toBe('Agentes y proveedores');
    expect(cards()).toEqual([
      { name: 'OpenCode', status: 'Desactivado' },
      { name: 'Claude Code', status: 'Desactivado' },
      { name: 'Codex', status: 'Desactivado' },
    ]);
  });

  it('shows the Providers that were stored as enabled', async () => {
    const { cards, byLabel } = await openAgents({ stored: onlyClaude });
    expect(cards().map((r) => r.status)).toEqual(['Desactivado', 'Activado', 'Desactivado']);
    expect(byLabel('Desactivar Claude Code')).not.toBeNull();
    expect(byLabel('Activar OpenCode')).not.toBeNull();
  });

  it('enables a Provider, stores it in main and offers to disable it', async () => {
    const { cards, byLabel, stored, settle } = await openAgents();
    byLabel('Activar Codex')!.click();
    await settle();
    expect(Effect.runSync(Ref.get(stored)).providers).toEqual(['Codex']);
    expect(cards().map((r) => r.status)).toEqual(['Desactivado', 'Desactivado', 'Activado']);
    expect(byLabel('Desactivar Codex')).not.toBeNull();
  });

  it('disables a Provider again', async () => {
    const { cards, byLabel, stored, settle } = await openAgents({ stored: { ...defaultSettings, language: 'es', providers: ['OpenCode', 'Codex'] } });
    byLabel('Desactivar OpenCode')!.click();
    await settle();
    expect(Effect.runSync(Ref.get(stored)).providers).toEqual(['Codex']);
    expect(cards().map((r) => r.status)).toEqual(['Desactivado', 'Desactivado', 'Activado']);
  });

  it('leaves the Provider as it was and says so when storing fails', async () => {
    const { cards, byLabel, settle } = await openAgents({ failSave: true });
    byLabel('Activar OpenCode')!.click();
    await settle();
    expect(cards()[0]).toEqual({ name: 'OpenCode', status: 'Desactivado' });
    expect(TestBed.inject(ToastService).toasts().map((toast) => [toast.tone, toast.body])).toEqual([['error', 'settings.providers.saveFailed']]);
  });

  it('says the settings could not be read, instead of showing Providers that are not known', async () => {
    const { el, cards } = await openAgents({ failLoad: true });
    expect(el.querySelector('[role="alert"]')?.textContent).toContain('No se pudieron leer los ajustes');
    expect(cards()).toEqual([]);
  });

  it('shows what main holds when two quick changes are answered out of order', async () => {
    const { byLabel, cards, providers, settle } = await openAgents({ slowFirstSave: true });
    byLabel('Activar OpenCode')!.click();
    byLabel('Activar Codex')!.click();
    await new Promise((resolve) => setTimeout(resolve, 150));
    await settle();
    expect(providers.enabled()).toEqual(['OpenCode', 'Codex']);
    expect(cards().map((r) => r.status)).toEqual(['Activado', 'Desactivado', 'Activado']);
  });

  it('makes the enabled Providers available to the rest of the app', async () => {
    const { byLabel, providers, settle } = await openAgents({ stored: { ...defaultSettings, language: 'es', providers: ['OpenCode'] } });
    expect(providers.enabled()).toEqual(['OpenCode']);
    byLabel('Activar Codex')!.click();
    await settle();
    expect(providers.enabled()).toEqual(['OpenCode', 'Codex']);
  });

  it('unfolds the Hook switch of an enabled Provider, off while the Hook is inactive', async () => {
    const { el, hookRows } = await openAgents({ stored: onlyClaude, hooks: [claude(false)] });
    expect(hookRows()).toEqual([{ name: 'Claude Code', on: 'false' }]);
    expect(el.querySelector('[data-testid="hook-row"]')?.textContent).toContain('Cuenta a Timmy qué está haciendo el agente.');
  });

  it('shows no Hook switch for a disabled Provider', async () => {
    const { hookRows } = await openAgents({ hooks: [claude(false, false)] });
    expect(hookRows()).toEqual([]);
  });

  it('still shows the switch of a disabled Provider whose Hook is active, so it can be turned off', async () => {
    const { hookRows } = await openAgents({ hooks: [claude(true, false)] });
    expect(hookRows()).toEqual([{ name: 'Claude Code', on: 'true' }]);
  });

  it('says an enabled Provider has no Hook yet', async () => {
    const { el, hookRows } = await openAgents({ stored: { ...defaultSettings, language: 'es', providers: ['OpenCode'] }, hooks: [] });
    expect(hookRows()).toEqual([]);
    const notes = Array.from(el.querySelectorAll('[data-testid="no-hook"]'));
    expect(notes.map((note) => note.closest('[data-testid="provider-card"]')?.querySelector('.name')?.textContent?.trim())).toEqual(['OpenCode']);
    expect(notes[0].textContent).toContain('Este proveedor aún no tiene Hook.');
  });

  it('activates the Hook, which main stores', async () => {
    const { hookRows, byLabel, hooks, settle } = await openAgents({ stored: onlyClaude, hooks: [claude(false)] });
    byLabel('Hook de Claude Code')!.click();
    await settle();
    expect(Effect.runSync(Ref.get(hooks))).toEqual([claude(true)]);
    expect(hookRows()).toEqual([{ name: 'Claude Code', on: 'true' }]);
  });

  it('deactivates it again', async () => {
    const { hookRows, byLabel, settle } = await openAgents({ stored: onlyClaude, hooks: [claude(true)] });
    byLabel('Hook de Claude Code')!.click();
    await settle();
    expect(hookRows()).toEqual([{ name: 'Claude Code', on: 'false' }]);
  });

  it('says the Hooks could not be read, instead of a switch', async () => {
    const { el, hookRows } = await openAgents({ stored: onlyClaude, failHooksLoad: true });
    expect(el.querySelector('[role="alert"]')?.textContent).toContain('No se pudieron leer los Hooks');
    expect(hookRows()).toEqual([]);
  });

  it('leaves the Hook as it was and says so when main refuses', async () => {
    const hooksError = new HooksError({ reason: 'ConfigUnreadable', detail: 'settings.json is not valid JSON' });
    const { hookRows, byLabel, settle } = await openAgents({ stored: onlyClaude, hooks: [claude(false)], hooksError });
    byLabel('Hook de Claude Code')!.click();
    await settle();
    expect(hookRows()).toEqual([{ name: 'Claude Code', on: 'false' }]);
    expect(TestBed.inject(ToastService).toasts().map((toast) => [toast.tone, toast.body])).toEqual([['error', 'settings.hooks.saveFailed']]);
  });

  it('reads the Hooks again each time the section is opened', async () => {
    const { hooks, go, hookRows } = await openAgents({ stored: onlyClaude, hooks: [] });
    expect(hookRows()).toEqual([]);
    Effect.runSync(Ref.set(hooks, [claude(false)]));
    await go('General');
    await go('Agentes y proveedores');
    expect(hookRows()).toEqual([{ name: 'Claude Code', on: 'false' }]);
  });

  it('reads the Hooks again when a Provider is enabled, so its Hook shows up', async () => {
    const { hooks, byLabel, settle, hookRows } = await openAgents({ hooks: [] });
    Effect.runSync(Ref.set(hooks, [claude(false)]));
    byLabel('Activar Claude Code')!.click();
    await settle();
    await settle();
    expect(hookRows()).toEqual([{ name: 'Claude Code', on: 'false' }]);
  });
});

describe('SettingsDialog: Notifications', () => {
  const openNotifications = async (options: SetupOptions = {}) => {
    const dialog = await setup(options);
    await dialog.go('Notificaciones');
    const channelRows = () =>
      Array.from(dialog.el.querySelectorAll<HTMLElement>('[data-testid="channel-row"]')).map((row) => ({
        name: row.querySelector('.name')?.textContent?.trim(),
        on: row.querySelector('[role="switch"]')?.getAttribute('aria-checked'),
        types: Array.from(row.querySelectorAll<HTMLButtonElement>('[aria-pressed="true"]')).map((button) => button.textContent?.trim()),
      }));
    const type = (name: string) => Array.from(dialog.el.querySelectorAll<HTMLButtonElement>('[aria-pressed]')).find((b) => b.textContent?.trim() === name)!;
    return { ...dialog, channelRows, type };
  };

  it('shows one row for the toast Channel, on for Waiting, Done and Error by default', async () => {
    const { channelRows, byLabel, el } = await openNotifications();
    expect(el.querySelector('.subtitle')?.textContent).toContain('Cómo te avisa Timmy');
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
