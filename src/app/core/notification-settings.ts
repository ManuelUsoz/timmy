import { Injectable, inject, signal } from '@angular/core';
import { Cause, Effect, Exit } from 'effect';
import type { AlertType, Channel, ChannelChange, ChannelsSettings } from '../../shared/settings/settings.model';
import { DesktopApi } from './desktop-api';
import { EffectRuntime } from './effect-runtime';
import { ToastService } from './toast';

/** What the renderer knows about how the user configured the Channels. */
export type NotificationSettingsState =
  | { readonly status: 'loading' }
  | { readonly status: 'failed'; readonly detail: string }
  | { readonly status: 'ready'; readonly channels: ChannelsSettings };

/**
 * How each Channel alerts, kept in main. A change is shown once main has stored it, so what the screen says is always
 * what survives a restart; if main cannot store it, nothing changes and a toast says so.
 */
@Injectable({ providedIn: 'root' })
export class NotificationSettings {
  private readonly runtime = inject(EffectRuntime);
  private readonly toasts = inject(ToastService);

  private readonly current = signal<NotificationSettingsState>({ status: 'loading' });
  readonly state = this.current.asReadonly();

  constructor() {
    void this.runtime.run(Effect.flatMap(DesktopApi, (desktop) => desktop['Settings.get']())).then((exit) => {
      // A change made while the first read was in flight is newer than the read.
      if (this.current().status !== 'loading') return;
      this.current.set(Exit.isSuccess(exit) ? { status: 'ready', channels: exit.value.channels } : { status: 'failed', detail: Cause.pretty(exit.cause) });
    });
  }

  /** Switches a Channel on or off. */
  setEnabled(channel: Channel, enabled: boolean): void {
    this.change(channel, { _tag: 'Switch', enabled });
  }

  /** Switches whether a Channel alerts for one type. */
  setType(channel: Channel, type: AlertType, enabled: boolean): void {
    this.change(channel, { _tag: 'Type', type, enabled });
  }

  /** Main answers each change with the whole settings; only the answer to the newest change is current. */
  private issued = 0;
  private applied = 0;

  private change(channel: Channel, change: ChannelChange): void {
    const sequence = ++this.issued;
    void this.runtime
      .run(Effect.flatMap(DesktopApi, (desktop) => desktop['Settings.setChannel']({ channel, change })))
      .then((exit) => {
        if (Exit.isSuccess(exit)) {
          if (sequence < this.applied) return;
          this.applied = sequence;
          this.current.set({ status: 'ready', channels: exit.value.channels });
        } else this.toasts.error('settings.notifications.saveFailed', { detail: Cause.pretty(exit.cause) });
      });
  }
}
