import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import type { SessionId } from '../../../shared/chat/ids.model';
import type { SessionSummary } from '../../../shared/sessions/sessions.model';
import { I18n } from '../../core/i18n';
import { ButtonComponent } from '../../shared/ui/button/button';
import { ListRow } from '../../shared/ui/list-row/list-row';
import { StateComponent } from '../../shared/ui/state/state';
import { TagComponent } from '../../shared/ui/tag/tag';
import { ProjectsState } from './projects-state';
import { stateTone, type SessionState } from './session-state';
import { timeAgo } from './time-ago';

/** The selected project: who it is and its Sessions, the open one with its real state and the rest Idle. */
@Component({
  selector: 'app-project-content',
  imports: [ButtonComponent, ListRow, StateComponent, TagComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './project-content.html',
  styleUrl: './project-content.css',
})
export class ProjectContent {
  protected readonly state = inject(ProjectsState);
  protected readonly i18n = inject(I18n);
  protected readonly tone = stateTone;

  /** The session of the route, the one the chat is showing. */
  readonly openSessionId = input<SessionId>();
  readonly sessionOpened = output<SessionSummary>();
  readonly removed = output<void>();

  protected readonly project = this.state.selected;
  protected readonly sessions = computed(() => this.state.sessions());

  protected title(session: SessionSummary): string {
    return session.title === '' ? this.i18n.t('sessions.untitled') : session.title;
  }

  protected stateLabel(state: SessionState): string {
    switch (state) {
      case 'Live':
        return this.i18n.t('state.live');
      case 'Asks':
        return this.i18n.t('state.asks');
      case 'Idle':
        return this.i18n.t('state.idle');
    }
  }

  protected ago(session: SessionSummary): string {
    return timeAgo(session.updatedAt, Date.now(), this.i18n.language());
  }
}
