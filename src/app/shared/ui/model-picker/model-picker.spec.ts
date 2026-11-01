import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ModelPickerComponent } from './model-picker';
import type { SelectOption } from '../select/select.types';

const MODELS: SelectOption<string>[] = [
  { value: 'opus', label: 'Opus' },
  { value: 'sonnet', label: 'Sonnet' },
];
const EFFORTS: SelectOption<string>[] = [
  { value: 'Default', label: 'Default' },
  { value: 'Low', label: 'Low' },
  { value: 'Medium', label: 'Medium' },
  { value: 'High', label: 'High' },
];

@Component({
  imports: [ModelPickerComponent],
  template: `<ui-model-picker
    [models]="models"
    [efforts]="efforts"
    [(model)]="model"
    [(effort)]="effort"
    [disabled]="disabled()"
  />`,
})
class Host {
  models = MODELS;
  efforts = EFFORTS;
  model = signal<string | null>('sonnet');
  effort = signal('High');
  disabled = signal(false);
}

describe('ModelPickerComponent', () => {
  async function setup() {
    await TestBed.configureTestingModule({ imports: [Host] }).compileComponents();
    const fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    const trigger = () => el.querySelector<HTMLButtonElement>('.mp-trigger')!;
    const open = async () => {
      trigger().click();
      await fixture.whenStable();
    };
    return { fixture, el, trigger, open, host: fixture.componentInstance };
  }

  it('shows model, filled bars and effort in the trigger', async () => {
    const { el, trigger } = await setup();
    expect(trigger().textContent).toContain('Sonnet');
    expect(trigger().textContent).toContain('High');
    expect(el.querySelectorAll('.mp-bars i')).toHaveLength(3);
    expect(el.querySelectorAll('.mp-bars i.mp-on')).toHaveLength(3);
    expect(trigger().getAttribute('aria-label')).toBe('Model: Sonnet, Effort: High');
    expect(el.querySelector('.mp-pop')).toBeNull();
  });

  it('opens the popover and picks a model', async () => {
    const { fixture, el, open, host } = await setup();
    await open();
    const radios = Array.from(el.querySelectorAll<HTMLElement>('[aria-label="Model"] [role=radio]'));
    expect(radios.map((r) => r.textContent?.trim())).toEqual(['Default model', 'Opus', 'Sonnet']);
    expect(radios[2].getAttribute('aria-checked')).toBe('true');
    radios[1].click();
    await fixture.whenStable();
    expect(host.model()).toBe('opus');
  });

  it('picks an effort bar and clears it by pressing the chosen one again', async () => {
    const { fixture, el, open, host } = await setup();
    await open();
    const bars = () => Array.from(el.querySelectorAll<HTMLElement>('[aria-label="Effort"] [role=radio]'));
    bars()[0].click();
    await fixture.whenStable();
    expect(host.effort()).toBe('Low');
    bars()[0].click();
    await fixture.whenStable();
    expect(host.effort()).toBe('Default');
    expect(el.querySelectorAll('.mp-bars i.mp-on')).toHaveLength(0);
  });

  it('clears the model with the default row', async () => {
    const { fixture, el, open, host } = await setup();
    await open();
    el.querySelector<HTMLElement>('[aria-label="Model"] [role=radio]')!.click();
    await fixture.whenStable();
    expect(host.model()).toBeNull();
    expect(el.querySelector('.mp-trigger')?.textContent).toContain('Default model');
  });

  it('closes on Escape and on a press outside, and does not open when disabled', async () => {
    const { fixture, el, open, host, trigger } = await setup();
    await open();
    el.querySelector('.mp-pop')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await fixture.whenStable();
    expect(el.querySelector('.mp-pop')).toBeNull();
    await open();
    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    await fixture.whenStable();
    expect(el.querySelector('.mp-pop')).toBeNull();
    host.disabled.set(true);
    await fixture.whenStable();
    expect(trigger().disabled).toBe(true);
  });
});
