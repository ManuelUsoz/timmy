import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { CheckboxComponent } from './checkbox';

@Component({
  imports: [CheckboxComponent, ReactiveFormsModule],
  template: `<ui-checkbox [formControl]="ctrl" [indeterminate]="mixed">Label</ui-checkbox>`,
})
class Host {
  ctrl = new FormControl(false);
  mixed = false;
}

describe('CheckboxComponent', () => {
  async function render(patch: Partial<Host> = {}) {
    await TestBed.configureTestingModule({ imports: [Host] }).compileComponents();
    const fixture = TestBed.createComponent(Host);
    Object.assign(fixture.componentInstance, patch);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    return {
      fixture,
      host: fixture.componentInstance,
      input: el.querySelector('input') as HTMLInputElement,
      mark: el.querySelector('.as-check') as HTMLElement,
    };
  }

  it('writeValue updates state', async () => {
    const { fixture, host, input, mark } = await render();
    expect(mark.dataset['state']).toBe('unchecked');
    host.ctrl.setValue(true);
    await fixture.whenStable();
    expect(input.checked).toBe(true);
    expect(mark.dataset['state']).toBe('checked');
  });

  it('click calls onChange', async () => {
    const { fixture, host, input } = await render();
    input.click();
    await fixture.whenStable();
    expect(host.ctrl.value).toBe(true);
  });

  it('mixed state attrs', async () => {
    const { input, mark } = await render({ mixed: true });
    expect(mark.dataset['state']).toBe('mixed');
    expect(input.indeterminate).toBe(true);
    expect(input.getAttribute('aria-checked')).toBe('mixed');
  });

  it('setDisabledState disables', async () => {
    const { fixture, host, input, mark } = await render();
    host.ctrl.disable();
    await fixture.whenStable();
    expect(input.disabled).toBe(true);
    expect(mark.hasAttribute('data-disabled')).toBe(true);
  });
});
