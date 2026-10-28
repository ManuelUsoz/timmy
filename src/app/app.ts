import { JsonPipe, NgTemplateOutlet } from '@angular/common';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { ButtonComponent } from './shared/ui/button/button';
import { SelectComponent } from './shared/ui/select/select';
import type { SelectGroup, SelectOption } from './shared/ui/select/select.types';
import { ChipComponent } from './shared/ui/chip/chip';
import { TagComponent } from './shared/ui/tag/tag';
import { StateComponent } from './shared/ui/state/state';
import { CheckboxComponent } from './shared/ui/checkbox/checkbox';
import { AvatarComponent } from './shared/ui/avatar/avatar';
import { LogoComponent } from './shared/ui/logo/logo';
import { MenuComponent } from './shared/ui/menu/menu';
import { OptionComponent } from './shared/ui/menu/option';
import { OptionGroupComponent } from './shared/ui/menu/option-group';
import { PillComponent, type PillTone } from './shared/ui/pill/pill';
import { SessionComponent } from './shared/ui/session/session';
import { Component, computed, inject, signal } from '@angular/core';
import { Cause, Effect, Exit, Stream } from 'effect';
import type { AppInfo } from '../shared/app-info/app-info.rpc';
import type { ChatEvent } from '../shared/chat/event.model';
import type { AgentId, SessionId } from '../shared/chat/ids.model';
import type { PermissionResponse } from '../shared/chat/permission.model';
import { DesktopApi } from './core/desktop-api';
import { EffectRuntime } from './core/effect-runtime';
import { MarkdownPipe } from './features/chat/markdown.pipe';
import { addUserMessage, groupByOwner, initialChatState, reduceChat, type ChatState } from './features/chat/chat-state';

const CHAT_MODEL = 'claude-haiku-5-5';

@Component({
  imports: [
    NgTemplateOutlet,
    MarkdownPipe,
    JsonPipe,
    ReactiveFormsModule,
    ButtonComponent,
    SelectComponent,
    ChipComponent,
    TagComponent,
    StateComponent,
    CheckboxComponent,
    AvatarComponent,
    LogoComponent,
    MenuComponent,
    OptionComponent,
    OptionGroupComponent,
    PillComponent,
    SessionComponent,
  ],
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

  protected readonly kinds = ['primary', 'secondary', 'tertiary', 'ghost', 'danger'] as const;
  protected readonly sizes = ['sm', 'md', 'lg'] as const;
  protected readonly chipTones = ['blue', 'green', 'red', 'purple', 'outline', 'mono'] as const;
  protected readonly tagTones = ['green', 'blue', 'red', 'purple', 'gray'] as const;
  protected readonly stateTones = ['success', 'info', 'warning', 'error', 'merged', 'idle'] as const;
  protected readonly modelOptions: SelectOption<string>[] = [
    { value: 'opus', label: 'Claude Opus' },
    { value: 'sonnet', label: 'Claude Sonnet' },
    { value: 'haiku', label: 'Claude Haiku' },
    { value: 'legacy', label: 'Legacy model', disabled: true },
  ];
  protected readonly modelGroups: SelectGroup<string>[] = [
    {
      label: 'Anthropic',
      options: [
        { value: 'opus', label: 'Claude Opus' },
        { value: 'sonnet', label: 'Claude Sonnet' },
      ],
    },
    {
      label: 'Local',
      options: [
        { value: 'llama', label: 'Llama' },
        { value: 'qwen', label: 'Qwen', disabled: true },
      ],
    },
  ];
  protected readonly gSingle = new FormControl<string | null>('sonnet');
  protected readonly gMultiCount = new FormControl<string[]>(['opus', 'haiku']);
  protected readonly gMultiChips = new FormControl<string[]>(['opus', 'sonnet']);
  protected readonly gGrouped = new FormControl<string | null>(null);
  protected readonly gSm = new FormControl<string | null>(null);
  protected readonly gMd = new FormControl<string | null>(null);
  protected readonly gLg = new FormControl<string | null>(null);
  protected readonly gError = new FormControl<string | null>(null);
  protected readonly gDisabled = new FormControl<string | null>({ value: 'haiku', disabled: true });
  protected readonly gAccepted = new FormControl<boolean>(true);
  protected readonly removable = signal(['alpha', 'beta', 'gamma']);
  protected readonly menuSelected = signal<unknown>('sonnet');
  protected readonly menuMulti = signal<unknown[]>(['opus']);

  protected removeChip(item: string): void {
    this.removable.update((l) => l.filter((x) => x !== item));
  }

  protected toggleMulti(v: unknown): void {
    this.menuMulti.update((l) => (l.includes(v) ? l.filter((x) => x !== v) : [...l, v]));
  }

  protected readonly tree = computed(() => groupByOwner(this.chat()));

  protected readonly pill = computed((): { tone: PillTone; label: string } => {
    const state = this.chat();
    if (state.permission) return { tone: 'waiting', label: 'Asks' };
    if (state.running) return { tone: 'running', label: 'Live' };
    return { tone: 'neutral', label: 'Idle' };
  });

  protected readonly contextPercent =computed(() => {
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
