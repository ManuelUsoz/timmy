import { NgTemplateOutlet } from '@angular/common';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { SelectComponent } from '../../shared/ui/select/select';
import type { PermissionMode } from '../../../shared/chat/session.model';
import type { SelectOption } from '../../shared/ui/select/select.types';
import { PillComponent, type PillTone } from '../../shared/ui/pill/pill';
import { SessionComponent } from '../../shared/ui/session/session';
import { Component, computed, effect, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import type { Effort, ModelInfo } from '../../../shared/chat/provider.model';
import { Cause, Effect, Exit, Stream } from 'effect';
import type { AppInfo } from '../../../shared/app-info/app-info.rpc';
import type { ChatEvent } from '../../../shared/chat/event.model';
import type { AgentId, SessionId } from '../../../shared/chat/ids.model';
import type { PermissionResponse } from '../../../shared/chat/permission.model';
import { DesktopApi } from '../../core/desktop-api';
import { EffectRuntime } from '../../core/effect-runtime';
import { ComposerInputComponent } from './composer-input';
import { MarkdownPipe } from './markdown.pipe';
import type { CommandsState } from './slash-commands';
import { SessionsSidebarComponent } from '../sessions/sessions-sidebar';
import { chatStateFromHistory } from '../sessions/history-state';
import type { TranscriptRef } from '../../../shared/sessions/sessions.model';
import { addUserMessage, groupByOwner, initialChatState, reduceChat, type ChatState } from './chat-state';

/** Display names live in the renderer; the adapter only knows model ids. */
const MODEL_LABELS: Readonly<Record<string, string>> = {
  'claude-opus-5-5': 'Claude Opus 5.5',
  'claude-sonnet-5-5': 'Claude Sonnet 5.5',
  'claude-haiku-5-5': 'Claude Haiku 5.5',
};

@Component({
  imports: [
    NgTemplateOutlet,
    MarkdownPipe,
    ComposerInputComponent,
    ReactiveFormsModule,
    SelectComponent,
    PillComponent,
    SessionComponent,
    SessionsSidebarComponent,
  ],
  selector: 'app-chat-view',
  templateUrl: './chat-view.html',
  styleUrl: './chat-view.css',
})
export class ChatViewComponent {
  private readonly runtime = inject(EffectRuntime);
  private sessionId: SessionId | undefined;
  /** Stored session the next `startSession` continues; set while a past transcript is shown. */
  private resumeFrom: SessionId | undefined;

  protected readonly info = signal<AppInfo | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly chat = signal<ChatState>(initialChatState);
  protected readonly draft = signal('');
  protected readonly commands = signal<CommandsState>({ status: 'loading' });

  private readonly models = signal<ReadonlyArray<ModelInfo>>([]);
  private readonly selectedModel = signal<string | null>(null);
  protected readonly modelOptions = computed((): SelectOption<string>[] =>
    this.models().map((m) => ({ value: m.id, label: MODEL_LABELS[m.id] ?? m.id })),
  );
  protected readonly modelControl = new FormControl<string | null>(null);
  protected readonly effortOptions = computed((): SelectOption<Effort>[] =>
    (this.models().find((m) => m.id === this.selectedModel())?.efforts ?? ['Default']).map((value) => ({
      value,
      label: value === 'XHigh' ? 'Extra high' : value,
    })),
  );
  protected readonly effortControl = new FormControl<Effort>('Default', { nonNullable: true });
  protected readonly permissionOptions: SelectOption<PermissionMode>[] = [
    { value: 'Auto', label: 'Auto mode' },
    { value: 'AutoAccept', label: 'Auto accept' },
    { value: 'Default', label: 'Default' },
    { value: 'Plan', label: 'Plan' },
  ];
  protected readonly permissionControl = new FormControl<PermissionMode>('Default', { nonNullable: true });
  protected readonly tree = computed(() => groupByOwner(this.chat()));

  protected readonly pill = computed((): { tone: PillTone; label: string } => {
    const state = this.chat();
    if (state.permission) return { tone: 'waiting', label: 'Asks' };
    if (state.running) return { tone: 'running', label: 'Live' };
    return { tone: 'neutral', label: 'Idle' };
  });

  protected readonly contextPercent = computed(() => {
    const context = this.chat().context;
    return context === undefined ? undefined : Math.round((context.usedTokens / context.maxTokens) * 100);
  });

  constructor() {
    const program = Effect.gen(function* () {
      const desktop = yield* DesktopApi;
      return yield* desktop['AppInfo.get']();
    });

    void this.runtime.run(program).then(
      Exit.match({
        onFailure: (cause) => this.error.set(Cause.pretty(cause)),
        onSuccess: (appInfo) => {
          this.info.set(appInfo);
          this.loadCommands(appInfo.cwd);
        },
      }),
    );

    const modelsProgram = Effect.gen(function* () {
      const desktop = yield* DesktopApi;
      return yield* desktop['Chat.models']();
    });

    void this.runtime.run(modelsProgram).then(
      Exit.match({
        onFailure: (cause) => this.error.set(Cause.pretty(cause)),
        onSuccess: (models) => this.models.set(models),
      }),
    );

    this.modelControl.valueChanges.pipe(takeUntilDestroyed()).subscribe((id) => {
      this.selectedModel.set(id);
      const efforts = this.models().find((m) => m.id === id)?.efforts ?? ['Default'];
      if (!efforts.includes(this.effortControl.value)) this.effortControl.setValue('Default', { emitEvent: false });
      this.resetSession();
    });
    this.effortControl.valueChanges.pipe(takeUntilDestroyed()).subscribe(() => this.resetSession());
    this.permissionControl.valueChanges.pipe(takeUntilDestroyed()).subscribe(() => this.resetSession());

    // A session cannot change options mid-turn: lock the selectors while one runs.
    // emitEvent: false keeps enable/disable from firing valueChanges (which would reset the session).
    effect(() => {
      const locked = this.chat().running;
      for (const control of [this.modelControl, this.effortControl, this.permissionControl]) {
        if (locked) control.disable({ emitEvent: false });
        else control.enable({ emitEvent: false });
      }
    });
  }

  private loadCommands(cwd: string): void {
    this.commands.set({ status: 'loading' });
    const program = Effect.gen(function* () {
      const desktop = yield* DesktopApi;
      return yield* desktop['Chat.commands']({ cwd });
    });
    void this.runtime.run(program).then(
      Exit.match({
        onFailure: (cause) => this.commands.set({ status: 'failed', detail: Cause.pretty(cause) }),
        onSuccess: (items) => this.commands.set({ status: 'ready', items }),
      }),
    );
  }

  private resetSession(): void {
    if (this.chat().running) return;
    const sessionId = this.sessionId;
    if (sessionId === undefined) return;
    this.sessionId = undefined;
    // The session stays the same across option changes: the next message resumes it.
    this.resumeFrom = sessionId;
    void this.runtime.run(
      Effect.gen(function* () {
        const desktop = yield* DesktopApi;
        yield* desktop['Chat.closeSession']({ sessionId });
      }),
    );
  }

  protected send(): void {
    const text = this.draft().trim();
    const cwd = this.info()?.cwd;
    if (text === '' || cwd === undefined || this.chat().running) return;

    this.draft.set('');
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
  protected showTranscript(ref: TranscriptRef): void {
    this.resetSession();
    this.resumeFrom = ref.subagent === undefined ? ref.sessionId : undefined;
    const program = Effect.gen(function* () {
      const desktop = yield* DesktopApi;
      return yield* desktop['Sessions.history']({ ref });
    });
    void this.runtime.run(program).then(
      Exit.match({
        onFailure: (cause) => this.chat.set({ ...initialChatState, failure: Cause.pretty(cause) }),
        onSuccess: (history) => this.chat.set(chatStateFromHistory(history)),
      }),
    );
  }

  protected clearChat(): void {
    this.resetSession();
    this.resumeFrom = undefined;
    this.chat.set(initialChatState);
  }

  protected answerPermission(response: PermissionResponse): void {
    const sessionId = this.sessionId;
    if (sessionId === undefined) return;
    void this.runtime.run(
      Effect.gen(function* () {
        const desktop = yield* DesktopApi;
        yield* desktop['Chat.resolvePermission']({ sessionId, response });
      }),
    );
  }

  protected agent(id: AgentId) {
    return this.chat().agents.get(id);
  }

  protected stop(): void {
    const sessionId = this.sessionId;
    if (sessionId === undefined) return;
    void this.runtime.run(
      Effect.gen(function* () {
        const desktop = yield* DesktopApi;
        yield* desktop['Chat.interrupt']({ sessionId });
      }),
    );
  }
}
