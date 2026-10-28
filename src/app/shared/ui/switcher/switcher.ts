import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  booleanAttribute,
  computed,
  forwardRef,
  inject,
  input,
  signal,
} from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';
import { SwitcherOption } from './switcher.types';

export type SwitcherSize = 'default' | 'sm';

@Component({
  selector: 'ui-switcher',
  templateUrl: './switcher.html',
  styleUrl: './switcher.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[class.full]': 'full()' },
  providers: [
    { provide: NG_VALUE_ACCESSOR, useExisting: forwardRef(() => SwitcherComponent), multi: true },
  ],
})
export class SwitcherComponent implements ControlValueAccessor {
  readonly options = input.required<SwitcherOption<unknown>[]>();
  readonly size = input<SwitcherSize>('default');
  readonly full = input(false, { transform: booleanAttribute });
  readonly disabledInput = input(false, { alias: 'disabled', transform: booleanAttribute });

  private readonly el = inject<ElementRef<HTMLElement>>(ElementRef);
  protected readonly value = signal<unknown>(null);
  private readonly cvaDisabled = signal(false);
  protected readonly disabled = computed(() => this.disabledInput() || this.cvaDisabled());

  private readonly selectedIndex = computed(() =>
    this.options().findIndex((o) => o.value === this.value()),
  );

  private onChange: (v: unknown) => void = () => {};
  private onTouched: () => void = () => {};

  writeValue(v: unknown): void {
    this.value.set(v);
  }
  registerOnChange(fn: (v: unknown) => void): void {
    this.onChange = fn;
  }
  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }
  setDisabledState(d: boolean): void {
    this.cvaDisabled.set(d);
  }

  protected isSelected(i: number): boolean {
    return this.selectedIndex() === i;
  }

  protected tabIndexFor(i: number): number {
    const sel = this.selectedIndex();
    return (sel < 0 ? i === 0 : sel === i) ? 0 : -1;
  }

  protected select(i: number): void {
    const opt = this.options()[i];
    if (!opt || this.disabled()) return;
    this.value.set(opt.value);
    this.onChange(opt.value);
  }

  protected onKey(event: KeyboardEvent, i: number): void {
    const n = this.options().length;
    let next: number;
    switch (event.key) {
      case 'ArrowRight':
        next = (i + 1) % n;
        break;
      case 'ArrowLeft':
        next = (i - 1 + n) % n;
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = n - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    this.select(next);
    const buttons = this.el.nativeElement.querySelectorAll<HTMLButtonElement>('button');
    buttons[next]?.focus();
  }

  protected touched(): void {
    this.onTouched();
  }
}
