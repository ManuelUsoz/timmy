import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import { Effect, Stream } from 'effect';
import { sourceKey, type Notification, type NotificationEvent } from '../../../shared/notification/notification.model';
import { DesktopApi } from '../../core/desktop-api';
import { EffectRuntime } from '../../core/effect-runtime';

/** What the latest Notification of every Source is after hearing `event`. */
export const withNotificationEvent = (latest: ReadonlyMap<string, Notification>, event: NotificationEvent): ReadonlyMap<string, Notification> => {
  const next = new Map(latest);
  if (event._tag === 'Notified') next.set(sourceKey(event.notification.source), event.notification);
  else next.delete(sourceKey(event.source));
  return next;
};

/**
 * The renderer as a Subscriber of the Notification bus in main. It lives as long as the app: the Pill needs it with no
 * Terminal on screen, and main replays the latest Notification of every Source to whoever connects.
 */
@Injectable({ providedIn: 'root' })
export class NotificationsState {
  private readonly latest = signal<ReadonlyMap<string, Notification>>(new Map());
  /** The latest Notification of every Source that still exists. */
  readonly notifications = computed((): ReadonlyArray<Notification> => Array.from(this.latest().values()));

  constructor(private readonly runtime: EffectRuntime) {
    const stop = new AbortController();
    inject(DestroyRef).onDestroy(() => stop.abort());
    void this.runtime.run(
      Effect.flatMap(DesktopApi, (desktop) =>
        Stream.runForEach(desktop['Notification.subscribe'](), (event) => Effect.sync(() => this.latest.update((latest) => withNotificationEvent(latest, event)))),
      ),
      { signal: stop.signal },
    );
  }
}
