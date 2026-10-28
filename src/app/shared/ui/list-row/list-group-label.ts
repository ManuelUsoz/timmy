import { ChangeDetectionStrategy, Component, input } from '@angular/core';

@Component({
  selector: 'as-list-group-label',
  template: `
    <span>{{ label() }}</span>
    @if (count() !== undefined) {
      <span class="as-group__count">{{ count() }}</span>
    }
  `,
  styles: `
    :host {
      display: flex;
      align-items: baseline;
      gap: var(--spacing-03);
      padding: var(--spacing-03) var(--spacing-04) var(--spacing-02);
      font: 400 12px/16px var(--font-mono);
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--text-helper);
    }
    .as-group__count {
      margin-left: auto;
      letter-spacing: 0.32px;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'as-group' },
})
export class ListGroupLabel {
  readonly label = input.required<string>();
  readonly count = input<number>();
}
