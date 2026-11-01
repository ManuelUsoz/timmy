import { ChangeDetectionStrategy, Component, booleanAttribute, inject, input, output } from '@angular/core';
import { I18n } from '../../../core/i18n';

export type NotificationTone = 'success' | 'info' | 'warning' | 'error';

/**
 * An inline message about the result of the user's last action: a dot in the tone's colour, one word naming
 * the kind as the title, and the body (projected) saying what happened and what to do. The word, not the colour,
 * carries the meaning.
 */
@Component({
  selector: 'ui-notification',
  template: `
    <span class="as-note__ico" aria-hidden="true"></span>
    <div class="as-note__text">
      <div class="as-note__title">{{ title() }}</div>
      <div class="as-note__body"><ng-content /></div>
    </div>
    @if (dismissible()) {
      <button type="button" class="as-note__close" [attr.aria-label]="i18n.t('toast.dismiss')" (click)="dismissed.emit()">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" /></svg>
      </button>
    }
  `,
  styleUrl: './notification.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'as-note',
    '[style.--tone]': "'var(--support-' + tone() + ')'",
  },
})
export class NotificationComponent {
  protected readonly i18n = inject(I18n);

  readonly tone = input<NotificationTone>('info');
  /** One word naming the kind (Success, Info, Warning, Error). */
  readonly title = input.required<string>();
  readonly dismissible = input(true, { transform: booleanAttribute });
  readonly dismissed = output<void>();
}
