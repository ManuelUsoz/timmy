import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { TextInputComponent } from './text-input';

@Component({
  imports: [TextInputComponent, ReactiveFormsModule],
  template: `<ui-text-input
    label="Name"
    helper="Your full name"
    [error]="error"
    [formControl]="ctl"
  />`,
})
class Host {
  ctl = new FormControl<string>('hi', { nonNullable: true });
  error: string | null = null;
}

describe('TextInputComponent', () => {
  async function render(patch: Partial<Host> = {}) {
    await TestBed.configureTestingModule({ imports: [Host] }).compileComponents();
    const fixture = TestBed.createComponent(Host);
    Object.assign(fixture.componentInstance, patch);
    await fixture.whenStable();
    const input = () => fixture.nativeElement.querySelector('input') as HTMLInputElement;
    return { fixture, host: fixture.componentInstance, input };
  }

  it('reflects writeValue', async () => {
    const { fixture, host, input } = await render();
    expect(input().value).toBe('hi');
    host.ctl.setValue('yo');
    await fixture.whenStable();
    expect(input().value).toBe('yo');
  });

  it('input emits onChange', async () => {
    const { host, input } = await render();
    input().value = 'new';
    input().dispatchEvent(new Event('input'));
    expect(host.ctl.value).toBe('new');
  });

  it('error sets aria-invalid, error class and replaces helper', async () => {
    const { fixture, input } = await render({ error: 'Enter a name' });
    await fixture.whenStable();
    expect(input().getAttribute('aria-invalid')).toBe('true');
    expect(fixture.nativeElement.querySelector('.as-field--error')).not.toBeNull();
    const help = fixture.nativeElement.querySelector('.as-field__help') as HTMLElement;
    expect(help.textContent).toContain('Enter a name');
    expect(input().getAttribute('aria-describedby')).toBe(help.id);
  });

  it('no aria-invalid without error', async () => {
    const { input } = await render();
    expect(input().hasAttribute('aria-invalid')).toBe(false);
  });

  it('disables via the control', async () => {
    const { fixture, host, input } = await render();
    host.ctl.disable();
    await fixture.whenStable();
    expect(input().disabled).toBe(true);
  });

  it('label is linked to the input', async () => {
    const { fixture, input } = await render();
    const label = fixture.nativeElement.querySelector('label') as HTMLLabelElement;
    expect(label.htmlFor).toBe(input().id);
    expect(input().id).not.toBe('');
  });
});
