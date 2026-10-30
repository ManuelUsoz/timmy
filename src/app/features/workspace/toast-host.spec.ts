import { TestBed } from '@angular/core/testing';
import { EffectRuntime } from '../../core/effect-runtime';
import { I18n } from '../../core/i18n';
import { ToastService } from '../../core/toast';
import { ToastHost } from './toast-host';

describe('ToastHost', () => {
  const setup = async () => {
    await TestBed.configureTestingModule({
      imports: [ToastHost],
      providers: [{ provide: EffectRuntime, useValue: { run: () => new Promise(() => undefined) } }],
    }).compileComponents();
    const fixture = TestBed.createComponent(ToastHost);
    const el = fixture.nativeElement as HTMLElement;
    const toasts = TestBed.inject(ToastService);
    const settle = async () => {
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();
    };
    const items = () => Array.from(el.querySelectorAll<HTMLElement>('.toast'));
    await settle();
    return { el, toasts, settle, items };
  };

  it('is a labelled region that is empty without toasts', async () => {
    const { el, items } = await setup();
    expect(el.querySelector('[role=region]')?.getAttribute('aria-label')).toBe('Notificaciones');
    expect(items()).toEqual([]);
  });

  it('shows the title word and the body of each toast, newest first', async () => {
    const { toasts, settle, items } = await setup();
    toasts.info('projects.removeFailed');
    toasts.warning('sessions.busy');
    await settle();
    expect(items().map((item) => item.querySelector('.as-note__title')?.textContent)).toEqual(['Aviso', 'Información']);
    expect(items()[0].textContent).toContain('Hay un turno en marcha');
  });

  it('announces errors assertively and the rest politely', async () => {
    const { toasts, settle, items } = await setup();
    toasts.error('sessions.loadFailed');
    toasts.success('projects.removeFailed');
    await settle();
    const [success, error] = items();
    expect([success.getAttribute('role'), success.getAttribute('aria-live')]).toEqual(['status', 'polite']);
    expect([error.getAttribute('role'), error.getAttribute('aria-live')]).toEqual(['alert', 'assertive']);
  });

  it('shows at most three, dropping the oldest', async () => {
    const { toasts, settle, items } = await setup();
    for (const body of ['projects.loadFailed', 'sessions.loadFailed', 'sessions.busy', 'projects.checkFailed'] as const) toasts.error(body);
    await settle();
    expect(items()).toHaveLength(3);
    expect(items().map((item) => item.textContent).join()).not.toContain('No se pudieron cargar los proyectos');
  });

  it('dismisses with its button and with Escape', async () => {
    const { toasts, settle, items, el } = await setup();
    toasts.info('projects.removeFailed', { durationMs: null });
    toasts.info('sessions.busy', { durationMs: null });
    await settle();
    el.querySelector<HTMLButtonElement>('.toast button')!.click();
    await settle();
    expect(toasts.toasts().map((toast) => toast.body)).toEqual(['projects.removeFailed']);
    items()[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await settle();
    expect(toasts.toasts()).toEqual([]);
    expect(items()).toEqual([]);
  });

  it('follows the language, and the detail is a tooltip, not the message', async () => {
    const { toasts, settle, items } = await setup();
    toasts.error('sessions.busy', { detail: 'raw cause' });
    await settle();
    expect(items()[0].querySelector('.as-note__body span')?.getAttribute('title')).toBe('raw cause');
    TestBed.inject(I18n).language.set('en');
    await settle();
    expect(items()[0].querySelector('.as-note__title')?.textContent).toBe('Error');
    expect(items()[0].textContent).toContain('A turn is running in another session');
    expect(items()[0].querySelector('button')?.getAttribute('aria-label')).toBe('Dismiss notification');
  });
});
