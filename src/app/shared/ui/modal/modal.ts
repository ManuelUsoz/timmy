import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  inject,
  input,
  output,
  viewChild,
} from '@angular/core';
import { ButtonComponent } from '../button/button';

let nextId = 0;

const focusable = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * A confirmation surface laid over the window's content: the backdrop dims and blurs what is behind it.
 * It is presentational. The caller owns whether it is open (render it with `@if`) and supplies the
 * already-translated texts. Esc, the close button and a click on the backdrop all emit `closed`; the
 * primary button emits `primary`. Focus starts on the primary button, stays inside, and goes back to
 * where it was when the modal closes.
 */
@Component({
  selector: 'ui-modal',
  imports: [ButtonComponent],
  template: `
    <div class="backdrop" aria-hidden="true" (click)="closed.emit()"></div>
    <div #dialog class="dialog" role="dialog" aria-modal="true" [attr.aria-labelledby]="titleId" (keydown)="onKeydown($event)">
      <div class="header">
        <h2 [id]="titleId">{{ heading() }}</h2>
        <button uiButton kind="ghost" iconOnly type="button" class="close" [attr.aria-label]="closeLabel()" (click)="closed.emit()">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" /></svg>
        </button>
      </div>
      <div class="body"><ng-content /></div>
      <div class="actions">
        <button #primaryButton uiButton kind="primary" type="button" (click)="primary.emit()">{{ primaryLabel() }}</button>
      </div>
    </div>
  `,
  styleUrl: './modal.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(document:keydown.escape)': 'onEscape($event)' },
})
export class ModalComponent {
  readonly heading = input.required<string>();
  readonly primaryLabel = input.required<string>();
  readonly closeLabel = input.required<string>();

  readonly primary = output<void>();
  readonly closed = output<void>();

  protected readonly titleId = `ui-modal-title-${nextId++}`;

  private readonly dialog = viewChild.required<ElementRef<HTMLElement>>('dialog');
  private readonly primaryButton = viewChild.required('primaryButton', { read: ElementRef<HTMLButtonElement> });
  private readonly opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;

  constructor() {
    afterNextRender(() => this.primaryButton().nativeElement.focus());
    inject(DestroyRef).onDestroy(() => this.opener?.focus());
  }

  protected onEscape(event: Event): void {
    event.preventDefault();
    this.closed.emit();
  }

  protected onKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Tab') return;
    const items = Array.from(this.dialog().nativeElement.querySelectorAll<HTMLElement>(focusable));
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && active === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }
}
