import { ChangeDetectionStrategy, Component } from '@angular/core';

/** Overlapping avatars for the pill's [pillLead] slot. Only the first three are shown. */
@Component({
  selector: 'ui-pill-stack',
  template: '<ng-content select="ui-avatar" />',
  styles: `
    :host {
      display: inline-flex;
      flex: none;
    }
    :host ::ng-deep ui-avatar {
      margin-left: -8px;
      border-radius: var(--radius-full, 9999px);
      box-shadow: 0 0 0 2px var(--pill, var(--layer-01, #262626));
    }
    :host ::ng-deep ui-avatar:first-child {
      margin-left: 0;
    }
    :host ::ng-deep ui-avatar:nth-child(n + 4) {
      display: none;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'as-stack' },
})
export class PillStackComponent {}
