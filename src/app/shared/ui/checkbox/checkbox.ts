import {
  ChangeDetectionStrategy,
  Component,
  booleanAttribute,
  computed,
  forwardRef,
  input,
  output,
  signal,
} from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';

@Component({
  selector: 'ui-checkbox',
  templateUrl: './checkbox.html',
  styleUrl: './checkbox.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [
    { provide: NG_VALUE_ACCESSOR, useExisting: forwardRef(() => CheckboxComponent), multi: true },
  ],
})
export class CheckboxComponent implements ControlValueAccessor {
  readonly indeterminate = input(false, { transform: booleanAttribute });
  readonly disabledInput = input(false, { alias: 'disabled', transform: booleanAttribute });
  readonly checkedChange = output<boolean>();

  protected readonly value = signal(false);
  private readonly cvaDisabled = signal(false);

  protected readonly disabled = computed(() => this.disabledInput() || this.cvaDisabled());
  protected readonly state = computed(() =>
    this.indeterminate() ? 'mixed' : this.value() ? 'checked' : 'unchecked',
  );

  private onChange: (v: boolean) => void = () => {};
  private onTouched: () => void = () => {};

  writeValue(v: unknown): void {
    this.value.set(!!v);
  }
  registerOnChange(fn: (v: boolean) => void): void {
    this.onChange = fn;
  }
  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }
  setDisabledState(d: boolean): void {
    this.cvaDisabled.set(d);
  }

  protected toggle(event: Event): void {
    const checked = (event.target as HTMLInputElement).checked;
    this.value.set(checked);
    this.onChange(checked);
    this.checkedChange.emit(checked);
  }

  protected touched(): void {
    this.onTouched();
  }
}
