import { FormControl } from '@angular/forms';
import type { PermissionMode, SessionOptions } from '../../../shared/chat/session.model';
import type { SelectOption } from '../../shared/ui/select/select.types';
import { I18n } from '../../core/i18n';
import { pillView } from '../shell/pill-view';
import { DestroyRef, Injectable, computed, effect, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import type { AdapterCapabilities, Effort, ModelInfo, ProviderId } from '../../../shared/chat/provider.model';
import { Cause, Effect, Exit, Stream } from 'effect';
import type { AppInfo } from '../../../shared/app-info/app-info.rpc';
import type { ChatEvent } from '../../../shared/chat/event.model';
import type { MessageKey } from '../../core/i18n-dictionaries';
import type { AttachmentId } from '../../../shared/attachments/attachment.model';
import type { SessionId } from '../../../shared/chat/ids.model';
import type { PermissionResponse } from '../../../shared/chat/permission.model';
import { DesktopApi, type DesktopApiShape } from '../../core/desktop-api';
import { EffectRuntime } from '../../core/effect-runtime';
import type { CommandsState } from './slash-commands';
import { entriesFromPaths, type FilesState } from './file-mentions';
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

/** The most images one message can carry. */
export const MAX_IMAGES = 5;

/** Files bigger than this are not even read: main would refuse them after the renderer had loaded them whole. */
const MAX_FILE_BYTES = 50 * 1024 * 1024;

/** An image added to the draft: stored in main under `id`, shown from the bytes the renderer already has. */
export interface DraftImage {
  readonly id: AttachmentId;
  readonly url: string;
}

/** How starting a new Session came out. */
export type NewSessionOutcome =
  | { readonly status: 'started'; readonly sessionId: SessionId }
  | { readonly status: 'busy' }
  | { readonly status: 'failed'; readonly detail: string };

/** Owns the live chat so it survives Window mode switches (the Pill reads it too). */
@Injectable({ providedIn: 'root' })
export class ChatController {
  private readonly runtime = inject(EffectRuntime);
  private readonly i18n = inject(I18n);
  private sessionId: SessionId | undefined;
  /** Stored session the next `startSession` continues; set while a past transcript is shown. */
  private resumeFrom: SessionId | undefined;
  /** Folder of the stored session the next `startSession` continues, when it is not the app's own cwd. */
  private resumeCwd: string | undefined;
  /** Bumped per transcript load so a slower, older response cannot overwrite a newer pick. */
  private transcriptLoad = 0;

  readonly info = signal<AppInfo | null>(null);
  readonly error = signal<string | null>(null);
  readonly chat = signal<ChatState>(initialChatState);
  readonly draft = signal('');
  /** Images of the draft, in the order they were stored. */
  readonly images = signal<ReadonlyArray<DraftImage>>([]);
  readonly commands = signal<CommandsState>({ status: 'loading' });
  /** Files the `@` popup offers; loaded the first time the user types `@` in the Session's folder. */
  readonly files = signal<FilesState>({ status: 'idle' });
  private filesCwd: string | undefined;
  /** Bumped per file-list request and per invalidation, so an out-of-date response is dropped. */
  private filesLoad = 0;

  private readonly models = signal<ReadonlyArray<ModelInfo>>([]);
  private readonly capabilities = signal<AdapterCapabilities | undefined>(undefined);
  /**
   * Whether the chosen model takes images: its own `images` wins over the adapter's. Until the answer is known
   * it is assumed so; main refuses a send that should not have gone through.
   */
  readonly imagesAllowed = computed(
    () => this.models().find((m) => m.id === this.selectedModel())?.images ?? this.capabilities()?.images ?? true,
  );
  /** Images are waiting in the draft that the chosen model cannot take: Send is blocked until they go. */
  readonly imagesBlocked = computed(() => !this.imagesAllowed() && this.images().length > 0);
  readonly selectedModel = signal<string | null>(null);
  /** Mirrors `effortControl` for views that draw it (the control itself is not reactive). */
  readonly selectedEffort = signal<Effort>('Default');
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
  /** Icons are 16x16 stroke paths: bolt, double check, lock, checklist. */
  readonly permissionOptions: SelectOption<PermissionMode>[] = [
    { value: 'Auto', label: 'Auto mode', icon: 'M9 2L4 9h4l-1 5 5-7H8z' },
    { value: 'AutoAccept', label: 'Auto accept', icon: 'M1.5 8.5l3 3L10 6M7 11.5l1 1L14.5 6' },
    { value: 'Default', label: 'Default', icon: 'M4 7h8v6H4zM6 7V5a2 2 0 0 1 4 0v2' },
    { value: 'Plan', label: 'Plan', icon: 'M3 3h10v10H3zM5.5 6h5M5.5 8.5h5M5.5 11h3' },
  ];
  readonly permissionControl = new FormControl<PermissionMode>('Default', { nonNullable: true });
  /** The Provider the next Session starts with; an open Session keeps the one it was created with. */
  readonly provider = signal<ProviderId>('Claude');
  readonly providerOptions: SelectOption<ProviderId>[] = [
    { value: 'Claude', label: 'Claude' },
    { value: 'OpenCode', label: 'OpenCode' },
  ];
  /** A Session never changes Provider: once one is open (or a Turn runs), only a new chat can pick another. */
  readonly providerLocked = computed(() => this.running() || (this.selectedSessionId() !== undefined && !this.hasNothingSaid()));
  /** False while a stored transcript is still loading: what is on screen is not that Session's yet. */
  private readonly transcriptReady = signal(true);
  /** The open Session is a main one; a subagent transcript is read-only and belongs to its parent. */
  private readonly replaceable = signal(true);
  /** The open Session has no messages, however it was opened: nothing is bound to its Provider yet. */
  private readonly hasNothingSaid = computed(() => {
    const chat = this.chat();
    return this.replaceable() && this.transcriptReady() && chat.items.length === 0 && !chat.failure && !chat.running;
  });
  /** Why the chosen Provider cannot be used (not installed, not signed in); the previous Provider stays active. */
  readonly providerError = signal<string | null>(null);
  readonly tree = computed(() => groupByOwner(this.chat()));
  readonly blocks = computed(() => chatBlocks(this.chat(), this.tree()));

  /** Sessions of the current project, newest first as the list RPC returns them. */
  readonly sessions = signal<ReadonlyArray<SessionSummary>>([]);
  /** The Session whose transcript is on screen; undefined for a fresh chat. */
  readonly selectedSessionId = signal<SessionId | undefined>(undefined);
  readonly sessionChips = computed(() => sessionChips(this.sessions(), this.selectedSessionId()));
  /** The session the user is talking to right now (not a stored transcript being read), if it is one of `sessions`. */
  readonly liveSession = computed(() => {
    const sessionId = this.selectedSessionId();
    if (sessionId === undefined || this.chat().stored) return undefined;
    return this.sessions().find((session) => session.sessionId === sessionId);
  });

  /** Only flips on a real transition, so effects reading it do not re-run on every streamed delta. */
  private readonly running = computed(() => this.chat().running);
  private readonly turnStartedAt = signal(0);
  private readonly now = signal(Date.now());
  readonly pill = computed(() => pillView(this.chat(), this.now() - this.turnStartedAt(), this.i18n.t('chat.working')));

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
    void this.call((desktop) => desktop['Chat.capabilities'](), (capabilities) => this.capabilities.set(capabilities), () => undefined);
    // Files edited outside Timmy show up in the next `@`.
    const onFocus = () => this.invalidateFiles();
    window.addEventListener('focus', onFocus);
    inject(DestroyRef).onDestroy(() => window.removeEventListener('focus', onFocus));

    this.modelControl.valueChanges.pipe(takeUntilDestroyed()).subscribe((id) => {
      this.selectedModel.set(id);
      if (!this.effortsOf(id).includes(this.effortControl.value)) {
        this.effortControl.setValue('Default', { emitEvent: false });
        this.selectedEffort.set('Default');
      }
      this.resetSession();
    });
    this.effortControl.valueChanges.pipe(takeUntilDestroyed()).subscribe((effort) => {
      this.selectedEffort.set(effort);
      this.resetSession();
    });
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

  /**
   * Makes `provider` the active one in main and shows its models. On failure (not installed, not signed in) the
   * Adapter's own error is shown and the previous Provider stays chosen.
   */
  /** The user picked a Provider for the next Session. Ignored while one is open. */
  setProvider(provider: ProviderId): void {
    if (this.providerLocked() || provider === this.provider()) return;
    const cwd = this.resumeCwd ?? this.info()?.cwd;
    // A Session with nothing said is replaced; with none open the next one simply starts on the new Provider.
    if (this.selectedSessionId() === undefined || cwd === undefined) void this.switchProvider(provider);
    else void this.replaceEmptySession(cwd, provider);
  }

  /** An empty Session belongs to the old Provider: drop it, switch, and start the same folder's Session again. */
  private async replaceEmptySession(cwd: string, provider: ProviderId): Promise<void> {
    const old = this.sessionId ?? this.resumeFrom ?? this.selectedSessionId();
    this.sessionId = undefined;
    this.resumeFrom = undefined;
    this.selectedSessionId.set(undefined);
    if (old !== undefined) {
      await this.runtime.run(
        Effect.flatMap(DesktopApi, (desktop) =>
          desktop['Chat.closeSession']({ sessionId: old }).pipe(
            Effect.andThen(desktop['Sessions.delete']({ sessionId: old })),
            Effect.ignore,
          ),
        ),
      );
    }
    await this.switchProvider(provider);
    // The new Provider is not available: the Session goes on with the one that is.
    await this.startNewSession(cwd);
  }

  private async switchProvider(provider: ProviderId): Promise<void> {
    if (provider === this.provider() || this.chat().running) return;
    const exit = await this.runtime.run(
      Effect.gen(function* () {
        const desktop = yield* DesktopApi;
        const capabilities = yield* desktop['Chat.changeAdapter']({ provider }).pipe(
          Effect.catchTag('ChatError', (error) => Effect.succeed(error.detail)),
        );
        if (typeof capabilities === 'string') return capabilities;
        const models = yield* desktop['Chat.models']().pipe(Effect.catchTag('ChatError', () => Effect.succeed([])));
        return { capabilities, models };
      }),
    );
    if (Exit.isFailure(exit)) {
      this.providerError.set(Cause.pretty(exit.cause));
      return;
    }
    if (typeof exit.value === 'string') {
      this.providerError.set(exit.value);
      return;
    }
    this.providerError.set(null);
    this.provider.set(provider);
    this.capabilities.set(exit.value.capabilities);
    this.models.set(exit.value.models);
    // The other Provider's model ids mean nothing here.
    this.modelControl.setValue(null, { emitEvent: false });
    this.selectedModel.set(null);
    this.effortControl.setValue('Default', { emitEvent: false });
    this.selectedEffort.set('Default');
    const cwd = this.resumeCwd ?? this.info()?.cwd;
    if (cwd !== undefined) this.loadCommands(cwd);
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

  /** Loads the file list for the `@` popup if the folder has none yet. */
  requestFiles(): void {
    const cwd = this.resumeCwd ?? this.info()?.cwd;
    if (cwd === undefined || (this.filesCwd === cwd && this.files().status !== 'idle')) return;
    this.filesCwd = cwd;
    const load = ++this.filesLoad;
    this.files.set({ status: 'loading' });
    void this.call(
      // Keep the error's detail: the popup shows it instead of an opaque trace.
      (desktop) =>
        desktop['Files.list']({ cwd }).pipe(
          Effect.map((list): FilesState => ({ status: 'ready', entries: entriesFromPaths(list.paths), truncated: list.truncated })),
          Effect.catchTag('FilesError', (error) => Effect.succeed<FilesState>({ status: 'failed', detail: error.detail })),
        ),
      (state) => {
        if (load === this.filesLoad) this.files.set(state);
      },
      (cause) => {
        if (load === this.filesLoad) this.files.set({ status: 'failed', detail: Cause.pretty(cause) });
      },
    );
  }

  /** Drops the file list so the next `@` fetches a fresh one. There is no file watcher. */
  private invalidateFiles(): void {
    this.filesLoad++;
    this.files.set({ status: 'idle' });
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

  /** Images being stored in main, which already count against the limit. */
  private storing = 0;

  /** Why attaching failed, for the modal that tells the user. Each reason appears once. */
  readonly attachErrors = signal<ReadonlyArray<MessageKey>>([]);

  private failAttach(key: MessageKey): void {
    this.attachErrors.update((keys) => (keys.includes(key) ? keys : [...keys, key]));
  }

  dismissAttachErrors(): void {
    this.attachErrors.set([]);
  }

  /**
   * Stores each image in main and shows it above the composer. A batch that would pass the limit is
   * refused whole; what main refuses is left out, and the user is told why in a modal.
   */
  addImages(files: ReadonlyArray<Blob>): void {
    if (files.length === 0) return;
    if (!this.imagesAllowed()) {
      this.failAttach('chat.imagesUnsupported');
      return;
    }
    if (files.length > MAX_IMAGES - this.images().length - this.storing) {
      this.failAttach('chat.attachTooMany');
      return;
    }
    for (const file of files) {
      if (file.size > MAX_FILE_BYTES) {
        this.failAttach('chat.attachTooLarge');
        continue;
      }
      this.storing++;
      const url = URL.createObjectURL(file);
      const program = Effect.gen(function* () {
        const desktop = yield* DesktopApi;
        const bytes = yield* Effect.promise(async () => new Uint8Array(await file.arrayBuffer()));
        return yield* desktop['Attachments.add']({ bytes }).pipe(
          Effect.catchTag('AttachmentsError', (error) => Effect.succeed({ refused: error.reason })),
        );
      });
      void this.runtime.run(program).then((exit) => {
        this.storing--;
        if (Exit.isSuccess(exit) && 'id' in exit.value) {
          const { id } = exit.value;
          this.images.update((list) => [...list, { id, url }]);
          return;
        }
        URL.revokeObjectURL(url);
        const reason = Exit.isSuccess(exit) && 'refused' in exit.value ? exit.value.refused : undefined;
        this.failAttach(reason === 'TooLarge' ? 'chat.attachTooLarge' : 'chat.attachFailed');
      });
    }
  }

  /** The image shown enlarged, if any. */
  readonly lightbox = signal<string | undefined>(undefined);

  /** Takes the image out of the draft and deletes its stored file. */
  removeImage(id: AttachmentId): void {
    const image = this.images().find((candidate) => candidate.id === id);
    if (image === undefined) return;
    this.images.update((list) => list.filter((candidate) => candidate.id !== id));
    URL.revokeObjectURL(image.url);
    void this.call((desktop) => desktop['Attachments.remove']({ id }), () => undefined);
  }

  /** Whether the "send without text?" question is open. */
  readonly confirmingImageOnly = signal(false);

  /** Sends the draft. Images with no text ask first; `confirmedSend` is the answer. */
  send(): void {
    this.sendDraft(false);
  }

  confirmedSend(): void {
    this.confirmingImageOnly.set(false);
    this.sendDraft(true);
  }

  cancelImageOnly(): void {
    this.confirmingImageOnly.set(false);
  }

  private sendDraft(confirmed: boolean): void {
    const draft = this.draft();
    const text = draft.trim();
    const cwd = this.resumeCwd ?? this.info()?.cwd;
    const sentImages = this.images();
    if ((text === '' && sentImages.length === 0) || cwd === undefined || this.chat().running || this.imagesBlocked()) return;
    if (text === '' && !confirmed) {
      this.confirmingImageOnly.set(true);
      return;
    }

    const before = this.chat();
    this.draft.set('');
    this.images.set([]);
    this.turnStartedAt.set(Date.now());
    this.now.set(Date.now());
    this.chat.update((state) => ({ ...addUserMessage(state, text, sentImages.map(({ url }) => ({ url }))), running: true }));

    const apply = (event: ChatEvent) =>
      Effect.sync(() => {
        this.chat.update((state) => reduceChat(state, event));
        // The agent may have created files during the Turn.
        if (event._tag === 'TurnFinished') this.invalidateFiles();
      });
    const known = this.sessionId;
    const provider = this.provider();
    const resume = this.resumeFrom;
    const model = this.modelControl.value;
    const permissionMode = this.permissionControl.value;
    const effort = this.effortControl.value;
    const remember = (id: SessionId) =>
      Effect.sync(() => {
        this.sessionId = id;
        this.selectedSessionId.set(resume ?? id);
      });

    const imagesUnsupported = this.i18n.t('chat.imagesUnsupported');
    // No Turn started: take the message back out of the transcript and give the draft back.
    const rejectMentions = (detail: string) =>
      Effect.sync(() => {
        this.chat.set({ ...before, failure: detail });
        if (this.draft() === '') this.draft.set(draft);
        // The images are still stored, so they go back to the draft as they were.
        if (this.images().length === 0) this.images.set(sentImages);
        else for (const image of sentImages) URL.revokeObjectURL(image.url);
      });

    const program = Effect.gen(function* () {
      const desktop = yield* DesktopApi;
      const sessionId =
        known ??
        (yield* desktop['Chat.startSession']({
          provider,
          cwd,
          ...(resume !== undefined ? { resume } : {}),
          ...(model !== null ? { model } : {}),
          effort,
          permissionMode,
        }));
      yield* remember(sessionId);
      yield* Stream.runForEach(desktop['Chat.send']({ sessionId, text, mentions: [], attachments: sentImages.map(({ id }) => ({ id })) }), apply).pipe(
        Effect.catchTag('ChatError', (error) =>
          error.reason === 'InvalidMention'
            ? rejectMentions(error.detail)
            : error.reason === 'ImagesUnsupported'
              ? rejectMentions(imagesUnsupported)
              : Effect.fail(error),
        ),
      );
    });

    void this.runtime.run(program).then((exit) => {
      if (Exit.isFailure(exit)) {
        this.chat.update((state) => ({ ...state, running: false, failure: Cause.pretty(exit.cause) }));
      }
    });
  }

  /**
   * Shows a stored transcript. The next message continues that session, in `cwd` when the session belongs to
   * another folder than the app's; a subagent transcript is read-only. Does nothing, and says so, while a Turn runs.
   */
  showTranscript(ref: TranscriptRef, cwd?: string, provider?: ProviderId): boolean {
    if (this.chat().running) return false;
    const load = ++this.transcriptLoad;
    this.transcriptReady.set(false);
    this.replaceable.set(ref.subagent === undefined);
    this.resetSession();
    // A Session keeps the Provider it was created with, so its next message goes to that Provider's Adapter.
    if (provider !== undefined && provider !== this.provider()) void this.switchProvider(provider);
    this.selectedSessionId.set(ref.sessionId);
    this.resumeFrom = ref.subagent === undefined ? ref.sessionId : undefined;
    this.resumeCwd = ref.subagent === undefined ? cwd : undefined;
    void this.call(
      (desktop) => desktop['Sessions.history']({ ref }),
      (history) => {
        if (load !== this.transcriptLoad) return;
        this.chat.set(chatStateFromHistory(history));
        this.transcriptReady.set(true);
      },
      (cause) => {
        if (load !== this.transcriptLoad) return;
        this.chat.set({ ...initialChatState, failure: Cause.pretty(cause) });
        this.transcriptReady.set(true);
      },
    );
    return true;
  }

  /** Opens a stored session of any project in the chat. False while a Turn runs, which cannot be switched away from. */
  openStoredSession(session: SessionSummary): boolean {
    return this.showTranscript({ projectId: session.projectId, sessionId: session.sessionId }, session.cwd, session.provider);
  }

  /**
   * Starts a Session in `cwd` and makes it the open one, with an empty conversation; the first message names it.
   * Nothing changes while a Turn runs, which cannot be switched away from, or when the session cannot start.
   */
  async startNewSession(cwd: string): Promise<NewSessionOutcome> {
    if (this.chat().running) return { status: 'busy' };
    const model = this.modelControl.value;
    const options: SessionOptions = {
      provider: this.provider(),
      cwd,
      ...(model !== null ? { model } : {}),
      effort: this.effortControl.value,
      permissionMode: this.permissionControl.value,
    };
    const exit = await this.runtime.run(Effect.flatMap(DesktopApi, (desktop) => desktop['Chat.startSession'](options)));
    if (Exit.isFailure(exit)) return { status: 'failed', detail: Cause.pretty(exit.cause) };
    const sessionId = exit.value;
    if (this.chat().running) {
      void this.call((desktop) => desktop['Chat.closeSession']({ sessionId }), () => undefined);
      return { status: 'busy' };
    }
    this.transcriptLoad++;
    this.transcriptReady.set(true);
    this.replaceable.set(true);
    this.resetSession();
    this.sessionId = sessionId;
    this.selectedSessionId.set(sessionId);
    this.resumeFrom = undefined;
    this.resumeCwd = cwd;
    this.chat.set(initialChatState);
    return { status: 'started', sessionId };
  }

  /** A Session chip was picked: show its main transcript. */
  openSession(id: string): void {
    const session = this.sessions().find((s) => s.sessionId === id);
    if (session !== undefined) {
      this.showTranscript({ projectId: session.projectId, sessionId: session.sessionId }, undefined, session.provider);
    }
  }

  clearChat(): void {
    this.transcriptReady.set(true);
    this.transcriptLoad++;
    this.resetSession();
    this.selectedSessionId.set(undefined);
    this.resumeFrom = undefined;
    this.resumeCwd = undefined;
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
