import { ChangeDetectionStrategy, Component, ElementRef, computed, effect, inject, input, output, signal, viewChild } from '@angular/core';
import type { SessionId } from '../../../shared/chat/ids.model';
import type { SessionSummary } from '../../../shared/sessions/sessions.model';
import { I18n } from '../../core/i18n';
import { ButtonComponent } from '../../shared/ui/button/button';
import { ListRow } from '../../shared/ui/list-row/list-row';
import { StateComponent } from '../../shared/ui/state/state';
import { TagComponent } from '../../shared/ui/tag/tag';
import { TreeViewComponent } from '../../shared/ui/tree-view/tree-view';
import { sampleFiles } from './files-sample';
import { ProjectsState } from './projects-state';
import { stateTone, type SessionState } from './session-state';
import { terminalsOf, type TerminalEntry, type TerminalId } from './terminal-entries';
import { SAMPLE_EXIT_CODE } from './terminal-sample';
import { shortPath, terminalStateKey, terminalTone } from './terminal-view';
import { TerminalsState } from './terminals-state';
import { timeAgo } from './time-ago';

/**
 * The selected project: who it is, its Sessions (the open one with its real state, the rest Idle) and its
 * terminals, which are only visual for now.
 */
@Component({
  selector: 'app-project-content',
  imports: [ButtonComponent, ListRow, StateComponent, TagComponent, TreeViewComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './project-content.html',
  styleUrl: './project-content.css',
})
export class ProjectContent {
  protected readonly state = inject(ProjectsState);
  protected readonly i18n = inject(I18n);
  protected readonly tone = stateTone;
  protected readonly terminalTone = terminalTone;
  protected readonly terminalStateKey = terminalStateKey;
  private readonly terminalsState = inject(TerminalsState);

  /** The session of the route, the one the chat is showing. */
  readonly openSessionId = input<SessionId>();
  /** A new session is being started, so its button waits. */
  readonly creating = input(false);
  /** The project's folder is not on disk: only the header and an Archivos that says so are shown. */
  readonly folderMissing = input(false);
  /** The terminal of the route. */
  readonly openTerminalId = input<TerminalId>();
  readonly sessionOpened = output<SessionSummary>();
  readonly terminalOpened = output<TerminalEntry>();
  /** "Nueva terminal" was pressed: the screen creates it and opens it. */
  readonly newTerminal = output<void>();
  /** "Nueva sesión" was pressed: the screen starts it and opens it. */
  readonly newSession = output<void>();
  readonly removed = output<void>();

  /** Archivos is a static placeholder for now (see files-sample.ts); it changes only with the language. */
  protected readonly files = computed(() => sampleFiles(this.i18n.t('files.modified')));
  protected readonly filesOpen = signal(true);

  protected readonly project = this.state.selected;
  protected readonly sessions = computed(() => this.state.sessions());
  protected readonly terminals = computed(() => {
    const selected = this.project();
    return selected === undefined ? [] : terminalsOf(this.terminalsState.entries(), selected.projectId);
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

  /** A failed terminal says how it ended; the others, where they are. */
  protected terminalMeta(terminal: TerminalEntry): string {
    return terminal.state === 'Error'
      ? this.i18n.t('terminals.exited', { code: SAMPLE_EXIT_CODE })
      : shortPath(this.project()?.cwd ?? '');
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
