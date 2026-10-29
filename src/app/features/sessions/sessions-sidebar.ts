import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, effect, inject, input, output, signal } from '@angular/core';
import { Cause, Effect, Exit, Stream } from 'effect';
import type { AgentId } from '../../../shared/chat/ids.model';
import type { SessionSummary, TranscriptRef } from '../../../shared/sessions/sessions.model';
import { DesktopApi } from '../../core/desktop-api';
import { EffectRuntime } from '../../core/effect-runtime';

type ListState =
  | { readonly status: 'loading' }
  | { readonly status: 'failed'; readonly detail: string }
  | { readonly status: 'ready'; readonly items: ReadonlyArray<SessionSummary> };

/** Test harness for `Sessions.*`: list, open (main or subagent transcript), rename and delete. */
@Component({
  selector: 'app-sessions-sidebar',
  imports: [DatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './sessions-sidebar.html',
  styleUrl: './sessions-sidebar.css',
})
export class SessionsSidebarComponent {
  private readonly runtime = inject(EffectRuntime);

  readonly cwd = input.required<string>();
  /** The user picked a transcript to show. */
  readonly opened = output<TranscriptRef>();
  /** The open session was deleted. */
  readonly closed = output<void>();

  protected readonly list = signal<ListState>({ status: 'loading' });
  protected readonly selected = signal<SessionSummary | undefined>(undefined);
  protected readonly subagents = signal<ReadonlyArray<AgentId>>([]);
  protected readonly editing = signal<SessionSummary | undefined>(undefined);
  protected readonly failure = signal<string | undefined>(undefined);

  constructor() {
    effect(() => {
      this.refresh(this.cwd());
    });

    // Main pushes a value whenever stored sessions change; the stream ends with the component.
    const abort = new AbortController();
    inject(DestroyRef).onDestroy(() => abort.abort());
    const reload = Effect.sync(() => this.refresh(this.cwd(), false));
    const changes = Effect.gen(function* () {
      const desktop = yield* DesktopApi;
      yield* Stream.runForEach(desktop['Sessions.changes'](), () => reload);
    });
    void this.runtime.run(changes, { signal: abort.signal }).then(
      Exit.match({
        onFailure: (cause) => {
          if (!abort.signal.aborted) this.failure.set(Cause.pretty(cause));
        },
        onSuccess: () => undefined,
      }),
    );
  }

  /** `showLoading` is off for pushed updates, so the list does not flash. */
  refresh(cwd = this.cwd(), showLoading = true): void {
    if (showLoading) this.list.set({ status: 'loading' });
    const program = Effect.gen(function* () {
      const desktop = yield* DesktopApi;
      return yield* desktop['Sessions.list']({ cwd });
    });
    void this.runtime.run(program).then(
      Exit.match({
        onFailure: (cause) => this.list.set({ status: 'failed', detail: Cause.pretty(cause) }),
        onSuccess: (items) => this.list.set({ status: 'ready', items }),
      }),
    );
  }

  protected open(session: SessionSummary): void {
    this.selected.set(session);
    this.subagents.set([]);
    this.opened.emit({ projectId: session.projectId, sessionId: session.sessionId });
    const program = Effect.gen(function* () {
      const desktop = yield* DesktopApi;
      return yield* desktop['Sessions.listSubagents']({ sessionId: session.sessionId });
    });
    void this.runtime.run(program).then(
      Exit.match({
        onFailure: (cause) => this.failure.set(Cause.pretty(cause)),
        onSuccess: (ids) => this.subagents.set(ids),
      }),
    );
  }

  protected openSubagent(session: SessionSummary, subagent: AgentId): void {
    this.opened.emit({ projectId: session.projectId, sessionId: session.sessionId, subagent });
  }

  protected rename(session: SessionSummary, title: string): void {
    this.editing.set(undefined);
    const program = Effect.gen(function* () {
      const desktop = yield* DesktopApi;
      yield* desktop['Sessions.rename']({ sessionId: session.sessionId, title });
    });
    this.settle(program, () => undefined);
  }

  protected remove(session: SessionSummary): void {
    const program = Effect.gen(function* () {
      const desktop = yield* DesktopApi;
      yield* desktop['Sessions.delete']({ sessionId: session.sessionId });
    });
    this.settle(program, () => {
      if (this.selected()?.sessionId === session.sessionId) {
        this.selected.set(undefined);
        this.subagents.set([]);
        this.closed.emit();
      }
    });
  }

  private settle<E>(program: Effect.Effect<void, E, DesktopApi>, onSuccess: () => void): void {
    this.failure.set(undefined);
    void this.runtime.run(program).then(
      Exit.match({
        onFailure: (cause) => this.failure.set(Cause.pretty(cause)),
        onSuccess,
      }),
    );
  }
}
