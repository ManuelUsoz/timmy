import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  booleanAttribute,
  inject,
  input,
  output,
  viewChild,
} from '@angular/core';
import { ButtonComponent } from '../button/button';

let nextId = 0;

export type ModalTone = 'info' | 'error';
export type ModalSize = 'md' | 'sm';

const focusable = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * A blocking dialog laid over the window's content: the backdrop dims and blurs what is behind it. It asks for
 * one decision or reports one thing, with the state word (`stateLabel`, so colour is never the only cue) over the
 * title, the content as the body, and exactly two buttons: Close on the left, one primary action on the right.
 * `tone="error"` is an alert dialog. It is presentational. The caller owns whether it is open (render it with
 * `@if`) and supplies the already-translated texts. Esc, the cross, Close and a click on the backdrop all emit
 * `closed`; the primary button emits `primary`. Focus starts on the primary button (or, while it is disabled, on
 * the first button of the body), stays inside, and goes back to where it was when the modal closes.
 */
@Component({
  selector: 'ui-modal',
  imports: [ButtonComponent],
  template: `
    <div class="backdrop" aria-hidden="true" (click)="closed.emit()"></div>
    <div
      #dialog
      class="dialog"
      [class.info]="tone() === 'info'"
      [class.error]="tone() === 'error'"
      [class.sm]="size() === 'sm'"
      [attr.role]="tone() === 'error' ? 'alertdialog' : 'dialog'"
      aria-modal="true"
      [attr.aria-labelledby]="titleId"
      (keydown)="onKeydown($event)"
    >
      <div class="header">
        <span class="state"><i class="dot"></i>{{ stateLabel() }}</span>
        <h2 [id]="titleId">{{ heading() }}</h2>
      </div>
      <button uiButton kind="ghost" neutral iconOnly type="button" class="close" [attr.aria-label]="closeLabel()" (click)="closed.emit()">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
      </button>
      <div #body class="body"><ng-content /></div>
      <div class="actions">
        <button #dismissButton uiButton kind="secondary" type="button" class="dismiss" (click)="closed.emit()">{{ closeLabel() }}</button>
        <button #primaryButton uiButton kind="primary" type="button" class="primary" [disabled]="primaryDisabled()" (click)="primary.emit()">{{ primaryLabel() }}</button>
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
  readonly stateLabel = input.required<string>();
  readonly tone = input<ModalTone>('info');
  readonly size = input<ModalSize>('md');
  readonly primaryDisabled = input(false, { transform: booleanAttribute });

  readonly primary = output<void>();
  readonly closed = output<void>();

  protected readonly titleId = `ui-modal-title-${nextId++}`;

  private readonly dialog = viewChild.required<ElementRef<HTMLElement>>('dialog');
  private readonly body = viewChild.required<ElementRef<HTMLElement>>('body');
  private readonly primaryButton = viewChild.required('primaryButton', { read: ElementRef<HTMLButtonElement> });
  private readonly dismissButton = viewChild.required('dismissButton', { read: ElementRef<HTMLButtonElement> });
  private readonly opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;

  constructor() {
    afterNextRender(() => this.focusFirst());
    inject(DestroyRef).onDestroy(() => this.opener?.focus());
  }

  private focusFirst(): void {
    const primary = this.primaryButton().nativeElement;
    if (!primary.disabled) {
      primary.focus();
      return;
    }
    const body = this.body().nativeElement;
    (body.querySelector<HTMLElement>('button:not([disabled])') ?? body.querySelector<HTMLElement>(focusable) ?? this.dismissButton().nativeElement).focus();
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
