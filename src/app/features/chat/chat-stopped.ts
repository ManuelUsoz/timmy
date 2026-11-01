import { ChangeDetectionStrategy, Component, inject, input, output, signal } from '@angular/core';
import { I18n } from '../../core/i18n';
import { ButtonComponent } from '../../shared/ui/button/button';

/**
 * The note that closes a conversation whose session stopped because of a failure, after the design "Error · la
 * sesión se detuvo". It says what the chat already knows (the failure of the last Turn) and offers what can be
 * done from here; it never has an error of its own.
 */
@Component({
  selector: 'app-chat-stopped',
  imports: [ButtonComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="note" role="alert">
      <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2l6.5 11.5h-13zM8 6.5v3M8 11.5v.01" /></svg>
      <div class="body">
        <span class="title">{{ i18n.t('chat.stoppedTitle') }}</span>
        <p>{{ i18n.t('chat.stoppedDetail') }}</p>
        <code class="detail">{{ detail() }}</code>
        <div class="actions">
          @if (offerNewSession()) {
            <button uiButton kind="secondary" size="sm" type="button" (click)="newSession.emit()">{{ i18n.t('sessions.new') }}</button>
          }
          <button uiButton kind="ghost" size="sm" type="button" (click)="copy()">
            {{ copied() ? i18n.t('chat.detailCopied') : i18n.t('chat.copyDetail') }}
          </button>
        </div>
      </div>
    </div>
  `,
  styles: `
    .note {
      display: flex;
      gap: var(--spacing-04);
      padding: var(--spacing-04);
      border: 1px solid var(--support-error);
      border-inline-start-width: 3px;
      background: var(--layer-01);
      color: var(--text-primary);
    }
    svg {
      flex: none;
      width: 16px;
      height: 16px;
      margin-top: 1px;
      fill: none;
      stroke: var(--support-error);
      stroke-width: 1.2;
      stroke-linejoin: round;
      stroke-linecap: round;
    }
    .body {
      display: flex;
      flex-direction: column;
      gap: var(--spacing-03);
      min-width: 0;
    }
    .title {
      font: var(--text-heading-01);
      letter-spacing: 0.16px;
    }
    p {
      margin: 0;
      font: var(--text-helper-text-01);
      letter-spacing: 0.32px;
      color: var(--text-secondary);
    }
    .detail {
      max-height: 120px;
      overflow: auto;
      font: var(--text-code-01);
      letter-spacing: 0.32px;
      color: var(--text-secondary);
      overflow-wrap: anywhere;
      white-space: pre-wrap;
    }
    .actions {
      display: flex;
      flex-wrap: wrap;
      gap: var(--spacing-03);
    }
  `,
})
export class ChatStopped {
  protected readonly i18n = inject(I18n);

  /** What the chat knows of the failure. */
  readonly detail = input.required<string>();
  /** The Workspace can start another session from here; the Panel has no list of sessions to start it in. */
  readonly offerNewSession = input(false);
  readonly newSession = output<void>();

  protected readonly copied = signal(false);

  protected async copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(this.detail());
      this.copied.set(true);
    } catch {
      // The clipboard can be refused; the detail stays on screen to be selected by hand.
    }
  }
}
