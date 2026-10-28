import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ChipComponent, ChipSize, ChipTone } from './chip';

@Component({
  imports: [ChipComponent],
  template: `
    <ui-chip
      [tone]="tone"
      [size]="size"
      [selectable]="selectable"
      [(selected)]="selected"
      [removable]="removable"
      removeLabel="Drop"
      (removed)="removedCount = removedCount + 1"
      >Label</ui-chip
    >
  `,
})
class Host {
  tone: ChipTone | undefined = undefined;
  size: ChipSize = 'default';
  selectable = false;
  selected = false;
  removable = false;
  removedCount = 0;
}

describe('ChipComponent', () => {
  async function render(patch: Partial<Host> = {}) {
    await TestBed.configureTestingModule({ imports: [Host] }).compileComponents();
    const fixture = TestBed.createComponent(Host);
    Object.assign(fixture.componentInstance, patch);
    await fixture.whenStable();
    const el = fixture.nativeElement.querySelector('ui-chip') as HTMLElement;
    return { fixture, el };
  }

  it('applies tone and size classes', async () => {
    const { el } = await render({ tone: 'blue', size: 'md' });
    expect(el.classList).toContain('as-chip--blue');
    expect(el.classList).toContain('as-chip--md');
  });

  it('is not a button unless selectable', async () => {
    const { el } = await render();
    expect(el.getAttribute('role')).toBeNull();
    expect(el.getAttribute('aria-pressed')).toBeNull();
  });

  it('toggles aria-pressed on click', async () => {
    const { fixture, el } = await render({ selectable: true });
    expect(el.getAttribute('role')).toBe('button');
    expect(el.getAttribute('tabindex')).toBe('0');
    expect(el.getAttribute('aria-pressed')).toBe('false');
    el.click();
    await fixture.whenStable();
    expect(el.getAttribute('aria-pressed')).toBe('true');
    expect(fixture.componentInstance.selected).toBe(true);
  });

  it('toggles on Space and Enter', async () => {
    const { fixture, el } = await render({ selectable: true });
    el.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
    await fixture.whenStable();
    expect(el.getAttribute('aria-pressed')).toBe('true');
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await fixture.whenStable();
    expect(el.getAttribute('aria-pressed')).toBe('false');
  });

  it('emits removed from a labelled button without toggling', async () => {
    const { fixture, el } = await render({ removable: true, selectable: true });
    const x = el.querySelector('button.as-chip__x') as HTMLButtonElement;
    expect(x.getAttribute('aria-label')).toBe('Drop');
    x.click();
    await fixture.whenStable();
    expect(fixture.componentInstance.removedCount).toBe(1);
    expect(fixture.componentInstance.selected).toBe(false);
  });
});
