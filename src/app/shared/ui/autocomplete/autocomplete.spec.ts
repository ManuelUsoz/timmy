import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AutocompleteComponent } from './autocomplete';
import { AutocompleteOption } from './autocomplete.types';

const OPTIONS: AutocompleteOption<string>[] = [
  { value: 'main', label: 'main', group: 'Branches' },
  { value: 'feature', label: 'feature/chat', group: 'Branches' },
  { value: 'readme', label: 'README.md', group: 'Files' },
];

@Component({
  imports: [AutocompleteComponent, ReactiveFormsModule],
  template: `<ui-autocomplete
    [options]="options"
    [multiple]="multiple"
    [creatable]="creatable"
    [formControl]="ctl"
  />`,
})
class Host {
  options = OPTIONS;
  multiple = false;
  creatable = false;
  ctl = new FormControl<unknown>(null);
}

describe('AutocompleteComponent', () => {
  afterEach(() => vi.useRealTimers());

  async function render(patch: Partial<Host> = {}) {
    await TestBed.configureTestingModule({ imports: [Host] }).compileComponents();
    const fixture = TestBed.createComponent(Host);
    Object.assign(fixture.componentInstance, patch);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    const input = () => el.querySelector('input') as HTMLInputElement;
    const options = () => Array.from(el.querySelectorAll('[role="option"]')) as HTMLElement[];
    const type = (text: string) => {
      input().value = text;
      input().dispatchEvent(new Event('input'));
      fixture.detectChanges();
    };
    const key = (k: string) => {
      input().dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
      fixture.detectChanges();
    };
    return { fixture, host: fixture.componentInstance, el, input, options, type, key };
  }

  it('writeValue single shows the label', async () => {
    const { fixture, host, input } = await render();
    host.ctl.setValue('feature');
    await fixture.whenStable();
    expect(input().value).toBe('feature/chat');
  });

  it('writeValue multiple shows chips', async () => {
    const { fixture, host, el } = await render({ multiple: true });
    host.ctl.setValue(['main', 'readme']);
    await fixture.whenStable();
    const chips = Array.from(el.querySelectorAll('.as-chip__label')).map((c) => c.textContent);
    expect(chips).toEqual(['main', 'README.md']);
  });

  it('filters after 100ms and groups results', async () => {
    const { fixture, options, type, el } = await render();
    vi.useFakeTimers();
    type('mai');
    expect(options().length).toBe(3);
    vi.advanceTimersByTime(99);
    fixture.detectChanges();
    expect(options().length).toBe(3);
    vi.advanceTimersByTime(1);
    fixture.detectChanges();
    expect(options().map((o) => o.textContent?.trim())).toEqual(['main']);
    expect(el.querySelector('mark.as-match')?.textContent).toBe('mai');
    expect(el.querySelector('[role="status"]')?.textContent).toContain('1 result');
  });

  it('Enter picks the active option and aria-activedescendant follows', async () => {
    const { fixture, host, input, options, type, key } = await render();
    type('');
    fixture.detectChanges();
    expect(input().getAttribute('aria-expanded')).toBe('true');
    key('ArrowDown');
    expect(input().getAttribute('aria-activedescendant')).toBe(options()[1].id);
    key('Enter');
    expect(host.ctl.value).toBe('feature');
    expect(input().getAttribute('aria-expanded')).toBe('false');
  });

  it('interleaved groups keep a consistent flat index', async () => {
    const { fixture, host, input, options, type, key } = await render({
      options: [
        { value: 'a1', label: 'a1', group: 'A' },
        { value: 'b1', label: 'b1', group: 'B' },
        { value: 'a2', label: 'a2', group: 'A' },
      ],
    });
    type('');
    fixture.detectChanges();
    expect(options().map((o) => o.textContent?.trim())).toEqual(['a1', 'a2', 'b1']);
    key('ArrowDown');
    key('ArrowDown');
    expect(input().getAttribute('aria-activedescendant')).toBe(options()[2].id);
    key('Enter');
    expect(host.ctl.value).toBe('b1');
  });

  it('Enter before the debounce elapses uses the current query', async () => {
    const { fixture, host, type, key } = await render();
    vi.useFakeTimers();
    type('READ');
    key('Enter');
    expect(host.ctl.value).toBe('readme');
  });

  it('Escape closes the menu, then clears the query', async () => {
    const { fixture, input, type, key } = await render();
    vi.useFakeTimers();
    type('mai');
    vi.advanceTimersByTime(100);
    fixture.detectChanges();
    key('Escape');
    expect(input().getAttribute('aria-expanded')).toBe('false');
    expect(input().value).toBe('mai');
    key('Escape');
    expect(input().value).toBe('');
  });

  it('create option emits typed text', async () => {
    const { fixture, host, el, type, key } = await render({ creatable: true });
    vi.useFakeTimers();
    type('zzz');
    vi.advanceTimersByTime(100);
    fixture.detectChanges();
    expect(el.querySelector('.as-option--create')?.textContent).toContain('Create "zzz"');
    key('Enter');
    expect(host.ctl.value).toBe('zzz');
  });

  it('Backspace on empty input removes last chip; x button removes a chip', async () => {
    const { fixture, host, el, key } = await render({ multiple: true });
    host.ctl.setValue(['main', 'feature', 'readme']);
    await fixture.whenStable();
    key('Backspace');
    expect(host.ctl.value).toEqual(['main', 'feature']);
    (el.querySelector('.as-chip__x') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(host.ctl.value).toEqual(['feature']);
  });

  it('is disabled', async () => {
    const { fixture, host, input } = await render();
    host.ctl.disable();
    await fixture.whenStable();
    expect(input().disabled).toBe(true);
  });
});
