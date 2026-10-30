import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { AvatarComponent } from '../avatar/avatar';

export type MessageRole = 'user' | 'agent';

@Component({
  selector: 'ui-message',
  imports: [AvatarComponent],
  template: `
    @if (role() === 'agent') {
      <ui-avatar tone="merged">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M12 3c1 3 5 5 5 10a5 5 0 0 1-10 0c0-2 1-3 2-4 0 2 1 3 2 3 0-3-1-5 1-9z" />
        </svg>
      </ui-avatar>
    }
    <div [class]="role() === 'agent' ? 'as-message__body' : 'as-message__bubble'"><ng-content /></div>
  `,
  styleUrl: './message.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'as-message',
    '[class.as-message--user]': "role() === 'user'",
    '[class.as-message--agent]': "role() === 'agent'",
    role: 'article',
    '[attr.aria-label]': 'accessibleName()',
  },
})
export class MessageComponent {
  readonly role = input<MessageRole>('agent');
  /** Overrides the default accessible name ("You" / "Agent"). */
  readonly author = input('');

  protected readonly accessibleName = computed(
    () => this.author() || (this.role() === 'user' ? 'You' : 'Agent'),
  );
}
