import {
  ChangeDetectionStrategy,
  Component,
  booleanAttribute,
  computed,
  forwardRef,
  input,
  signal,
} from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';

let nextId = 0;

@Component({
  selector: 'ui-text-input',
  templateUrl: './text-input.html',
  styleUrl: './text-input.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [
    { provide: NG_VALUE_ACCESSOR, useExisting: forwardRef(() => TextInputComponent), multi: true },
  ],
})
export class TextInputComponent implements ControlValueAccessor {
  readonly label = input('');
  readonly placeholder = input('');
  readonly helper = input('');
  readonly error = input<string | null>(null);
  readonly type = input('text');
  readonly disabledInput = input(false, { alias: 'disabled', transform: booleanAttribute });

  protected readonly id = `ui-text-input-${nextId++}`;
  protected readonly descId = `${this.id}-desc`;
  protected readonly value = signal('');
  private readonly cvaDisabled = signal(false);
  protected readonly disabled = computed(() => this.disabledInput() || this.cvaDisabled());
  protected readonly message = computed(() => this.error() || this.helper());

  private onChange: (v: string) => void = () => {};
  private onTouched: () => void = () => {};

  writeValue(v: string | null): void {
    this.value.set(v ?? '');
  }
  registerOnChange(fn: (v: string) => void): void {
    this.onChange = fn;
  }
  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }
  setDisabledState(d: boolean): void {
    this.cvaDisabled.set(d);
  }

  protected onInput(event: Event): void {
    const v = (event.target as HTMLInputElement).value;
    this.value.set(v);
    this.onChange(v);
  }

  protected touched(): void {
    this.onTouched();
  }
}
