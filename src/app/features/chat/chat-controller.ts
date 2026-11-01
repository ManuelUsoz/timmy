import { FormControl } from '@angular/forms';
import type { PermissionMode, SessionOptions } from '../../../shared/chat/session.model';
import type { SelectOption } from '../../shared/ui/select/select.types';
import { I18n } from '../../core/i18n';
import { pillView } from '../shell/pill-view';
import { DestroyRef, Injectable, computed, effect, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import type { Effort, ModelInfo } from '../../../shared/chat/provider.model';
import { Cause, Effect, Exit, Stream } from 'effect';
import type { AppInfo } from '../../../shared/app-info/app-info.rpc';
import type { ChatEvent } from '../../../shared/chat/event.model';
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

  /** Stores each image in main and shows it above the composer. What main refuses is dropped, with a note why. */
  addImages(files: ReadonlyArray<Blob>): void {
    const room = Math.max(0, MAX_IMAGES - this.images().length - this.storing);
    if (files.length > room) this.error.set(this.i18n.t('chat.attachTooMany'));
    for (const file of files.slice(0, room)) {
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
        this.error.set(this.i18n.t(reason === 'TooLarge' ? 'chat.attachTooLarge' : 'chat.attachFailed'));
      });
    }
  }

  /** Takes the image out of the draft and deletes its stored file. */
  removeImage(id: AttachmentId): void {
    const image = this.images().find((candidate) => candidate.id === id);
    if (image === undefined) return;
    this.images.update((list) => list.filter((candidate) => candidate.id !== id));
    URL.revokeObjectURL(image.url);
    void this.call((desktop) => desktop['Attachments.remove']({ id }), () => undefined);
  }

  send(): void {
    const draft = this.draft();
    const text = draft.trim();
    const cwd = this.resumeCwd ?? this.info()?.cwd;
    const sentImages = this.images();
    if ((text === '' && sentImages.length === 0) || cwd === undefined || this.chat().running) return;

    const before = this.chat();
    this.draft.set('');
    this.images.set([]);
    this.turnStartedAt.set(Date.now());
    this.now.set(Date.now());
    this.chat.update((state) => ({ ...addUserMessage(state, text), running: true }));

    const apply = (event: ChatEvent) =>
      Effect.sync(() => {
        this.chat.update((state) => reduceChat(state, event));
        // The agent may have created files during the Turn.
        if (event._tag === 'TurnFinished') this.invalidateFiles();
      });
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

    let restored = false;
    // No Turn started: take the message back out of the transcript and give the draft back.
    const rejectMentions = (detail: string) =>
      Effect.sync(() => {
        this.chat.set({ ...before, failure: detail });
        if (this.draft() === '') this.draft.set(draft);
        // The images are still stored, so they go back to the draft as they were.
        if (this.images().length === 0) this.images.set(sentImages);
        restored = true;
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
      yield* Stream.runForEach(desktop['Chat.send']({ sessionId, text, mentions: [], attachments: sentImages.map(({ id }) => ({ id })) }), apply).pipe(
        Effect.catchTag('ChatError', (error) =>
          error.reason === 'InvalidMention' ? rejectMentions(error.detail) : Effect.fail(error),
        ),
      );
    });

    void this.runtime.run(program).then((exit) => {
      // The thumbnails are done with unless they went back to the draft.
      if (!restored) for (const image of sentImages) URL.revokeObjectURL(image.url);
      if (Exit.isFailure(exit)) {
        this.chat.update((state) => ({ ...state, running: false, failure: Cause.pretty(exit.cause) }));
      }
    });
  }

  /**
   * Shows a stored transcript. The next message continues that session, in `cwd` when the session belongs to
   * another folder than the app's; a subagent transcript is read-only. Does nothing, and says so, while a Turn runs.
   */
  showTranscript(ref: TranscriptRef, cwd?: string): boolean {
    if (this.chat().running) return false;
    const load = ++this.transcriptLoad;
    this.resetSession();
    this.selectedSessionId.set(ref.sessionId);
    this.resumeFrom = ref.subagent === undefined ? ref.sessionId : undefined;
    this.resumeCwd = ref.subagent === undefined ? cwd : undefined;
    void this.call(
      (desktop) => desktop['Sessions.history']({ ref }),
      (history) => load === this.transcriptLoad && this.chat.set(chatStateFromHistory(history)),
      (cause) => load === this.transcriptLoad && this.chat.set({ ...initialChatState, failure: Cause.pretty(cause) }),
    );
    return true;
  }

  /** Opens a stored session of any project in the chat. False while a Turn runs, which cannot be switched away from. */
  openStoredSession(session: SessionSummary): boolean {
    return this.showTranscript({ projectId: session.projectId, sessionId: session.sessionId }, session.cwd);
  }

  /**
   * Starts a Session in `cwd` and makes it the open one, with an empty conversation; the first message names it.
   * Nothing changes while a Turn runs, which cannot be switched away from, or when the session cannot start.
   */
  async startNewSession(cwd: string): Promise<NewSessionOutcome> {
    if (this.chat().running) return { status: 'busy' };
    const model = this.modelControl.value;
    const options: SessionOptions = {
      provider: 'Claude',
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
    if (session !== undefined) this.showTranscript({ projectId: session.projectId, sessionId: session.sessionId });
  }

  clearChat(): void {
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
