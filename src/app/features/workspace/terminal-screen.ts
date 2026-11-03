import { AfterViewInit, ChangeDetectionStrategy, Component, ElementRef, OnDestroy, computed, inject, input, output, signal, viewChild } from '@angular/core';
import { Effect, Stream } from 'effect';
import { Terminal } from '@xterm/xterm';
import { DesktopApi } from '../../core/desktop-api';
import { I18n } from '../../core/i18n';
import { EffectRuntime } from '../../core/effect-runtime';
import { ButtonComponent } from '../../shared/ui/button/button';
import { StateComponent } from '../../shared/ui/state/state';
import type { TerminalEntry } from './terminal-entries';
import { sampleOutput } from './terminal-sample';
import { terminalStateKey, terminalTone } from './terminal-view';
import { TerminalsState } from './terminals-state';

@Component({
  selector: 'app-terminal-screen',
  imports: [ButtonComponent, StateComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './terminal-screen.html',
  styleUrl: './terminal-screen.css',
})
export class TerminalScreen implements AfterViewInit, OnDestroy {
  protected readonly i18n = inject(I18n);
  protected readonly tone = terminalTone;
  protected readonly stateKey = terminalStateKey;
  private readonly runtime = inject(EffectRuntime);
  private readonly terminals = inject(TerminalsState);
  private readonly host = viewChild.required<ElementRef<HTMLDivElement>>('terminalHost');

  readonly terminal = input.required<TerminalEntry>();
  readonly cwd = input.required<string>();
  readonly closed = output<void>();
  protected readonly fallbackOutput = computed(() => sampleOutput(this.terminal().state, this.cwd()).map((line) => line.map((piece) => piece.text).join('')).join('\n'));
  protected readonly xtermReady = signal(false);

  private instance: Terminal | undefined;
  private resizeObserver: ResizeObserver | undefined;
  private dataSubscription: { dispose: () => void } | undefined;
  private resizeSubscription: { dispose: () => void } | undefined;
  private readonly streamAbort = new AbortController();

  ngAfterViewInit(): void {
    const entry = this.terminal();
    if (typeof window.matchMedia !== 'function') return;
    const instance = new Terminal({ cursorBlink: true, fontFamily: 'var(--font-mono)', fontSize: 14, convertEol: true, scrollback: 5000 });
    this.instance = instance;
    instance.open(this.host().nativeElement);
    this.xtermReady.set(true);
    if (entry.output !== '') instance.write(entry.output);
    this.dataSubscription = instance.onData((data) => void this.terminals.write(entry.id, data));
    this.resizeSubscription = instance.onResize(({ cols, rows }) => void this.terminals.resize(entry.id, cols, rows));
    this.resizeObserver = new ResizeObserver(() => {
      const { cols, rows } = instance;
      void this.terminals.resize(entry.id, cols, rows);
    });
    this.resizeObserver.observe(this.host().nativeElement);

    const terminals = this.terminals;
    void this.runtime.run(
      Effect.gen(function* () {
        const desktop = yield* DesktopApi;
        yield* Stream.runForEach(desktop['Terminal.output']({ terminalId: entry.id }), (event) =>
          Effect.sync(() => {
            if (event._tag === 'Data') {
              instance.write(event.data);
              terminals.appendOutput(entry.id, event.data);
            } else {
              terminals.setState(entry.id, 'Done');
            }
          }),
        );
      }),
      { signal: this.streamAbort.signal },
    );
  }

  ngOnDestroy(): void {
    this.streamAbort.abort();
    this.dataSubscription?.dispose();
    this.resizeSubscription?.dispose();
    this.resizeObserver?.disconnect();
    this.instance?.dispose();
  }

  protected async closeTerminal(): Promise<void> {
    await this.terminals.close(this.terminal().id);
    this.closed.emit();
  }
}
