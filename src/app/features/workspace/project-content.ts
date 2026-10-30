import { ChangeDetectionStrategy, Component, ElementRef, computed, effect, inject, input, output, signal, viewChild } from '@angular/core';
import type { SessionId } from '../../../shared/chat/ids.model';
import type { SessionSummary } from '../../../shared/sessions/sessions.model';
import { I18n } from '../../core/i18n';
import { ButtonComponent } from '../../shared/ui/button/button';
import { ListRow } from '../../shared/ui/list-row/list-row';
import { StateComponent } from '../../shared/ui/state/state';
import { TagComponent } from '../../shared/ui/tag/tag';
import { ProjectsState } from './projects-state';
import { failureKey } from './session-actions';
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
  /** A new session is being started, so its button waits. */
  readonly creating = input(false);
  readonly sessionOpened = output<SessionSummary>();
  /** "Nueva sesión" was pressed: the screen starts it and opens it. */
  readonly newSession = output<void>();
  readonly removed = output<void>();

  protected readonly project = this.state.selected;
  protected readonly sessions = computed(() => this.state.sessions());
  protected readonly failureText = computed(() => {
    const failure = this.state.actionFailure();
    return failure === null ? null : this.i18n.t(failureKey(failure));
  });

  /** The session being renamed, and what the user has typed so far. */
  protected readonly renaming = signal<SessionId | null>(null);
  protected readonly draft = signal('');
  /** The session waiting for the user to confirm its deletion. */
  protected readonly confirming = signal<SessionId | null>(null);
  /** A rename or delete is in flight, so it cannot be sent twice. */
  protected readonly pending = signal(false);
  private readonly renameField = viewChild<ElementRef<HTMLInputElement>>('renameField');

  constructor() {
    // The field takes the focus, with the current name selected, as soon as it appears.
    effect(() => {
      const field = this.renameField()?.nativeElement;
      if (field === undefined) return;
      field.focus();
      field.select();
    });
  }

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

  protected startRename(session: SessionSummary): void {
    this.confirming.set(null);
    this.draft.set(session.title);
    this.renaming.set(session.sessionId);
  }

  /** Saves the name; the field stays open when main refuses it, so the user can fix it. */
  protected async saveRename(session: SessionSummary): Promise<void> {
    if (this.pending()) return;
    const title = this.draft().trim();
    if (title === session.title) {
      this.renaming.set(null);
      return;
    }
    this.pending.set(true);
    const renamed = await this.state.renameSession(session.sessionId, title);
    this.pending.set(false);
    if (renamed) this.renaming.set(null);
  }

  protected cancelRename(): void {
    this.renaming.set(null);
  }

  protected startDelete(session: SessionSummary): void {
    this.renaming.set(null);
    this.confirming.set(session.sessionId);
  }

  protected async confirmDelete(session: SessionSummary): Promise<void> {
    if (this.pending()) return;
    this.pending.set(true);
    await this.state.deleteSession(session.sessionId);
    this.pending.set(false);
    this.confirming.set(null);
  }

  protected cancelDelete(): void {
    this.confirming.set(null);
  }

  protected ago(session: SessionSummary): string {
    return timeAgo(session.updatedAt, Date.now(), this.i18n.language());
  }
}
