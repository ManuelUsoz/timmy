import { ChangeDetectionStrategy, Component, ElementRef, afterNextRender, computed, effect, inject, signal, untracked, viewChild } from '@angular/core';
import { Cause, Exit } from 'effect';
import { EffectRuntime } from '../../core/effect-runtime';
import { I18n } from '../../core/i18n';
import { FileDiffView, readDiff, type DiffState } from './file-diff';
import { FileView } from './file-view';
import { QuickLookState } from './quick-look-state';

const focusable = 'button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * The Quick look's dialog (GLOSSARY: Quick look): the file shown as a File View shows it (its text, or the state that says
 * why not) or its change against the last commit (Archivo/Cambios), its name and folder, and where it is in the list ("12
 * de 28 en timmy"). It takes the keyboard and keeps it: Up and Down walk the list, Left and Right switch Archivo and
 * Cambios, Enter opens the file as a preview File View, Esc or Space close it, Tab cycles inside. A click on the backdrop
 * closes it. The state of the walk lives in `QuickLookState`; which half is on is this dialog's, and each one opens on
 * Archivo.
 */
@Component({
  selector: 'app-quick-look',
  imports: [FileView, FileDiffView],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './quick-look.html',
  styleUrl: './quick-look.css',
})
export class QuickLook {
  protected readonly i18n = inject(I18n);
  protected readonly state = inject(QuickLookState);
  private readonly runtime = inject(EffectRuntime);
  private readonly dialog = viewChild.required<ElementRef<HTMLElement>>('dialog');

  /** Archivo (the file) or Cambios (its diff). */
  protected readonly mode = signal<'file' | 'changes'>('file');
  /** The diff of the file shown, read when it opens and on each step whichever half is on: it decides whether Cambios is offered. */
  protected readonly diff = signal<DiffState>({ status: 'loading' });
  /** Cambios is offered only for a Changed file with text: a diff with lines to show. */
  protected readonly canDiff = computed(() => this.diff().status === 'changes');
  /** Cambios keeps its place with another label when it is not offered, so the header does not shift. */
  protected readonly changesLabel = computed(() => {
    const status = this.diff().status;
    return this.i18n.t(status === 'changes' || status === 'loading' ? 'quickLook.changes' : 'quickLook.noChanges');
  });

  protected readonly path = computed(() => {
    const model = this.state.model();
    return model === undefined ? '' : model.files[model.at];
  });
  protected readonly name = computed(() => this.path().split('/').at(-1) ?? '');
  protected readonly dir = computed(() => this.path().split('/').slice(0, -1).join('/'));
  protected readonly counter = computed(() => {
    const model = this.state.model();
    return model === undefined ? '' : this.i18n.t('quickLook.counter', { at: model.at + 1, total: model.files.length, project: model.projectName });
  });

  constructor() {
    afterNextRender(() => this.dialog().nativeElement.focus());
    effect(() => {
      const model = this.state.model();
      if (model === undefined) return;
      const { cwd } = model;
      const path = model.files[model.at];
      untracked(() => void this.readDiff(cwd, path));
    });
  }

  /** Left or Right, or a click on either half. Cambios only when there is a diff to show. */
  protected show(mode: 'file' | 'changes'): void {
    if (mode === 'changes' && !this.canDiff()) return;
    this.mode.set(mode);
  }

  protected key(event: KeyboardEvent): void {
    if (event.ctrlKey || event.altKey || event.metaKey) return;
    // A button inside acts on its own Enter and Space.
    const onButton = event.target instanceof HTMLButtonElement;
    switch (event.key) {
      case 'ArrowDown':
        this.state.step(1);
        break;
      case 'ArrowUp':
        this.state.step(-1);
        break;
      case 'ArrowLeft':
        this.show('file');
        break;
      case 'ArrowRight':
        this.show('changes');
        break;
      case 'Escape':
        this.state.close();
        break;
      case ' ':
        if (onButton) return;
        this.state.close();
        break;
      case 'Enter':
        if (onButton) return;
        this.state.confirm();
        break;
      case 'Tab':
        this.cycle(event.shiftKey);
        break;
      default:
        return;
    }
    event.preventDefault();
    event.stopPropagation();
  }

  /** A file with nothing to compare drops back to Archivo, so a walk on Cambios never lands on an empty diff. */
  private async readDiff(cwd: string, path: string): Promise<void> {
    this.diff.set({ status: 'loading' });
    const exit = await this.runtime.run(readDiff(cwd, path));
    const model = this.state.model();
    // The walk moved on while this diff was read.
    if (model === undefined || model.cwd !== cwd || model.files[model.at] !== path) return;
    const diff: DiffState = Exit.isSuccess(exit) ? exit.value : { status: 'failed', detail: Cause.pretty(exit.cause) };
    this.diff.set(diff);
    if (diff.status !== 'changes') this.mode.set('file');
  }

  /** Tab goes to the next thing inside that takes the keyboard, and from the last one back to the first. */
  private cycle(back: boolean): void {
    const items = Array.from(this.dialog().nativeElement.querySelectorAll<HTMLElement>(focusable));
    if (items.length === 0) return;
    const at = items.indexOf(document.activeElement as HTMLElement);
    const next = at === -1 ? (back ? items.length - 1 : 0) : (at + (back ? -1 : 1) + items.length) % items.length;
    items[next].focus();
  }
}
