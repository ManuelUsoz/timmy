import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, afterNextRender, inject, input, output, viewChild } from '@angular/core';

/**
 * An image shown enlarged over the window. It is presentational: the caller owns whether it is open
 * (render it with `@if`) and supplies the already-translated texts. The close button, Esc and a click
 * on the backdrop emit `closed`. Focus starts on the close button and goes back to where it was.
 */
@Component({
  selector: 'ui-lightbox',
  template: `
    <div class="lightbox-backdrop" aria-hidden="true" (click)="closed.emit()"></div>
    <div class="lightbox" role="dialog" aria-modal="true" [attr.aria-label]="label()">
      <img [src]="src()" [alt]="label()" />
      <button #close type="button" class="lightbox-close" [attr.aria-label]="closeLabel()" (click)="closed.emit()">
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" /></svg>
      </button>
    </div>
  `,
  styleUrl: './lightbox.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(document:keydown.escape)': 'onEscape($event)' },
})
export class LightboxComponent {
  readonly src = input.required<string>();
  readonly label = input.required<string>();
  readonly closeLabel = input.required<string>();
  readonly closed = output<void>();

  private readonly closeButton = viewChild.required('close', { read: ElementRef<HTMLButtonElement> });
  private readonly opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;

  constructor() {
    afterNextRender(() => this.closeButton().nativeElement.focus());
    inject(DestroyRef).onDestroy(() => this.opener?.focus());
  }

  protected onEscape(event: Event): void {
    event.preventDefault();
    this.closed.emit();
  }
}
