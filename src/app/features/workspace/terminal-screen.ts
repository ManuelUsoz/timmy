import { AfterViewInit, ChangeDetectionStrategy, Component, ElementRef, OnDestroy, computed, inject, input, output, signal, viewChild } from '@angular/core';
import { Effect, Stream } from 'effect';
import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import { DesktopApi } from '../../core/desktop-api';
import { I18n } from '../../core/i18n';
import { EffectRuntime } from '../../core/effect-runtime';
import { ButtonComponent } from '../../shared/ui/button/button';
import { StateComponent } from '../../shared/ui/state/state';
import type { TerminalEntry } from './terminal-entries';
import { sampleOutput } from './terminal-sample';
import { terminalTheme } from './terminal-theme';
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
  protected readonly size = signal('120×34');

  private instance: Terminal | undefined;
  private resizeObserver: ResizeObserver | undefined;
  private fitFrame = 0;
  private dataSubscription: { dispose: () => void } | undefined;
  private resizeSubscription: { dispose: () => void } | undefined;
  private readonly streamAbort = new AbortController();

  ngAfterViewInit(): void {
    const entry = this.terminal();
    if (typeof window.matchMedia !== 'function') return;
    const styles = getComputedStyle(this.host().nativeElement);
    const token = (name: string): string => styles.getPropertyValue(name).trim();
    const instance = new Terminal({
      cursorBlink: true,
      fontFamily: token('--ff-mono') || 'monospace',
      fontSize: 14,
      lineHeight: 1.25,
      scrollback: 5000,
      theme: terminalTheme({ background: token('--background') || '#161616', foreground: token('--text-primary') || '#f4f4f4', focus: token('--focus') || '#ffffff' }),
    });
    const fit = new FitAddon();
    instance.loadAddon(fit);
    this.instance = instance;
    instance.open(this.host().nativeElement);
    this.xtermReady.set(true);
    fit.fit();
    this.size.set(`${instance.cols}×${instance.rows}`);
    if (entry.output !== '') instance.write(entry.output);
    this.dataSubscription = instance.onData((data) => void this.terminals.write(entry.id, data));
    this.resizeSubscription = instance.onResize(({ cols, rows }) => {
      this.size.set(`${cols}×${rows}`);
      void this.terminals.resize(entry.id, cols, rows);
    });
    void this.terminals.resize(entry.id, instance.cols, instance.rows);
    this.resizeObserver = new ResizeObserver(() => {
      cancelAnimationFrame(this.fitFrame);
      this.fitFrame = requestAnimationFrame(() => fit.fit());
    });
    this.resizeObserver.observe(this.host().nativeElement);
    instance.focus();

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
    cancelAnimationFrame(this.fitFrame);
    this.resizeObserver?.disconnect();
    this.instance?.dispose();
  }

  protected async closeTerminal(): Promise<void> {
    await this.terminals.close(this.terminal().id);
    this.closed.emit();
  }
}
