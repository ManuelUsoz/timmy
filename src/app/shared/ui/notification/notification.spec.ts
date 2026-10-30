import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { EffectRuntime } from '../../../core/effect-runtime';
import { I18n } from '../../../core/i18n';
import { NotificationComponent, NotificationTone } from './notification';

@Component({
  imports: [NotificationComponent],
  template: `<ui-notification [tone]="tone" [title]="title" [dismissible]="dismissible" (dismissed)="dismissals = dismissals + 1">
    Body text
  </ui-notification>`,
})
class Host {
  tone: NotificationTone = 'info';
  title = 'Info';
  dismissible = true;
  dismissals = 0;
}

describe('NotificationComponent', () => {
  async function render(setup: (host: Host) => void = () => undefined) {
    await TestBed.configureTestingModule({
      imports: [Host],
      // Nothing here talks to main: the language stays at its default.
      providers: [{ provide: EffectRuntime, useValue: { run: () => new Promise(() => undefined) } }],
    }).compileComponents();
    const fixture = TestBed.createComponent(Host);
    setup(fixture.componentInstance);
    await fixture.whenStable();
    const el = fixture.nativeElement.querySelector('ui-notification') as HTMLElement;
    return { fixture, el };
  }

  it('shows the dot, the title word and the projected body', async () => {
    const { el } = await render();
    expect(el.classList).toContain('as-note');
    expect(el.querySelector('.as-note__ico')?.getAttribute('aria-hidden')).toBe('true');
    expect(el.querySelector('.as-note__title')?.textContent).toBe('Info');
    expect(el.querySelector('.as-note__body')?.textContent).toContain('Body text');
  });

  it.each(['success', 'info', 'warning', 'error'] as const)('sets --tone to the %s support colour', async (tone) => {
    const { el } = await render((host) => (host.tone = tone));
    expect(el.style.getPropertyValue('--tone')).toBe(`var(--support-${tone})`);
  });

  it('has a dismiss button named from the dictionary, in the current language', async () => {
    const { el, fixture } = await render();
    const button = () => el.querySelector('button')!;
    expect(button().getAttribute('aria-label')).toBe('Cerrar notificación');
    TestBed.inject(I18n).language.set('en');
    await fixture.whenStable();
    expect(button().getAttribute('aria-label')).toBe('Dismiss notification');
  });

  it('emits dismissed when the button is pressed', async () => {
    const { el, fixture } = await render();
    el.querySelector('button')!.click();
    expect(fixture.componentInstance.dismissals).toBe(1);
  });

  it('has no button when it is not dismissible', async () => {
    const { el } = await render((host) => (host.dismissible = false));
    expect(el.querySelector('button')).toBeNull();
  });
});
