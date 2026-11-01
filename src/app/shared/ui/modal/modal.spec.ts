import { Component, signal } from '@angular/core';
import { ApplicationRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ModalComponent } from './modal';

@Component({
  imports: [ModalComponent],
  template: `
    <button id="opener" type="button">open</button>
    @if (open()) {
      <ui-modal heading="Send without text?" primaryLabel="Send anyway" closeLabel="Close" (primary)="primaries = primaries + 1" (closed)="closes = closes + 1">
        Your message has only images.
      </ui-modal>
    }
  `,
})
class Host {
  open = signal(false);
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
    const f = await open();
    expect(document.activeElement?.textContent?.trim()).toBe('Send anyway');
  });

  it('emits primary from the primary button', async () => {
    const f = await open();
    el(f, '.actions button').click();
    expect(f.componentInstance.primaries).toBe(1);
    expect(f.componentInstance.closes).toBe(0);
  });

  it('closes from the close button, the backdrop and Esc', async () => {
    const f = await open();
    el(f, '.close').click();
    el(f, '.backdrop').click();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(f.componentInstance.closes).toBe(3);
    expect(f.componentInstance.primaries).toBe(0);
  });

  it('keeps Tab inside the dialog', async () => {
    const f = await open();
    const close = el(f, '.close');
    const primary = el(f, '.actions button');
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
