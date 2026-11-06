import { DestroyRef, Injectable, effect, inject, untracked } from '@angular/core';
import { Effect, Stream } from 'effect';
import { sourceKey, type Notification, type NotificationEvent } from '../../../shared/notification/notification.model';
import { allChannels, type Channel, type ChannelsSettings } from '../../../shared/settings/settings.model';
import { DesktopApi } from '../../core/desktop-api';
import { EffectRuntime } from '../../core/effect-runtime';
import { NotificationSettings } from '../../core/notification-settings';
import { alerts, news, type ChannelDelivery, type Heard } from './channel-alerts';
import { ToastChannel } from './toast-channel';

/**
 * The Channels as Subscribers of the Notification bus in main (ADR 0010). Each Notification of a Source entering a
 * status goes to every Channel the user's settings let it through; the settings are read as it arrives, so a change
 * applies to the next one. It lives as long as the app: a Channel alerts whatever the Window mode.
 */
@Injectable({ providedIn: 'root' })
export class Channels {
  private readonly runtime = inject(EffectRuntime);
  private readonly settings = inject(NotificationSettings);
  /** One delivery per Channel: adding a Channel adds its line here. */
  private readonly deliveries: Readonly<Record<Channel, ChannelDelivery>> = { Toast: inject(ToastChannel) };
  private heard: Heard = new Map();
  /** What was news while the settings were still loading: it waits for them instead of being lost. */
  private pending: ReadonlyArray<Notification> = [];

  constructor() {
    const stop = new AbortController();
    inject(DestroyRef).onDestroy(() => stop.abort());
    void this.runtime.run(
      Effect.flatMap(DesktopApi, (desktop) => Stream.runForEach(desktop['Notification.subscribe'](), (event) => Effect.sync(() => this.hear(event)))),
      { signal: stop.signal },
    );
    effect(() => {
      const state = this.settings.state();
      if (state.status === 'loading') return;
      untracked(() => {
        const waited = this.pending;
        this.pending = [];
        if (state.status !== 'ready') return;
        // Only what is still the latest status of its Source: an older one is no longer news.
        for (const notification of waited) {
          if (this.heard.get(sourceKey(notification.source)) === notification.type) this.alert(state.channels, notification);
        }
      });
    });
  }

  private hear(event: NotificationEvent): void {
    const heard = news(this.heard, event);
    this.heard = heard.heard;
    if (heard.news === undefined) return;
    const state = this.settings.state();
    if (state.status === 'loading') this.pending = [...this.pending, heard.news];
    // Settings that could not be read cannot say whether the user wants to hear about it.
    else if (state.status === 'ready') this.alert(state.channels, heard.news);
  }

  private alert(channels: ChannelsSettings, notification: Notification): void {
    for (const channel of allChannels) if (alerts(channels[channel], notification)) this.deliveries[channel].alert(notification);
  }
}
