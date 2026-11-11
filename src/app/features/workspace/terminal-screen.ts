import { AfterViewInit, ChangeDetectionStrategy, booleanAttribute, Component, ElementRef, OnDestroy, computed, effect, inject, input, output, signal, untracked, viewChild } from '@angular/core';
import { Cause, Effect, Exit, Stream } from 'effect';
import { FitAddon } from '@xterm/addon-fit';
import { SerializeAddon } from '@xterm/addon-serialize';
import { Terminal } from '@xterm/xterm';
import { DesktopApi } from '../../core/desktop-api';
import { I18n } from '../../core/i18n';
import { EffectRuntime } from '../../core/effect-runtime';
import { ToastService } from '../../core/toast';
import { ButtonComponent } from '../../shared/ui/button/button';
import { StateComponent } from '../../shared/ui/state/state';
import type { FileState } from './file-read';
import { FilePicture } from './file-picture';
import { formatSize } from './file-view';
import type { TerminalEntry, TerminalId } from './terminal-entries';
import { PathLinks, folderFromOsc7, type PathLinkHint, type PathLinkPreview, type PathLinkProvider } from './path-links';
import { sampleOutput } from './terminal-sample';
import { terminalTheme } from './terminal-theme';
import { terminalStateKey, terminalTone } from './terminal-view';
import { TerminalsState } from './terminals-state';

/** How many lines from the bottom of the screen are enough to find the last few with output in them. */
const tailDepth = 200;

/** The lines at the bottom of a screen, as text. */
const bufferBottom = (instance: Terminal): ReadonlyArray<string> => {
  const buffer = instance.buffer.active;
  const lines: string[] = [];
  for (let i = Math.max(0, buffer.length - tailDepth); i < buffer.length; i++) lines.push(buffer.getLine(i)?.translateToString(true) ?? '');
  return lines;
};

