import { Injectable, signal } from '@angular/core';
import { Schema } from 'effect';
import type { MessageKey } from './i18n-dictionaries';

export type ToastTone = 'success' | 'info' | 'warning' | 'error';

export const ToastId = Schema.Number.pipe(Schema.brand('ToastId'));
export type ToastId = typeof ToastId.Type;

/** What a caller says about a toast. Title and body are dictionary keys, so they follow the language. */
export interface ToastOptions {
  readonly tone: ToastTone;
  /** What happened and what to do. */
  readonly body: MessageKey;
  readonly params?: Readonly<Record<string, string | number>>;
  /** The one word naming the kind; the tone's own word when left out. */
  readonly title?: MessageKey;
  /** Technical text for whoever digs further (shown as a tooltip), never the message itself. */
  readonly detail?: string;
  /** How long it stays, in ms. `null` keeps it until the user dismisses it. */
  readonly durationMs?: number | null;
}

export interface Toast {
  readonly id: ToastId;
  readonly tone: ToastTone;
  readonly title: MessageKey;
  readonly body: MessageKey;
  readonly params: Readonly<Record<string, string | number>> | undefined;
  readonly detail: string | undefined;
}

/** The toasts on screen at once. */
export const MAX_TOASTS = 3;
export const DEFAULT_DURATION_MS = 6000;
export const ERROR_DURATION_MS = 8000;

/**
 * What happens when a toast arrives and the stack is full. The stack is ordered oldest first; this one
 * policy drops the oldest, so the newest `MAX_TOASTS` remain. To refuse the newcomer instead, return
 * `stack` when it is full.
 */
export const admit = (stack: ReadonlyArray<Toast>, incoming: Toast): ReadonlyArray<Toast> => [...stack, incoming].slice(-MAX_TOASTS);

const titles = {
  success: 'toast.title.success',
  info: 'toast.title.info',
  warning: 'toast.title.warning',
  error: 'toast.title.error',
} as const satisfies Record<ToastTone, MessageKey>;

/** The results of the user's actions, shown as a short stack of notifications. */
@Injectable({ providedIn: 'root' })
export class ToastService {
  private readonly stack = signal<ReadonlyArray<Toast>>([]);
  /** Oldest first. */
  readonly toasts = this.stack.asReadonly();

  private readonly timers = new Map<ToastId, ReturnType<typeof setTimeout>>();
  private nextId = 1;

  /** Shows a toast and returns its id. */
  show(options: ToastOptions): ToastId {
    const id = ToastId.make(this.nextId++);
    const toast: Toast = {
      id,
      tone: options.tone,
      title: options.title ?? titles[options.tone],
      body: options.body,
      params: options.params,
      detail: options.detail,
    };
    const before = this.stack();
    const after = admit(before, toast);
    // A toast the policy dropped must not leave a timer behind that could fire later.
    for (const gone of before) if (!after.some((kept) => kept.id === gone.id)) this.stopTimer(gone.id);
    this.stack.set(after);
    if (after.some((kept) => kept.id === id)) this.startTimer(id, options);
    return id;
  }

  success(body: MessageKey, extra: Omit<ToastOptions, 'tone' | 'body'> = {}): ToastId {
    return this.show({ ...extra, tone: 'success', body });
  }

  info(body: MessageKey, extra: Omit<ToastOptions, 'tone' | 'body'> = {}): ToastId {
    return this.show({ ...extra, tone: 'info', body });
  }

  warning(body: MessageKey, extra: Omit<ToastOptions, 'tone' | 'body'> = {}): ToastId {
    return this.show({ ...extra, tone: 'warning', body });
  }

  error(body: MessageKey, extra: Omit<ToastOptions, 'tone' | 'body'> = {}): ToastId {
    return this.show({ ...extra, tone: 'error', body });
  }

  /** Removes a toast; an id that is already gone is ignored. */
  dismiss(id: ToastId): void {
    this.stopTimer(id);
    this.stack.update((stack) => stack.filter((toast) => toast.id !== id));
  }

  private startTimer(id: ToastId, options: ToastOptions): void {
    const duration = options.durationMs === undefined ? (options.tone === 'error' ? ERROR_DURATION_MS : DEFAULT_DURATION_MS) : options.durationMs;
    if (duration === null) return;
    this.timers.set(
      id,
      setTimeout(() => this.dismiss(id), duration),
    );
  }

  private stopTimer(id: ToastId): void {
    const timer = this.timers.get(id);
    if (timer === undefined) return;
    clearTimeout(timer);
    this.timers.delete(id);
  }
}
