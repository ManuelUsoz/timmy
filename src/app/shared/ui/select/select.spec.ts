import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { SelectComponent } from './select';
import { SelectOption } from './select.types';

const OPTS: SelectOption<string>[] = [
  { value: 'a', label: 'Alpha' },
  { value: 'b', label: 'Beta', disabled: true },
  { value: 'c', label: 'Gamma' },
  { value: 'd', label: 'Delta' },
];

@Component({
  imports: [SelectComponent, ReactiveFormsModule],
  template: `<ui-select [formControl]="ctrl" [options]="opts" [multiple]="multiple" [display]="display" [placement]="placement" label="Pick" />`,
})
class Host {
  ctrl = new FormControl<unknown>(null);
  opts = OPTS;
  multiple = false;
  display: 'count' | 'chips' = 'count';
  placement: 'below' | 'above' = 'below';
}

describe('SelectComponent', () => {
  let fixture: ComponentFixture<Host>;
  let el: HTMLElement;

  async function setup(patch: Partial<Host> = {}) {
    await TestBed.configureTestingModule({ imports: [Host] }).compileComponents();
    fixture = TestBed.createComponent(Host);
    Object.assign(fixture.componentInstance, patch);
    await fixture.whenStable();
    el = fixture.nativeElement;
  }
  const trigger = () => el.querySelector('button.as-select__trigger') as HTMLButtonElement;
  const options = () => Array.from(el.querySelectorAll<HTMLElement>('.as-option'));
  const key = async (k: string) => {
    trigger().dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
    await fixture.whenStable();
  };
  const click = async (node: HTMLElement) => {
    node.click();
    await fixture.whenStable();
  };

  it('reflects writeValue', async () => {
    await setup();
    fixture.componentInstance.ctrl.setValue('c');
    await fixture.whenStable();
    expect(el.querySelector('.as-select__value')?.textContent?.trim()).toBe('Gamma');
  });

  it('click selects, calls onChange and closes', async () => {
    await setup();
    await click(trigger());
    expect(options().length).toBe(4);
    await click(options()[2]);
    expect(fixture.componentInstance.ctrl.value).toBe('c');
    expect(options().length).toBe(0);
  });

  it('opens below by default and above on request', async () => {
    await setup();
    await click(trigger());
    expect(el.querySelector('[role=listbox]')?.classList).not.toContain('as-menu--above');
    TestBed.resetTestingModule();
    await setup({ placement: 'above' });
    await click(trigger());
    expect(el.querySelector('[role=listbox]')?.classList).toContain('as-menu--above');
  });

  it('exposes aria attributes', async () => {
    await setup();
    expect(trigger().getAttribute('aria-haspopup')).toBe('listbox');
    expect(trigger().getAttribute('aria-expanded')).toBe('false');
    await click(trigger());
    expect(trigger().getAttribute('aria-expanded')).toBe('true');
    const list = el.querySelector('[role=listbox]')!;
    expect(trigger().getAttribute('aria-controls')).toBe(list.id);
    expect(trigger().getAttribute('aria-activedescendant')).toBeTruthy();
    expect(options()[0].getAttribute('aria-selected')).toBe('false');
  });

  it('multiple shows count and clearAll empties', async () => {
    await setup({ multiple: true });
    fixture.componentInstance.ctrl.setValue(['a', 'c']);
    await fixture.whenStable();
    const badge = el.querySelector('.as-select__count') as HTMLElement;
    expect(badge.textContent).toContain('2');
    await click(badge);
    expect(fixture.componentInstance.ctrl.value).toEqual([]);
  });

  it('multiple stays open and toggles', async () => {
    await setup({ multiple: true });
    await click(trigger());
    await click(options()[0]);
    await click(options()[2]);
    expect(fixture.componentInstance.ctrl.value).toEqual(['a', 'c']);
    expect(options().length).toBe(4);
    await click(options()[0]);
    expect(fixture.componentInstance.ctrl.value).toEqual(['c']);
  });

  it('chips display and removal', async () => {
    await setup({ multiple: true, display: 'chips' });
    fixture.componentInstance.ctrl.setValue(['a', 'd']);
    await fixture.whenStable();
    expect(el.querySelectorAll('.as-chip').length).toBe(2);
    await click(el.querySelector('.as-chip__x') as HTMLElement);
    expect(fixture.componentInstance.ctrl.value).toEqual(['d']);
  });

  it('keyboard: open, arrows skip disabled, Enter selects', async () => {
    await setup();
    await key('ArrowDown');
    expect(options().length).toBe(4);
    expect(options()[0].hasAttribute('data-active')).toBe(true);
    await key('ArrowDown');
    expect(options()[2].hasAttribute('data-active')).toBe(true);
    await key('Enter');
    expect(fixture.componentInstance.ctrl.value).toBe('c');
  });

  it('Escape closes and refocuses trigger', async () => {
    await setup();
    await key('Enter');
    expect(options().length).toBe(4);
    await key('Escape');
    expect(options().length).toBe(0);
    expect(document.activeElement).toBe(trigger());
  });

  it('typeahead moves the active option', async () => {
    await setup();
    await key('ArrowDown');
    await key('d');
    expect(options()[3].hasAttribute('data-active')).toBe(true);
  });

  it('keyboard: Backspace removes last chip, Delete clears count', async () => {
    await setup({ multiple: true, display: 'chips' });
    fixture.componentInstance.ctrl.setValue(['a', 'd']);
    await fixture.whenStable();
    await key('Backspace');
    expect(fixture.componentInstance.ctrl.value).toEqual(['a']);
  });

  it('keyboard: Delete clears count selection', async () => {
    await setup({ multiple: true });
    fixture.componentInstance.ctrl.setValue(['a', 'c']);
    await fixture.whenStable();
    await key('Delete');
    expect(fixture.componentInstance.ctrl.value).toEqual([]);
  });

  it('labelled groups use role=group', async () => {
    await setup();
    fixture.componentInstance.opts = [{ label: 'Greek', options: OPTS }] as never;
    await fixture.whenStable();
    await click(trigger());
    const g = el.querySelector('[role=group]')!;
    expect(g.getAttribute('aria-labelledby')).toBeTruthy();
    expect(el.querySelector('#' + g.getAttribute('aria-labelledby'))?.textContent).toContain('Greek');
  });

  it('mousemove does not activate disabled options', async () => {
    await setup();
    await click(trigger());
    options()[1].dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
    await fixture.whenStable();
    expect(options()[1].hasAttribute('data-active')).toBe(false);
    options()[2].dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
    await fixture.whenStable();
    expect(options()[2].hasAttribute('data-active')).toBe(true);
  });

  it('disabled via control.disable()', async () => {
    await setup();
    fixture.componentInstance.ctrl.disable();
    await fixture.whenStable();
    expect(trigger().disabled).toBe(true);
  });
});
