import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ButtonComponent, ButtonKind, ButtonSize } from './button';

@Component({
  imports: [ButtonComponent],
  template: `
    <button uiButton [kind]="kind" [size]="size" [iconOnly]="iconOnly" [disabled]="disabled" aria-label="x">
      Go
    </button>
  `,
})
class Host {
  kind: ButtonKind = 'primary';
  size: ButtonSize = 'md';
  iconOnly = false;
  disabled = false;
}

describe('ButtonComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [Host] }).compileComponents();
  });

  async function render(patch: Partial<Host> = {}) {
    const fixture = TestBed.createComponent(Host);
    Object.assign(fixture.componentInstance, patch);
    await fixture.whenStable();
    return fixture.nativeElement.querySelector('button') as HTMLButtonElement;
  }

  it('defaults to primary md', async () => {
    const btn = await render();
    expect(btn.classList).toContain('as-btn');
    expect(btn.classList).toContain('as-btn--primary');
    expect(btn.classList).not.toContain('as-btn--sm');
    expect(btn.classList).not.toContain('as-btn--lg');
  });

  it('renders each kind class', async () => {
    for (const kind of ['primary', 'secondary', 'tertiary', 'ghost', 'danger'] as const) {
      const btn = await render({ kind });
      expect(btn.classList).toContain(`as-btn--${kind}`);
    }
  });

  it('renders size classes', async () => {
    expect((await render({ size: 'sm' })).classList).toContain('as-btn--sm');
    expect((await render({ size: 'lg' })).classList).toContain('as-btn--lg');
  });

  it('applies the icon class', async () => {
    expect((await render({ iconOnly: true })).classList).toContain('as-btn--icon');
  });

  it('keeps the native disabled attribute', async () => {
    expect((await render({ disabled: true })).disabled).toBe(true);
  });
});
