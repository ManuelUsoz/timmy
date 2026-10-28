import { ChangeDetectionStrategy, Component, input } from '@angular/core';

export type TagTone = 'green' | 'blue' | 'red' | 'purple' | 'gray';

@Component({
  selector: 'ui-tag',
  template: '<ng-content />',
  styleUrl: './tag.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'as-tag',
    '[class.as-tag--green]': "tone() === 'green'",
    '[class.as-tag--blue]': "tone() === 'blue'",
    '[class.as-tag--red]': "tone() === 'red'",
    '[class.as-tag--purple]': "tone() === 'purple'",
  },
})
export class TagComponent {
  readonly tone = input<TagTone>('gray');
}
