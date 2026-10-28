import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { SwitcherComponent } from './switcher';

@Component({
  imports: [SwitcherComponent, ReactiveFormsModule],
  template: `<ui-switcher [options]="options" [formControl]="ctl" [size]="size" [full]="full" />`,
})
class Host {
  options = [
    { value: 'a', label: 'A' },
    { value: 'b', label: 'B' },
    { value: 'c', label: 'C' },
  ];
  ctl = new FormControl<string | null>('a');
  size: 'default' | 'sm' = 'default';
  full = false;
}

describe('SwitcherComponent', () => {
  async function render(patch: Partial<Host> = {}) {
    await TestBed.configureTestingModule({ imports: [Host] }).compileComponents();
    const fixture = TestBed.createComponent(Host);
    Object.assign(fixture.componentInstance, patch);
    await fixture.whenStable();
    const tabs = () =>
      Array.from(fixture.nativeElement.querySelectorAll('button')) as HTMLButtonElement[];
    return { fixture, host: fixture.componentInstance, tabs };
  }

  it('reflects writeValue as aria-selected with roving tabindex', async () => {
    const { fixture, host, tabs } = await render();
    expect(tabs().map((t) => t.getAttribute('aria-selected'))).toEqual(['true', 'false', 'false']);
    host.ctl.setValue('b');
    await fixture.whenStable();
    expect(tabs().map((t) => t.getAttribute('aria-selected'))).toEqual(['false', 'true', 'false']);
    expect(tabs().map((t) => t.tabIndex)).toEqual([-1, 0, -1]);
  });

  it('click emits the value', async () => {
    const { host, tabs } = await render();
    tabs()[2].click();
    expect(host.ctl.value).toBe('c');
  });

  it('arrow keys and Home/End move and select', async () => {
    const { host, tabs } = await render();
    const press = (key: string, i: number) =>
      tabs()[i].dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
    press('ArrowRight', 0);
    expect(host.ctl.value).toBe('b');
    press('ArrowLeft', 1);
    expect(host.ctl.value).toBe('a');
    press('End', 0);
    expect(host.ctl.value).toBe('c');
    press('Home', 2);
    expect(host.ctl.value).toBe('a');
  });

  it('does not emit when disabled', async () => {
    const { fixture, host, tabs } = await render();
    host.ctl.disable();
    await fixture.whenStable();
    expect(tabs()[1].disabled).toBe(true);
    tabs()[1].click();
    expect(host.ctl.value).toBe('a');
  });

  it('applies size and full classes', async () => {
    const { fixture } = await render({ size: 'sm', full: true });
    const sw = fixture.nativeElement.querySelector('.as-switch') as HTMLElement;
    expect(sw.classList).toContain('as-switch--sm');
    expect(sw.classList).toContain('as-switch--full');
  });
});
