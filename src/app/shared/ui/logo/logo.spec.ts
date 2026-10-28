import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { LogoComponent } from './logo';

@Component({
  imports: [LogoComponent],
  template: `<ui-logo [size]="size" [label]="label" [mono]="mono" />`,
})
class Host {
  size = 32;
  label = 'Timmy';
  mono = false;
}

describe('LogoComponent', () => {
  async function render(patch: Partial<Host> = {}) {
    await TestBed.configureTestingModule({ imports: [Host] }).compileComponents();
    const fixture = TestBed.createComponent(Host);
    Object.assign(fixture.componentInstance, patch);
    await fixture.whenStable();
    return fixture.nativeElement.querySelector('ui-logo') as HTMLElement;
  }

  it('renders the flat character at 32', async () => {
    const el = await render({ size: 32 });
    expect(el.querySelectorAll('rect').length).toBe(2);
  });

  it('renders the geometric mark at 28', async () => {
    const el = await render({ size: 28 });
    expect(el.querySelectorAll('rect').length).toBe(0);
    expect(el.querySelector('path')?.getAttribute('fill-rule')).toBe('evenodd');
  });

  it('sets size and aria-label', async () => {
    const el = await render({ size: 16, label: 'Logo' });
    const svg = el.querySelector('svg')!;
    expect(svg.getAttribute('width')).toBe('16');
    expect(svg.getAttribute('aria-label')).toBe('Logo');
    expect(svg.getAttribute('role')).toBe('img');
  });

  it('uses text-on-color when mono', async () => {
    const el = await render({ mono: true });
    expect(el.style.color).toContain('--text-on-color');
  });
});
