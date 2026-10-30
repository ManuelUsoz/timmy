import { FormControl } from '@angular/forms';
import type { PermissionMode } from '../../../shared/chat/session.model';
import type { SelectOption } from '../../shared/ui/select/select.types';
import { pillView } from '../shell/pill-view';
import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import type { Effort, ModelInfo } from '../../../shared/chat/provider.model';
import { Cause, Effect, Exit, Stream } from 'effect';
import type { AppInfo } from '../../../shared/app-info/app-info.rpc';
import type { ChatEvent } from '../../../shared/chat/event.model';
import type { SessionId } from '../../../shared/chat/ids.model';
import type { PermissionResponse } from '../../../shared/chat/permission.model';
import { DesktopApi, type DesktopApiShape } from '../../core/desktop-api';
import { EffectRuntime } from '../../core/effect-runtime';
import type { CommandsState } from './slash-commands';
import { chatStateFromHistory } from '../sessions/history-state';
import type { SessionSummary, TranscriptRef } from '../../../shared/sessions/sessions.model';
import { chatBlocks, sessionChips } from './chat-blocks';
import { addUserMessage, groupByOwner, initialChatState, reduceChat, type ChatState } from './chat-state';

/** Display names live in the renderer; the adapter only knows model ids. */
const MODEL_LABELS: Readonly<Record<string, string>> = {
  'claude-opus-5-5': 'Claude Opus 5.5',
  'claude-sonnet-5-5': 'Claude Sonnet 5.5',
  'claude-haiku-5-5': 'Claude Haiku 5.5',
};

/** Owns the live chat so it survives Window mode switches (the Pill reads it too). */
@Injectable({ providedIn: 'root' })
export class ChatController {
  private readonly runtime = inject(EffectRuntime);
  private sessionId: SessionId | undefined;
  /** Stored session the next `startSession` continues; set while a past transcript is shown. */
  private resumeFrom: SessionId | undefined;

  readonly info = signal<AppInfo | null>(null);
  readonly error = signal<string | null>(null);
  readonly chat = signal<ChatState>(initialChatState);
  readonly draft = signal('');
  readonly commands = signal<CommandsState>({ status: 'loading' });

  private readonly models = signal<ReadonlyArray<ModelInfo>>([]);
  private readonly selectedModel = signal<string | null>(null);
  readonly modelOptions = computed((): SelectOption<string>[] =>
    this.models().map((m) => ({ value: m.id, label: MODEL_LABELS[m.id] ?? m.id })),
  );
  readonly modelControl = new FormControl<string | null>(null);
  readonly effortOptions = computed((): SelectOption<Effort>[] =>
    this.effortsOf(this.selectedModel()).map((value) => ({
      value,
      label: value === 'XHigh' ? 'Extra high' : value,
    })),
  );
  readonly effortControl = new FormControl<Effort>('Default', { nonNullable: true });
  readonly permissionOptions: SelectOption<PermissionMode>[] = [
    { value: 'Auto', label: 'Auto mode' },
    { value: 'AutoAccept', label: 'Auto accept' },
    { value: 'Default', label: 'Default' },
    { value: 'Plan', label: 'Plan' },
  ];
  readonly permissionControl = new FormControl<PermissionMode>('Default', { nonNullable: true });
  readonly tree = computed(() => groupByOwner(this.chat()));
  readonly blocks = computed(() => chatBlocks(this.chat(), this.tree()));

  /** Sessions of the current project, newest first as the list RPC returns them. */
  readonly sessions = signal<ReadonlyArray<SessionSummary>>([]);
  /** The Session whose transcript is on screen; undefined for a fresh chat. */
  readonly selectedSessionId = signal<SessionId | undefined>(undefined);
  readonly sessionChips = computed(() => sessionChips(this.sessions(), this.selectedSessionId()));

  /** Only flips on a real transition, so effects reading it do not re-run on every streamed delta. */
  private readonly running = computed(() => this.chat().running);
  private readonly turnStartedAt = signal(0);
  private readonly now = signal(Date.now());
  readonly pill = computed(() => pillView(this.chat(), this.now() - this.turnStartedAt()));

  readonly contextPercent = computed(() => {
    const context = this.chat().context;
    return context === undefined ? undefined : Math.round((context.usedTokens / context.maxTokens) * 100);
  });

  constructor() {
    void this.call(
      (desktop) => desktop['AppInfo.get'](),
      (appInfo) => {
        this.info.set(appInfo);
        this.loadCommands(appInfo.cwd);
        this.watchSessions(appInfo.cwd);
      },
    );
    void this.call((desktop) => desktop['Chat.models'](), (models) => this.models.set(models));

    this.modelControl.valueChanges.pipe(takeUntilDestroyed()).subscribe((id) => {
      this.selectedModel.set(id);
      if (!this.effortsOf(id).includes(this.effortControl.value)) this.effortControl.setValue('Default', { emitEvent: false });
      this.resetSession();
    });
    this.effortControl.valueChanges.pipe(takeUntilDestroyed()).subscribe(() => this.resetSession());
    this.permissionControl.valueChanges.pipe(takeUntilDestroyed()).subscribe(() => this.resetSession());

    // Elapsed time on the Pill: tick once a second while a Turn runs.
    effect((onCleanup) => {
      if (!this.running()) return;
      this.now.set(Date.now());
      const timer = setInterval(() => this.now.set(Date.now()), 1000);
      onCleanup(() => clearInterval(timer));
    });

    // A session cannot change options mid-turn: lock the selectors while one runs.
    // emitEvent: false keeps enable/disable from firing valueChanges (which would reset the session).
    effect(() => {
      const locked = this.running();
      for (const control of [this.modelControl, this.effortControl, this.permissionControl]) {
        if (locked) control.disable({ emitEvent: false });
        else control.enable({ emitEvent: false });
      }
    });
  }

