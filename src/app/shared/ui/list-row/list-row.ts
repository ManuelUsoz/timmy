import { ChangeDetectionStrategy, Component, booleanAttribute, input, output } from '@angular/core';

@Component({
  selector: 'as-list-row',
  templateUrl: './list-row.html',
  styleUrl: './list-row.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'as-row',
    role: 'option',
    '[attr.tabindex]': 'disabled() ? null : 0',
    '[attr.aria-selected]': 'selected()',
    '[attr.aria-disabled]': 'disabled() || null',
    '[class.as-row--selected]': 'selected()',
    '[class.as-row--disabled]': 'disabled()',
    '[class.as-row--asks]': 'asks()',
    '[class.as-row--lead]': 'lead()',
    '(click)': 'choose()',
    '(keydown.enter)': 'choose()',
  },
})
export class ListRow {
  readonly label = input.required<string>();
  readonly meta = input<string>();
  readonly selected = input(false, { transform: booleanAttribute });
  readonly disabled = input(false, { transform: booleanAttribute });
  readonly asks = input(false, { transform: booleanAttribute });
  readonly lead = input(false, { transform: booleanAttribute });
  readonly activate = output<void>();

  protected choose(): void {
    if (this.disabled()) return;
    this.activate.emit();
  }
}
