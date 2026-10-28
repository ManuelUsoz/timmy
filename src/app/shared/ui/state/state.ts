import { ChangeDetectionStrategy, Component, input } from '@angular/core';

export type StateTone = 'success' | 'info' | 'warning' | 'error' | 'merged' | 'idle';

@Component({
  selector: 'ui-state',
  template: '<span class="as-dot" aria-hidden="true"></span><ng-content />',
  styleUrl: './state.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'as-state',
    '[style.--tone]': "'var(--support-' + tone() + ')'",
  },
})
export class StateComponent {
  readonly tone = input<StateTone>('idle');
}
