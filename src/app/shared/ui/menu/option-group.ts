import { ChangeDetectionStrategy, Component, input } from '@angular/core';

let nextId = 0;

@Component({
  selector: 'ui-option-group',
  template: `
    <div class="header" [id]="id">{{ label() }}</div>
    <ng-content />
  `,
  styleUrl: './option-group.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { role: 'group', '[attr.aria-labelledby]': 'id' },
})
export class OptionGroupComponent {
  readonly label = input.required<string>();
  protected readonly id = `ui-option-group-${nextId++}`;
}
