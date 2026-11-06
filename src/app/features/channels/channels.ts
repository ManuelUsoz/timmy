import { DestroyRef, Injectable, inject } from '@angular/core';
import { Effect, Stream } from 'effect';
import type { NotificationEvent } from '../../../shared/notification/notification.model';
import { allChannels, type Channel } from '../../../shared/settings/settings.model';
import { DesktopApi } from '../../core/desktop-api';
import { EffectRuntime } from '../../core/effect-runtime';
import { NotificationSettings } from '../../core/notification-settings';
import { alerts, hear, type ChannelDelivery, type Heard } from './channel-alerts';
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

  constructor() {
    const stop = new AbortController();
    inject(DestroyRef).onDestroy(() => stop.abort());
    void this.runtime.run(
      Effect.flatMap(DesktopApi, (desktop) => Stream.runForEach(desktop['Notification.subscribe'](), (event) => Effect.sync(() => this.hear(event)))),
      { signal: stop.signal },
    );
  }

  private hear(event: NotificationEvent): void {
    const { heard, entered } = hear(this.heard, event);
    this.heard = heard;
    const state = this.settings.state();
    // Until the settings are known, no Channel can say whether the user wants to hear about it.
    if (entered === undefined || state.status !== 'ready') return;
    for (const channel of allChannels) {
      if (alerts(state.channels[channel], entered)) this.deliveries[channel].alert(entered);
    }
  }
}
