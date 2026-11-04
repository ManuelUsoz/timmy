import { AfterViewInit, ChangeDetectionStrategy, Component, ElementRef, OnDestroy, computed, effect, inject, input, output, signal, viewChild } from '@angular/core';
import { Effect, Stream } from 'effect';
import { FitAddon } from '@xterm/addon-fit';
import { SerializeAddon } from '@xterm/addon-serialize';
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
  readonly restarted = output<TerminalEntry>();
  protected readonly fallbackOutput = computed(() => sampleOutput(this.terminal().state, this.cwd()).map((line) => line.map((piece) => piece.text).join('')).join('\n'));
  protected readonly xtermReady = signal(false);
  protected readonly size = signal('120×34');

  private instance: Terminal | undefined;
  private serializer: SerializeAddon | undefined;
  private destroyed = false;
  /** False until the saved screen has been written back: leaving before that must not replace it with a half-restored one. */
  private screenRestored = false;
  /** Output handed to xterm whose parsing has not finished: xterm writes asynchronously, and main will not send it again. */
  private readonly unparsed: string[] = [];
  private resizeObserver: ResizeObserver | undefined;
  private fitFrame = 0;
  private dataSubscription: { dispose: () => void } | undefined;
  private resizeSubscription: { dispose: () => void } | undefined;
  private readonly streamAbort = new AbortController();

  constructor() {
    // A bell or notification that arrives while the user is typing in this Terminal has been seen at once.
    effect(() => {
      const { id, activity } = this.terminal();
      if (activity === 'NeedsAttention' && this.userIsHere()) void this.terminals.focus(id);
    });
  }

  private userIsHere(): boolean {
    const host = this.host().nativeElement;
    return document.hasFocus() && host.contains(document.activeElement);
  }

  ngAfterViewInit(): void {
    const entry = this.terminal();
    if (typeof window.matchMedia !== 'function') return;
    const styles = getComputedStyle(this.host().nativeElement);
    const token = (name: string): string => styles.getPropertyValue(name).trim();
    const instance = new Terminal({
      cursorBlink: true,
      fontFamily: token('--ff-mono') || 'monospace',
      fontSize: 14,
      lineHeight: 1.14,
      scrollback: 5000,
      theme: terminalTheme({ background: token('--background') || '#161616', foreground: token('--text-primary') || '#f4f4f4', focus: token('--focus') || '#ffffff' }),
    });
    const fit = new FitAddon();
    const serializer = new SerializeAddon();
    instance.loadAddon(fit);
    instance.loadAddon(serializer);
    this.instance = instance;
    this.serializer = serializer;
    instance.open(this.host().nativeElement);
    this.xtermReady.set(true);
    fit.fit();
    this.size.set(`${instance.cols}×${instance.rows}`);
    this.dataSubscription = instance.onData((data) => void this.terminals.write(entry.id, data));
    // The screen is restored at the size it was recorded at and then fitted: xterm reflows it as it does for any resize,
    // which a raw replay into the new size does not. The PTY only hears of the final size.
    const restored = new Promise<void>((resolve) => {
      if (entry.screen === undefined) return resolve();
      instance.resize(entry.screen.cols, entry.screen.rows);
      instance.write(entry.screen.data, () => {
        fit.fit();
        resolve();
      });
    });
    void restored.then(() => {
      if (this.destroyed) return;
      this.screenRestored = true;
      this.size.set(`${instance.cols}×${instance.rows}`);
      this.resizeSubscription = instance.onResize(({ cols, rows }) => {
        this.size.set(`${cols}×${rows}`);
        void this.terminals.resize(entry.id, cols, rows);
      });
      void this.terminals.resize(entry.id, instance.cols, instance.rows);
    });
    this.resizeObserver = new ResizeObserver(() => {
      cancelAnimationFrame(this.fitFrame);
      this.fitFrame = requestAnimationFrame(() => fit.fit());
    });
    this.resizeObserver.observe(this.host().nativeElement);
    instance.focus();
    // Showing a Terminal, and going back to its window, is the user being on it: what it asked for has been seen.
    void this.terminals.focus(entry.id);
    instance.textarea?.addEventListener('focus', this.onFocus);

    const terminals = this.terminals;
    const unparsed = this.unparsed;
    void this.runtime.run(
      Effect.gen(function* () {
        const desktop = yield* DesktopApi;
        yield* Stream.runForEach(desktop['Terminal.output']({ terminalId: entry.id }), (event) =>
          Effect.sync(() => {
            if (event._tag === 'Data') {
              unparsed.push(event.data);
              instance.write(event.data, () => void unparsed.shift());
            } else {
              terminals.exited(entry.id, event.exitCode);
            }
          }),
        );
      }),
      { signal: this.streamAbort.signal },
    );
  }

  /** What the next place that shows this Terminal restores: the screen as parsed so far, then the output still to be parsed. */
  private saveScreen(): void {
    const { instance, serializer } = this;
    const entry = this.terminal();
    const pending = this.unparsed.join('');
    if (this.screenRestored && instance !== undefined && serializer !== undefined) {
      this.terminals.saveScreen(entry.id, { cols: instance.cols, rows: instance.rows, data: serializer.serialize() + pending });
    } else if (entry.screen !== undefined) {
      // Left before the saved screen was written back: the saved one still stands, with what arrived since.
      this.terminals.saveScreen(entry.id, { ...entry.screen, data: entry.screen.data + pending });
    }
  }

  private readonly onFocus =(): void => void this.terminals.focus(this.terminal().id);

  ngOnDestroy(): void {
    this.destroyed = true;
    this.saveScreen();
    this.instance?.textarea?.removeEventListener('focus', this.onFocus);
    this.streamAbort.abort();
    this.dataSubscription?.dispose();
    this.resizeSubscription?.dispose();
    cancelAnimationFrame(this.fitFrame);
    this.resizeObserver?.disconnect();
    this.instance?.dispose();
  }

  protected async restart(): Promise<void> {
    const next = await this.terminals.restart(this.terminal().id, this.cwd());
    if (next !== undefined) this.restarted.emit(next);
  }

  protected async closeTerminal(): Promise<void> {
    await this.terminals.close(this.terminal().id);
    this.closed.emit();
  }
}
