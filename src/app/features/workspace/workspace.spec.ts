import { TestBed } from '@angular/core/testing';
import { Effect, Layer, Ref } from 'effect';
import { AppInfoRpcs } from '../../../shared/app-info/app-info.rpc';
import type { Language } from '../../../shared/settings/settings.model';
import { SettingsRpcs } from '../../../shared/settings/settings.rpc';
import { layerChatUnused, layerSessionsUnused, layerWindowUnused, makeDesktopTestLayer } from '../../core/desktop-layers';
import { EffectRuntime } from '../../core/effect-runtime';
import { WorkspaceComponent } from './workspace';
import { WorkspaceLayoutState } from './workspace-layout';
import { provideWorkspaceRouter } from './workspace.routes';

const setup = async (width = 1400) => {
  const stored = Ref.makeUnsafe<Language>('es');
  const handlers = Layer.mergeAll(
    SettingsRpcs.toLayer({
      'Settings.get': () => Effect.map(Ref.get(stored), (language) => ({ language })),
      'Settings.setLanguage': ({ language }) => Ref.set(stored, language).pipe(Effect.as({ language })),
    }),
    AppInfoRpcs.toLayer({ 'AppInfo.get': () => Effect.die('unused') }),
    layerChatUnused,
    layerSessionsUnused,
    layerWindowUnused,
  );
  const layer = makeDesktopTestLayer(handlers);
  await TestBed.configureTestingModule({
    imports: [WorkspaceComponent],
    providers: [
      provideWorkspaceRouter(),
      {
        provide: EffectRuntime,
        useValue: { run: (e: Effect.Effect<unknown, unknown, never>) => Effect.runPromiseExit(Effect.provide(e as never, layer)) },
      },
    ],
  }).compileComponents();
  const layoutState = TestBed.inject(WorkspaceLayoutState);
  layoutState.width.set(width);
  const fixture = TestBed.createComponent(WorkspaceComponent);
  const el = fixture.nativeElement as HTMLElement;
  const settle = async () => {
    await fixture.whenStable();
    await new Promise((r) => setTimeout(r));
    fixture.detectChanges();
    await fixture.whenStable();
  };
  fixture.detectChanges();
  await settle();
  const rail = (name: string) => el.querySelector<HTMLAnchorElement>(`nav a[aria-label="${name}"]`)!;
  const go = async (name: string) => {
    rail(name).click();
    await settle();
  };
  return { el, settle, go, rail, layoutState, stored };
};

describe('WorkspaceComponent', () => {
  it('enters on Projects, with the rail of the four areas', async () => {
    const { el, rail } = await setup();
    expect(Array.from(el.querySelectorAll('nav a')).map((a) => a.getAttribute('aria-label'))).toEqual([
      'Chat',
      'Proyectos',
      'Historial',
      'Ajustes',
    ]);
    expect(el.querySelector('app-projects-screen')).not.toBeNull();
    expect(rail('Proyectos').getAttribute('aria-current')).toBe('page');
  });

  it.each([
    ['Chat', 'Chat'],
    ['Historial', 'Historial'],
  ])('shows %s as a "Próximamente" screen', async (name, title) => {
    const { el, go } = await setup();
    await go(name);
    expect(el.querySelector('app-coming-soon-screen')?.textContent).toContain(title);
    expect(el.querySelector('app-coming-soon-screen')?.textContent).toContain('Próximamente');
  });

  it('navigates between the four areas with the rail', async () => {
    const { el, go } = await setup();
    await go('Ajustes');
    expect(el.querySelector('app-settings-screen')).not.toBeNull();
    await go('Proyectos');
    expect(el.querySelector('app-projects-screen')).not.toBeNull();
    expect(el.querySelector('app-settings-screen')).toBeNull();
  });

  it('changes the language from Settings, at once, for the whole Workspace, and stores it', async () => {
    const { el, go, settle, rail, stored } = await setup();
    await go('Ajustes');
    const english = Array.from(el.querySelectorAll<HTMLButtonElement>('ui-switcher button')).find((b) => b.textContent?.trim() === 'English')!;
    english.click();
    await settle();
    expect(rail('Projects')).not.toBeNull();
    expect(el.querySelector('app-settings-screen h1')?.textContent).toBe('Settings');
    expect(Effect.runSync(Ref.get(stored))).toBe('en');
    await go('Chat');
    expect(el.querySelector('app-coming-soon-screen')?.textContent).toContain('Coming soon');
  });

  describe('Projects column', () => {
    const toggle = (el: HTMLElement) => el.querySelector<HTMLButtonElement>('.projects .icon-button')!;

    it('has three columns from xl', async () => {
      const { el } = await setup(1400);
      expect(el.querySelector('.projects.collapsed')).toBeNull();
      expect(el.querySelector('.content:not(.overlay)')).not.toBeNull();
      expect(toggle(el).getAttribute('aria-expanded')).toBe('true');
    });

    it('collapses to the rail between lg and xl', async () => {
      const { el } = await setup(1100);
      expect(el.querySelector('.projects.collapsed')).not.toBeNull();
      expect(el.querySelector('.content:not(.overlay)')).not.toBeNull();
    });

    it('moves the content to an overlay below lg, opened on demand', async () => {
      const { el, settle } = await setup(900);
      expect(el.querySelector('.content')).toBeNull();
      el.querySelector<HTMLButtonElement>('.content-toggle')!.click();
      await settle();
      expect(el.querySelector('.content.overlay')).not.toBeNull();
    });

    it('follows the window as it is resized, until the user collapses it by hand', async () => {
      const { el, settle, layoutState } = await setup(1400);
      layoutState.width.set(1100);
      await settle();
      expect(el.querySelector('.projects.collapsed')).not.toBeNull();
      layoutState.width.set(1400);
      await settle();
      toggle(el).click();
      await settle();
      expect(el.querySelector('.projects.collapsed')).not.toBeNull();
      layoutState.width.set(1500);
      await settle();
      expect(el.querySelector('.projects.collapsed')).not.toBeNull();
      expect(toggle(el).getAttribute('aria-expanded')).toBe('false');
    });
  });
});
