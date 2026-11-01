import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { I18n } from '../../core/i18n';
import { ButtonComponent } from '../../shared/ui/button/button';

/**
 * Bifurcar, "Ver cambios" and "Más acciones" of the open session's header, as the design draws them. Their
 * features come later, so they have no handler: they are focusable (aria-disabled, not disabled, so the keyboard
 * reaches them) and drawn dimmed, and pressing one does nothing.
 */
@Component({
  selector: 'app-chat-header-actions',
  imports: [ButtonComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button uiButton kind="secondary" size="sm" type="button" aria-disabled="true" [attr.aria-label]="i18n.t('chat.fork')">
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" aria-hidden="true"><circle cx="4.5" cy="3.5" r="1.5" /><circle cx="4.5" cy="12.5" r="1.5" /><circle cx="11.5" cy="5.5" r="1.5" /><path d="M4.5 5v6M11.5 7c0 3-7 2-7 4" /></svg>
      {{ i18n.t('chat.fork') }}
    </button>
    <button uiButton kind="ghost" size="sm" type="button" aria-disabled="true" [attr.aria-label]="i18n.t('chat.viewChanges')">{{ i18n.t('chat.viewChanges') }}</button>
    <button uiButton kind="ghost" iconOnly size="sm" type="button" aria-disabled="true" [attr.aria-label]="i18n.t('chat.moreActions')" [attr.title]="i18n.t('chat.moreActions')">
      <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><circle cx="3" cy="8" r="1.4" /><circle cx="8" cy="8" r="1.4" /><circle cx="13" cy="8" r="1.4" /></svg>
    </button>
  `,
  styles: `
    :host {
      display: inline-flex;
      align-items: center;
      gap: var(--spacing-02);
    }
  `,
})
export class ChatHeaderActions {
  protected readonly i18n = inject(I18n);
}
