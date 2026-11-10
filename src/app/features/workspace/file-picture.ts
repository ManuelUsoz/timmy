import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, input, model, output } from '@angular/core';
import type { Picture } from './file-read';

/**
 * A picture of the reader: an `<img>` of a blob URL made from the bytes main sent, with their type (`image/svg+xml` for an
 * SVG, which draws it as an image: no script, nothing fetched, never inline markup). Fitted to the space it has, centred
 * and never larger than its natural size, on a checkerboard so transparency shows; `actual` shows it at its natural size,
 * scrolled by the View. A click toggles; the View handles `1`. No free zoom.
 */
@Component({
  selector: 'app-file-picture',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<div class="picture" [class.actual]="actual()">
    <img [src]="url()" [alt]="name()" draggable="false" (click)="actual.set(!actual())" (load)="drawn($event)" />
  </div>`,
  styleUrl: './file-picture.css',
})
export class FilePicture {
  readonly picture = input.required<Picture>();
  readonly name = input.required<string>();
  /** At natural size (scrolling) rather than fitted. */
  readonly actual = model(false);
  /** The size in pixels the picture drew at: an SVG's is known only once it is drawn. */
  readonly natural = output<{ readonly width: number; readonly height: number }>();

  /** One URL per picture, let go when another takes its place or the View closes. */
  protected readonly url = computed(() => URL.createObjectURL(new Blob([this.picture().bytes as Uint8Array<ArrayBuffer>], { type: this.picture().type })));

  constructor() {
    let last: string | undefined;
    effect(() => {
      const url = this.url();
      if (last !== undefined && last !== url) URL.revokeObjectURL(last);
      last = url;
    });
    inject(DestroyRef).onDestroy(() => {
      if (last !== undefined) URL.revokeObjectURL(last);
    });
  }

  protected drawn(event: Event): void {
    const img = event.target as HTMLImageElement;
    if (img.naturalWidth > 0 && img.naturalHeight > 0) this.natural.emit({ width: img.naturalWidth, height: img.naturalHeight });
  }
}
