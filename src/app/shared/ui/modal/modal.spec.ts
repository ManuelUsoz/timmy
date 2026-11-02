import { Component, signal } from '@angular/core';
import { ApplicationRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ModalComponent } from './modal';

@Component({
  imports: [ModalComponent],
  template: `
    <button id="opener" type="button">open</button>
    @if (open()) {
      <ui-modal
        heading="Send without text?"
        primaryLabel="Send anyway"
        closeLabel="Close"
        stateLabel="Info"
        [tone]="tone()"
        [size]="size()"
        [primaryDisabled]="disabled()"
        (primary)="primaries = primaries + 1"
        (closed)="closes = closes + 1"
      >
        Your message has only images.
      </ui-modal>
    }
  `,
})
class Host {
  open = signal(false);
  tone = signal<'info' | 'error'>('info');
  size = signal<'md' | 'sm'>('md');
  disabled = signal(false);
  primaries = 0;
  closes = 0;
}

describe('ModalComponent', () => {
  async function open() {
    const fixture = TestBed.createComponent(Host);
    document.body.appendChild(fixture.nativeElement);
    await fixture.whenStable();
    fixture.nativeElement.querySelector('#opener').focus();
    fixture.componentInstance.open.set(true);
    TestBed.inject(ApplicationRef).tick();
    await fixture.whenStable();
    return fixture;
  }
  const el = (f: { nativeElement: HTMLElement }, sel: string) => f.nativeElement.querySelector<HTMLElement>(sel)!;

  it('is a labelled modal dialog showing its content', async () => {
    const f = await open();
    const dialog = el(f, '[role="dialog"]');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(el(f, `#${dialog.getAttribute('aria-labelledby')}`).textContent).toBe('Send without text?');
    expect(dialog.textContent).toContain('Your message has only images.');
  });

  it('focuses the primary button first', async () => {
    await open();
    expect(document.activeElement?.textContent?.trim()).toBe('Send anyway');
  });

  it('emits primary from the primary button', async () => {
    const f = await open();
    el(f, '.actions .primary').click();
    expect(f.componentInstance.primaries).toBe(1);
    expect(f.componentInstance.closes).toBe(0);
  });

  it('closes from the cross, the Close button, the backdrop and Esc', async () => {
    const f = await open();
    el(f, '.close').click();
    el(f, '.actions .dismiss').click();
    el(f, '.backdrop').click();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(f.componentInstance.closes).toBe(4);
    expect(f.componentInstance.primaries).toBe(0);
  });

  it('shows the state word and sets role, tone and size', async () => {
    const f = await open();
    expect(el(f, '.state').textContent?.trim()).toBe('Info');
    expect(el(f, '.dialog').getAttribute('role')).toBe('dialog');
    expect(el(f, '.dialog').classList).toContain('info');
    f.componentInstance.tone.set('error');
    f.componentInstance.size.set('sm');
    TestBed.inject(ApplicationRef).tick();
    expect(el(f, '.dialog').getAttribute('role')).toBe('alertdialog');
    expect(el(f, '.dialog').classList).toContain('error');
    expect(el(f, '.dialog').classList).toContain('sm');
  });

  it('disables the primary action without blocking Close', async () => {
    const f = await open();
    f.componentInstance.disabled.set(true);
    TestBed.inject(ApplicationRef).tick();
    expect(el(f, '.actions .primary').hasAttribute('disabled')).toBe(true);
    expect(el(f, '.actions .dismiss').hasAttribute('disabled')).toBe(false);
  });

  it('keeps Tab inside the dialog', async () => {
    const f = await open();
    const close = el(f, '.close');
    const primary = el(f, '.actions .primary');
    primary.focus();
    primary.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(close);
    close.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(primary);
  });

  it('returns focus to the opener when it goes away', async () => {
    const f = await open();
    f.componentInstance.open.set(false);
    await f.whenStable();
    expect(document.activeElement?.id).toBe('opener');
  });
});
