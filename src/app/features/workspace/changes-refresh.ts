import { DestroyRef, Injectable, inject, signal } from '@angular/core';
import { Effect, Stream } from 'effect';
import type { ProjectId } from '../../../shared/projects/projects.model';
import type { TerminalHookReport } from '../../../shared/terminal/terminal.model';
import { DesktopApi } from '../../core/desktop-api';
import { EffectRuntime } from '../../core/effect-runtime';
import { ProjectsState } from './projects-state';
import { TerminalsState } from './terminals-state';

/**
 * The shared source of the refresh triggers that keep the Files browser markers and the File View diff current: window focus
 * and a Provider `PostToolUse`/`Stop` Hook of any Terminal of the Project. Consumers debounce and run their own read.
 */
@Injectable({ providedIn: 'root' })
export class ChangesRefreshSource {
  private readonly runtime = inject(EffectRuntime);
  private readonly projects = inject(ProjectsState);
  private readonly terminals = inject(TerminalsState);

  /** Emits the Project that should refresh. A new object on every trigger, so signals see repeats of the same Project. */
  readonly trigger = signal<{ readonly projectId: ProjectId } | undefined>(undefined);

  constructor() {
    const onFocus = () => {
      const selected = this.projects.selected();
      if (selected !== undefined) this.emit(selected.projectId);
    };
    window.addEventListener('focus', onFocus);
    inject(DestroyRef).onDestroy(() => window.removeEventListener('focus', onFocus));

    const stop = new AbortController();
    inject(DestroyRef).onDestroy(() => stop.abort());
    void this.runtime.run(
      Effect.flatMap(DesktopApi, (desktop) => Stream.runForEach(desktop['Terminal.hookReports'](), (report) => Effect.sync(() => this.heard(report)))),
      { signal: stop.signal },
    );
  }

  /** Manually ask every consumer of `projectId` to refresh. Tests use this instead of waiting for focus or a Hook. */
  emit(projectId: ProjectId): void {
    this.trigger.set({ projectId });
  }

  private heard(report: TerminalHookReport): void {
    if (report.signal !== 'Working' && report.signal !== 'Done') return;
    const terminal = this.terminals.find(report.terminalId);
    if (terminal !== undefined) this.emit(terminal.projectId);
  }
}
