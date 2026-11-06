import { TestBed } from '@angular/core/testing';
import { Effect, Layer, PubSub, Ref, Stream } from 'effect';
import type { NotificationEvent, TerminalStatus } from '../../../shared/notification/notification.model';
import { NotificationRpcs } from '../../../shared/notification/notification.rpc';
import { defaultSettings, withChannelChange, type Settings } from '../../../shared/settings/settings.model';
import { SettingsRpcs } from '../../../shared/settings/settings.rpc';
import type { TerminalId } from '../../../shared/terminal/terminal.model';
import { makeDesktopTestLayer } from '../../core/desktop-layers';
import { EffectRuntime } from '../../core/effect-runtime';
import { NotificationSettings } from '../../core/notification-settings';
import { ToastService } from '../../core/toast';
import { layerFakeProjects, makeBackend, project } from '../workspace/projects-fakes';
import { ProjectsState } from '../workspace/projects-state';
import { TerminalsState } from '../workspace/terminals-state';
import { Channels } from './channels';

/** The real client against a main whose settings are a Ref and whose bus is a PubSub the test speaks into. */
const setup = async (stored: Settings = defaultSettings) => {
  const settings = Ref.makeUnsafe(stored);
  const bus = Effect.runSync(PubSub.unbounded<NotificationEvent>());
  const demo = project('demo');
  const handlers = Layer.mergeAll(
    layerFakeProjects(makeBackend({ projects: [demo] })),
    NotificationRpcs.toLayer({ 'Notification.subscribe': () => Stream.fromPubSub(bus) }),
    SettingsRpcs.toLayer({
      'Settings.get': () => Ref.get(settings),
      'Settings.setLanguage': ({ language }) => Ref.updateAndGet(settings, (s) => ({ ...s, language })),
      'Settings.setProvider': () => Ref.get(settings),
      'Settings.setChannel': ({ channel, change }) =>
        Ref.updateAndGet(settings, (s) => ({ ...s, channels: { ...s.channels, [channel]: withChannelChange(s.channels[channel], change) } })),
    }),
  );
  const layer = makeDesktopTestLayer(handlers);
  TestBed.configureTestingModule({
    providers: [{ provide: EffectRuntime, useValue: { run: (e: Effect.Effect<unknown, unknown, never>) => Effect.runPromiseExit(Effect.provide(e as never, layer)) } }],
  });
  const settle = () => new Promise((resolve) => setTimeout(resolve, 20));
  await TestBed.inject(ProjectsState).refresh();
  const terminal = TestBed.inject(TerminalsState).create(demo.projectId);
  TestBed.inject(Channels);
  await settle();
  const toasts = TestBed.inject(ToastService);
  /** What main's bus says about the Terminal. */
  const hear = async (type: TerminalStatus, extra: { seen?: boolean; onScreen?: boolean; id?: TerminalId } = {}) => {
    const notification = { source: { _tag: 'Terminal', terminalId: extra.id ?? terminal.id } as const, type, seen: extra.seen ?? false, onScreen: extra.onScreen ?? false };
    await Effect.runPromise(PubSub.publish(bus, { _tag: 'Notified', notification }));
    await settle();
  };
  const shown = () => toasts.toasts().map((toast) => ({ tone: toast.tone, title: toast.title, body: toast.body, params: toast.params }));
  return { hear, shown, settle, notificationSettings: TestBed.inject(NotificationSettings) };
};

describe('Channels: the toast Channel', () => {
  it('shows a toast naming the Terminal when it turns Waiting, Done or Error', async () => {
    const { hear, shown } = await setup();
    await hear('Waiting');
    await hear('Done');
    await hear('Error');
    expect(shown()).toEqual([
      { tone: 'warning', title: 'notifications.waiting.title', body: 'notifications.waiting.body', params: { number: 1, project: 'demo' } },
      { tone: 'success', title: 'notifications.done.title', body: 'notifications.done.body', params: { number: 1, project: 'demo' } },
      { tone: 'error', title: 'notifications.error.title', body: 'notifications.error.body', params: { number: 1, project: 'demo' } },
    ]);
  });

  it('never shows a toast for Working or Idle', async () => {
    const { hear, shown } = await setup();
    await hear('Working');
    await hear('Idle');
    expect(shown()).toEqual([]);
  });

  it('shows no toast for a Terminal that is on screen', async () => {
    const { hear, shown } = await setup();
    await hear('Waiting', { onScreen: true });
    await hear('Error', { onScreen: true, seen: true });
    expect(shown()).toEqual([]);
  });

  it('shows one toast per status the Terminal enters, not another when it becomes Seen', async () => {
    const { hear, shown } = await setup();
    await hear('Done');
    await hear('Done', { seen: true, onScreen: true });
    expect(shown()).toHaveLength(1);
  });

  it('stops at once when the user switches the Channel off, and starts again when they switch it on', async () => {
    const { hear, shown, settle, notificationSettings } = await setup();
    notificationSettings.setEnabled('Toast', false);
    await settle();
    await hear('Waiting');
    expect(shown()).toEqual([]);
    notificationSettings.setEnabled('Toast', true);
    await settle();
    await hear('Error');
    expect(shown().map((toast) => toast.tone)).toEqual(['error']);
  });

  it('stops at once for a type the user switches off, and keeps alerting for the others', async () => {
    const { hear, shown, settle, notificationSettings } = await setup();
    notificationSettings.setType('Toast', 'Done', false);
    await settle();
    await hear('Done');
    await hear('Error');
    expect(shown().map((toast) => toast.tone)).toEqual(['error']);
  });

  it('follows what the user stored: a Channel switched off before the app started stays silent', async () => {
    const { hear, shown } = await setup({ ...defaultSettings, channels: { Toast: { enabled: false, types: ['Waiting', 'Done', 'Error'] } } });
    await hear('Error');
    expect(shown()).toEqual([]);
  });
});
