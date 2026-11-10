import { TestBed } from '@angular/core/testing';
import { Effect, Layer, Stream } from 'effect';
import { ProjectId } from '../../../shared/projects/projects.model';
import { TerminalId } from '../../../shared/terminal/terminal.model';
import { TerminalRpcs } from '../../../shared/terminal/terminal.rpc';
import { makeDesktopTestLayer } from '../../core/desktop-layers';
import { EffectRuntime } from '../../core/effect-runtime';
import { ToastService } from '../../core/toast';
import { TabId } from './tabs';
import { TerminalScreen } from './terminal-screen';
import { TerminalsState } from './terminals-state';

const timmy = ProjectId.make('p-timmy');
const saved = TerminalId.make('saved-1');

const setup = async (options: { createFails?: boolean } = {}) => {
  const created: Array<{ readonly cwd: string; readonly provider?: string; readonly terminalId?: string }> = [];
  const unused = () => Effect.die('not under test');
  const terminal = TerminalRpcs.toLayer({
    'Terminal.create': (payload) =>
      options.createFails ? Effect.die('no pty') : Effect.sync(() => (created.push(payload), { terminalId: payload.terminalId ?? TerminalId.make('fresh') })),
    'Terminal.close': () => Effect.void,
    'Terminal.output': () => Stream.never,
    'Terminal.activity': () => Stream.empty,
    'Terminal.focus': () => Effect.void,
    'Terminal.write': unused,
    'Terminal.resize': () => Effect.void,
    'Terminal.show': () => Effect.void,
  });
  const layer = makeDesktopTestLayer(Layer.mergeAll(terminal));
  await TestBed.configureTestingModule({
    imports: [TerminalScreen],
    providers: [{ provide: EffectRuntime, useValue: { run: (e: Effect.Effect<unknown, unknown, never>) => Effect.runPromiseExit(Effect.provide(e as never, layer)) } }],
  }).compileComponents();
  const terminals = TestBed.inject(TerminalsState);
  terminals.restore([{ id: saved, projectId: timmy, tabId: TabId.make('t1'), number: 3, name: 'claude 3', state: 'Idle', activity: 'Idle', provider: 'ClaudeCode' }]);
  const fixture = TestBed.createComponent(TerminalScreen);
  fixture.componentRef.setInput('terminal', terminals.find(saved)!);
  fixture.componentRef.setInput('cwd', '/work/timmy');
  fixture.componentRef.setInput('bare', true);
  fixture.detectChanges();
  const el = fixture.nativeElement as HTMLElement;
  const settle = async () => {
    for (let i = 0; i < 3; i++) {
      await fixture.whenStable();
      await new Promise((r) => setTimeout(r));
      // The pane re-renders with the entry as it is now.
      fixture.componentRef.setInput('terminal', terminals.find(saved)!);
      fixture.detectChanges();
    }
  };
  return { created, el, terminals, settle, toasts: TestBed.inject(ToastService) };
};

describe('TerminalScreen: an Idle Terminal', () => {
  it('offers to start it, and starts it as the same Terminal in its Project folder with its Provider', async () => {
    const { created, el, terminals, settle } = await setup();
    const start = el.querySelector<HTMLButtonElement>('.start button');
    expect(start?.textContent?.trim()).toBe('Iniciar');
    start!.click();
    await settle();
    expect(created).toEqual([{ cwd: '/work/timmy', provider: 'ClaudeCode', terminalId: 'saved-1' }]);
    expect(terminals.find(saved)).toMatchObject({ state: 'Live', number: 3 });
    expect(el.querySelector('.start')).toBeNull();
  });

  it('says so, and stays Idle, when main cannot start it', async () => {
    const { el, terminals, settle, toasts } = await setup({ createFails: true });
    el.querySelector<HTMLButtonElement>('.start button')!.click();
    await settle();
    expect(terminals.find(saved)?.state).toBe('Idle');
    expect(el.querySelector('.start')).not.toBeNull();
    expect(toasts.toasts().map((toast) => toast.body)).toEqual(['terminals.startFailed']);
  });
});
