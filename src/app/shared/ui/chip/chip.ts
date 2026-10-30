import {
  ChangeDetectionStrategy,
  Component,
  booleanAttribute,
  input,
  model,
  output,
} from '@angular/core';

export type ChipTone = 'blue' | 'green' | 'red' | 'purple' | 'outline' | 'mono';
export type ChipStatus = 'running' | 'done';
export type ChipSize = 'default' | 'md';

@Component({
  selector: 'ui-chip',
  template: `
    @if (status() === 'running') {
      <span class="as-chip__spinner" role="status" aria-label="Running"></span>
    } @else if (status() === 'done') {
      <svg class="as-chip__check" viewBox="0 0 24 24" width="12" height="12" fill="none" role="img" aria-label="Done">
        <path d="M5 12.5l4.5 4.5L19 7.5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
      </svg>
    }
    <span class="as-chip__label"><ng-content /></span>
    @if (removable()) {
      <button
        type="button"
        class="as-chip__x"
        [attr.aria-label]="removeLabel()"
        (click)="onRemove($event)"
      >
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" aria-hidden="true">
          <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" />
        </svg>
      </button>
    }
  `,
  styleUrl: './chip.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'as-chip',
    '[class.as-chip--blue]': "tone() === 'blue'",
    '[class.as-chip--green]': "tone() === 'green'",
    '[class.as-chip--red]': "tone() === 'red'",
    '[class.as-chip--purple]': "tone() === 'purple'",
    '[class.as-chip--outline]': "tone() === 'outline'",
    '[class.as-chip--mono]': "tone() === 'mono'",
    '[class.as-chip--running]': "status() === 'running'",
    '[class.as-chip--done]': "status() === 'done'",
    '[class.as-chip--md]': "size() === 'md'",
    '[class.as-chip--selectable]': 'selectable()',
    '[class.as-chip--disabled]': 'disabled()',
    '[attr.role]': "selectable() ? 'button' : null",
    '[attr.tabindex]': 'selectable() && !disabled() ? 0 : null',
    '[attr.aria-pressed]': 'selectable() ? selected() : null',
    '[attr.aria-disabled]': 'disabled() ? true : null',
    '(click)': 'toggle()',
    '(keydown.space)': 'onKey($event)',
    '(keydown.enter)': 'onKey($event)',
  },
})
export class ChipComponent {
  readonly tone = input<ChipTone>();
  readonly size = input<ChipSize>('default');
  /** Adds a spinner (running) or a check (done) before the label. */
  readonly status = input<ChipStatus>();
  readonly selectable = input(false, { transform: booleanAttribute });
  readonly selected = model(false);
  readonly removable = input(false, { transform: booleanAttribute });
  readonly removeLabel = input('Remove');
  readonly disabled = input(false, { transform: booleanAttribute });
  readonly removed = output<void>();

  protected toggle(): void {
    if (this.selectable() && !this.disabled()) this.selected.update((v) => !v);
  }

  protected onKey(event: Event): void {
    if (!this.selectable()) return;
    if (event.target !== event.currentTarget) return;
    event.preventDefault();
    this.toggle();
  }

  protected onRemove(event: Event): void {
    event.stopPropagation();
    if (!this.disabled()) this.removed.emit();
  }
}