  private effortsOf(modelId: string | null): ReadonlyArray<Effort> {
    return this.models().find((m) => m.id === modelId)?.efforts ?? ['Default'];
  }

  /** Runs one RPC at the edge; failures land in `error` unless the caller handles them. */
  private call<A, E>(
    f: (desktop: DesktopApiShape) => Effect.Effect<A, E>,
    onSuccess: (value: A) => void,
    onFailure: (cause: Cause.Cause<unknown>) => void = (cause) => this.error.set(Cause.pretty(cause)),
  ): Promise<void> {
    return this.runtime.run(Effect.flatMap(DesktopApi, f)).then(Exit.match({ onFailure, onSuccess }));
  }

  /** Loads the project's Sessions and reloads whenever main pushes a change. */
  private watchSessions(cwd: string): void {
    const refresh = () => this.call((desktop) => desktop['Sessions.list']({ cwd }), (items) => this.sessions.set(items));
    void refresh();
    const changes = Effect.gen(function* () {
      const desktop = yield* DesktopApi;
      yield* Stream.runForEach(desktop['Sessions.changes'](), () => Effect.promise(refresh));
    });
    void this.runtime.run(changes);
  }

  private loadCommands(cwd: string): void {
    this.commands.set({ status: 'loading' });
    void this.call(
      (desktop) => desktop['Chat.commands']({ cwd }),
      (items) => this.commands.set({ status: 'ready', items }),
      (cause) => this.commands.set({ status: 'failed', detail: Cause.pretty(cause) }),
    );
  }

  private resetSession(): void {
    if (this.chat().running) return;
    const sessionId = this.sessionId;
    if (sessionId === undefined) return;
    this.sessionId = undefined;
    // The session stays the same across option changes: the next message resumes it.
    this.resumeFrom = sessionId;
    void this.call((desktop) => desktop['Chat.closeSession']({ sessionId }), () => undefined);
  }

  send(): void {
    const text = this.draft().trim();
    const cwd = this.info()?.cwd;
    if (text === '' || cwd === undefined || this.chat().running) return;

    this.draft.set('');
    this.turnStartedAt.set(Date.now());
    this.now.set(Date.now());
    this.chat.update((state) => ({ ...addUserMessage(state, text), running: true }));

    const apply = (event: ChatEvent) => Effect.sync(() => this.chat.update((state) => reduceChat(state, event)));
    const known = this.sessionId;
    const resume = this.resumeFrom;
    const model = this.modelControl.value;
    const permissionMode = this.permissionControl.value;
    const effort = this.effortControl.value;
    const remember = (id: SessionId) =>
      Effect.sync(() => {
        this.sessionId = id;
        this.selectedSessionId.set(resume ?? id);
      });

    const program = Effect.gen(function* () {
      const desktop = yield* DesktopApi;
      const sessionId =
        known ??
        (yield* desktop['Chat.startSession']({
          provider: 'Claude',
          cwd,
          ...(resume !== undefined ? { resume } : {}),
          ...(model !== null ? { model } : {}),
          effort,
          permissionMode,
        }));
      yield* remember(sessionId);
      yield* Stream.runForEach(desktop['Chat.send']({ sessionId, text, files: [] }), apply);
    });

    void this.runtime.run(program).then(
      Exit.match({
        onFailure: (cause) =>
          this.chat.update((state) => ({ ...state, running: false, failure: Cause.pretty(cause) })),
        onSuccess: () => undefined,
      }),
    );
  }

  /** Shows a stored transcript. The next message continues that session; a subagent transcript is read-only. */
  showTranscript(ref: TranscriptRef): void {
    this.resetSession();
    this.selectedSessionId.set(ref.sessionId);
    this.resumeFrom = ref.subagent === undefined ? ref.sessionId : undefined;
    void this.call(
      (desktop) => desktop['Sessions.history']({ ref }),
      (history) => this.chat.set(chatStateFromHistory(history)),
      (cause) => this.chat.set({ ...initialChatState, failure: Cause.pretty(cause) }),
    );
  }

  /** A Session chip was picked: show its main transcript. */
  openSession(id: string): void {
    const session = this.sessions().find((s) => s.sessionId === id);
    if (session !== undefined) this.showTranscript({ projectId: session.projectId, sessionId: session.sessionId });
  }

  clearChat(): void {
    this.resetSession();
    this.selectedSessionId.set(undefined);
    this.resumeFrom = undefined;
    this.chat.set(initialChatState);
  }

  answerPermission(response: PermissionResponse): void {
    const sessionId = this.sessionId;
    if (sessionId === undefined) return;
    void this.call((desktop) => desktop['Chat.resolvePermission']({ sessionId, response }), () => undefined);
  }

  stop(): void {
    const sessionId = this.sessionId;
    if (sessionId === undefined) return;
    void this.call((desktop) => desktop['Chat.interrupt']({ sessionId }), () => undefined);
  }
}
