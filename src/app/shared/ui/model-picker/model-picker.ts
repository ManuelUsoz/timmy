import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  booleanAttribute,
  computed,
  inject,
  input,
  model,
  signal,
  viewChild,
} from '@angular/core';
import type { SelectOption } from '../select/select.types';

let nextId = 0;

/**
 * Model and effort in one trigger: "Sonnet 5.5 ▂▄▆ High". Opens a popover above it with the models as a radio list
 * and the effort as a scale of bars (the bars up to the chosen one are filled). Pressing the chosen bar again goes
 * back to the default effort. A `null` model and the `defaultEffort` value mean "whatever the provider picks".
 */
@Component({
  selector: 'ui-model-picker',
  templateUrl: './model-picker.html',
  styleUrl: './model-picker.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(document:pointerdown)': 'onDocumentPointerDown($event)',
    '(keydown.escape)': 'onEscape($event)',
  },
})
export class ModelPickerComponent {
  readonly models = input<SelectOption<string>[]>([]);
  /** Every effort the model has; the default one is not drawn as a bar. */
  readonly efforts = input<SelectOption<string>[]>([]);
  readonly defaultEffort = input('Default');
  readonly model = model<string | null>(null);
  readonly effort = model<string>('Default');
  readonly disabled = input(false, { transform: booleanAttribute });
  readonly modelsLabel = input('Model');
  readonly effortLabel = input('Effort');
  /** Row that clears the model, and what the trigger says while none is chosen. */
  readonly defaultModelLabel = input('Default model');
  readonly defaultEffortLabel = input('Default');
  /** Ends of the scale, under the bars. */
  readonly lowLabel = input('');
  readonly highLabel = input('');

  protected readonly open = signal(false);
  protected readonly popoverId = `ui-model-picker-${nextId++}-popover`;

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly trigger = viewChild<ElementRef<HTMLButtonElement>>('trigger');

  protected readonly scale = computed(() => this.efforts().filter((e) => e.value !== this.defaultEffort()));
  /** How many bars are filled; 0 while the effort is the default. */
  protected readonly filled = computed(() => this.scale().findIndex((e) => e.value === this.effort()) + 1);
  protected readonly modelText = computed(
    () => this.models().find((m) => m.value === this.model())?.label ?? this.defaultModelLabel(),
  );
  protected readonly effortText = computed(
    () => this.scale().find((e) => e.value === this.effort())?.label ?? this.defaultEffortLabel(),
  );
  protected readonly summary = computed(
    () => `${this.modelsLabel()}: ${this.modelText()}, ${this.effortLabel()}: ${this.effortText()}`,
  );

  /** Heights of the bars in px, from 4 up to 12 as in the design. */
  protected barHeight(index: number): number {
    const last = Math.max(this.scale().length - 1, 1);
    return Math.round(4 + (8 * index) / last);
  }

  protected toggle(): void {
    if (this.disabled()) return;
    this.open.update((o) => !o);
  }

  protected pickModel(value: string | null): void {
    this.model.set(value);
  }

  protected pickEffort(value: string): void {
    this.effort.set(value === this.effort() ? this.defaultEffort() : value);
  }

  protected onEscape(event: Event): void {
    if (!this.open()) return;
    event.preventDefault();
    event.stopPropagation();
    this.open.set(false);
    this.trigger()?.nativeElement.focus();
  }

  protected onDocumentPointerDown(event: Event): void {
    if (this.open() && !this.host.nativeElement.contains(event.target as Node)) this.open.set(false);
  }
}
