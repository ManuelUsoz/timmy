import { ChangeDetectionStrategy, Component, ElementRef, afterNextRender, computed, inject, viewChild } from '@angular/core';
import { I18n } from '../../core/i18n';
import { FileView } from './file-view';
import { QuickLookState } from './quick-look-state';

const focusable = 'button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * The Quick look's dialog (GLOSSARY: Quick look): the file shown as a File View shows it (its text, or the state that says
 * why not), its name and folder, and where it is in the list ("12 de 28 en timmy"). It takes the keyboard and keeps it:
 * Up and Down walk the list, Enter opens the file as a preview File View, Esc or Space close it, Tab cycles inside. A
 * click on the backdrop closes it. The state lives in `QuickLookState`.
 */
@Component({
  selector: 'app-quick-look',
  imports: [FileView],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './quick-look.html',
  styleUrl: './quick-look.css',
})
export class QuickLook {
  protected readonly i18n = inject(I18n);
  protected readonly state = inject(QuickLookState);
  private readonly dialog = viewChild.required<ElementRef<HTMLElement>>('dialog');

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

  /** Tab goes to the next thing inside that takes the keyboard, and from the last one back to the first. */
  private cycle(back: boolean): void {
    const items = Array.from(this.dialog().nativeElement.querySelectorAll<HTMLElement>(focusable));
    if (items.length === 0) return;
    const at = items.indexOf(document.activeElement as HTMLElement);
    const next = at === -1 ? (back ? items.length - 1 : 0) : (at + (back ? -1 : 1) + items.length) % items.length;
    items[next].focus();
  }
}
