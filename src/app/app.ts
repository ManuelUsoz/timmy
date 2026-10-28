import { NgTemplateOutlet } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { Cause, Effect, Exit, Stream } from 'effect';
import type { AppInfo } from '../shared/app-info/app-info.rpc';
import type { ChatEvent } from '../shared/chat/event.model';
import type { AgentId, SessionId } from '../shared/chat/ids.model';
import type { PermissionOption, PermissionRequest, PermissionResponse } from '../shared/chat/permission.model';
import { DesktopApi } from './core/desktop-api';
import { EffectRuntime } from './core/effect-runtime';
import { MarkdownPipe } from './features/chat/markdown.pipe';
import { addUserMessage, groupByOwner, initialChatState, reduceChat, type ChatState } from './features/chat/chat-state';

const CHAT_MODEL = 'claude-haiku-5-5';

@Component({
  imports: [NgTemplateOutlet, MarkdownPipe],
  selector: 'app-root',
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App {
  private readonly runtime = inject(EffectRuntime);
  private sessionId: SessionId | undefined;

  protected readonly model = CHAT_MODEL;
  protected readonly info = signal<AppInfo | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly chat = signal<ChatState>(initialChatState);
  protected readonly draft = signal('');

  protected readonly tree = computed(() => groupByOwner(this.chat()));

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
        onSuccess: (appInfo) => this.info.set(appInfo),
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
    const remember = (id: SessionId) =>
      Effect.sync(() => {
        this.sessionId = id;
      });

    const program = Effect.gen(function* () {
      const desktop = yield* DesktopApi;
      const sessionId =
        known ??
        (yield* desktop['Chat.startSession']({ provider: 'Claude', cwd, model: CHAT_MODEL, permissionMode: 'Ask' }));
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

  protected answerPermission(request: PermissionRequest, option: PermissionOption | undefined): void {
    const sessionId = this.sessionId;
    if (sessionId === undefined) return;
    const response: PermissionResponse =
      option === undefined
        ? { _tag: 'Cancelled', requestId: request.id }
        : { _tag: 'Selected', requestId: request.id, optionId: option.id };
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