@Component({
  selector: 'app-terminal-screen',
  imports: [ButtonComponent, FilePicture, StateComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './terminal-screen.html',
  styleUrl: './terminal-screen.css',
})
export class TerminalScreen implements AfterViewInit, OnDestroy {
  protected readonly i18n = inject(I18n);
  protected readonly tone = terminalTone;
  protected readonly stateKey = terminalStateKey;
  private readonly runtime = inject(EffectRuntime);
  private readonly toasts = inject(ToastService);
  private readonly terminals = inject(TerminalsState);
  private readonly host = viewChild.required<ElementRef<HTMLDivElement>>('terminalHost');

  readonly terminal = input.required<TerminalEntry>();
  readonly cwd = input.required<string>();
  /** In a Pane, whose header names the Terminal and says its state: no header or status bar of its own. */
  readonly bare = input(false, { transform: booleanAttribute });
  /**
   * The screen the user is on. A Tab shows several Terminals at once; only the focused Pane's expanded one is what main
   * is told is on screen, and only it takes the keyboard when it appears.
   */
  readonly active = input(true);
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
  private oscSubscription: { dispose: () => void } | undefined;
  private linkSubscription: { dispose: () => void } | undefined;
  /** The folder the shell last reported (OSC 7); none until it does. */
  private folder: string | undefined;
  private readonly pathLinks = inject(PathLinks);
  /** The hovered Path link's hint (GLOSSARY: Path link): what Ctrl (Cmd) + click opens, by the pointer. */
  private readonly links = signal<PathLinkProvider | undefined>(undefined);
  protected readonly linkHint = computed((): PathLinkHint | undefined => this.links()?.hint());
  protected readonly linkPreview = computed((): PathLinkPreview | undefined => this.links()?.preview());
  /** What the hovered image shows: the picture, or the note of why there is none. */
  protected readonly previewModel = computed(() => {
    const preview = this.linkPreview();
    if (preview === undefined) return undefined;
    const { state, x, y, path } = preview;
    if (state.status === 'image') return { kind: 'image' as const, picture: state.picture, path, x, y };
    if (state.status === 'imageTooLarge') return { kind: 'note' as const, note: this.imageNote(state), x, y };
    return undefined;
  });
  protected readonly openKey = /Mac|iPhone|iPad/.test(navigator.userAgent) ? 'Cmd' : 'Ctrl';
  private resizeSubscription: { dispose: () => void } | undefined;
  private readonly streamAbort = new AbortController();
  /** How the Switcher reads this screen's last lines, for the Terminal it was opened on. */
  private tail: { readonly id: TerminalId; readonly read: () => ReadonlyArray<string> } | undefined;

  constructor() {
    // Whichever Terminal this screen shows (a restart gives it a new one) is what main is told is on screen.
    effect(() => {
      if (this.active()) this.terminals.show(this.terminal().id);
    });
    // A bell or notification that arrives while the user is typing in this Terminal has been seen at once.
    effect(() => {
      const { id, activity } = this.terminal();
      if (activity === 'NeedsAttention' && this.userIsHere()) void this.terminals.focus(id);
    });
    // A screen already on view becomes the active one when its Pane is focused (a click, the sidebar, a Tab): it takes
    // the keyboard, so the user is on it and what asked for their attention is seen.
    effect(() => {
      if (!this.active()) return;
      untracked(() => {
        if (this.instance === undefined || this.host().nativeElement.contains(document.activeElement)) return;
        this.instance.focus();
        const { id, activity } = this.terminal();
        if (activity === 'NeedsAttention') void this.terminals.focus(id);
      });
    });
  }

  private userIsHere(): boolean {
    const host = this.host().nativeElement;
    return document.hasFocus() && host.contains(document.activeElement);
  }

  private imageNote(state: FileState & { readonly status: 'imageTooLarge' }): string {
    return state.limit === 'bytes'
      ? this.i18n.t('reader.imageOverBytes', { size: formatSize(state.size) })
      : this.i18n.t('reader.imageOverPixels', { width: state.width, height: state.height });
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
      theme: terminalTheme({ background: token('--background') || '#000000', foreground: token('--text-primary') || '#ffffff', focus: token('--focus') || '#ffffff' }),
    });
    const fit = new FitAddon();
    const serializer = new SerializeAddon();
    instance.loadAddon(fit);
    instance.loadAddon(serializer);
    this.instance = instance;
    this.serializer = serializer;
    instance.open(this.host().nativeElement);
    this.xtermReady.set(true);
    // The folder the shell says it is in (OSC 7), so a path it prints relative to it can still be a Path link.
    this.oscSubscription = instance.parser.registerOscHandler(7, (data) => {
      this.folder = folderFromOsc7(data);
      return true;
    });
    const links = this.pathLinks.provider(instance, {
      terminal: entry.id,
      cwd: this.cwd(),
      folder: () => this.folder,
      focus: () => instance.focus(),
    });
    this.links.set(links);
    this.linkSubscription = instance.registerLinkProvider(links);
    this.tail = { id: entry.id, read: () => bufferBottom(instance) };
    this.terminals.attachTail(this.tail.id, this.tail.read);
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
    if (this.active()) {
      instance.focus();
      // Showing a Terminal, and going back to its window, is the user being on it: what it asked for has been seen.
      void this.terminals.focus(entry.id);
    }
    instance.textarea?.addEventListener('focus', this.onFocus);

    // An Idle Terminal has no process to read from yet: its output is read once the user starts it.
    if (entry.state !== 'Idle') this.readOutput(instance);
  }

  /** Shows what the Terminal's process prints, until the screen goes or the process ends. */
  private readOutput(instance: Terminal): void {
    const entry = this.terminal();
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
    this.terminals.hide(this.terminal().id);
    this.saveScreen();
    if (this.tail !== undefined) this.terminals.detachTail(this.tail.id, this.tail.read);
    this.instance?.textarea?.removeEventListener('focus', this.onFocus);
    this.streamAbort.abort();
    this.dataSubscription?.dispose();
    this.resizeSubscription?.dispose();
    this.oscSubscription?.dispose();
    this.linkSubscription?.dispose();
    cancelAnimationFrame(this.fitFrame);
    this.resizeObserver?.disconnect();
    this.instance?.dispose();
  }

  /** Starts the Idle Terminal (a restored one) in its Project folder, as the same Terminal it was. */
  protected async start(): Promise<void> {
    const instance = this.instance;
    const entry = this.terminal();
    const started = await this.terminals.start(entry.id, this.cwd());
    if (Exit.isFailure(started)) {
      this.toasts.error('terminals.startFailed', { detail: Cause.pretty(started.cause) });
      return;
    }
    if (this.destroyed || instance === undefined) return;
    this.readOutput(instance);
    instance.focus();
    void this.terminals.resize(entry.id, instance.cols, instance.rows);
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
