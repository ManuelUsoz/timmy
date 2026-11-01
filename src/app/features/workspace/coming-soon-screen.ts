import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { I18n } from '../../core/i18n';
import type { MessageKey } from '../../core/i18n-dictionaries';

/** Placeholder for the areas that do not exist yet (Chat, History). The route's `title` data names the area. */
@Component({
  selector: 'app-coming-soon-screen',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="coming-soon">
      <h1>{{ i18n.t(title()) }}</h1>
      <p class="badge">{{ i18n.t('workspace.comingSoon') }}</p>
      <p class="detail">{{ i18n.t('workspace.comingSoonDetail') }}</p>
    </section>
  `,
  styles: `
    :host {
      display: block;
      height: 100%;
    }
    .coming-soon {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: var(--spacing-03);
      padding: var(--spacing-07);
    }
    h1 {
      margin: 0;
      font: var(--text-heading-03);
    }
    .badge {
      margin: 0;
      padding: var(--spacing-01) var(--spacing-03);
      border-radius: var(--radius-tag);
      background: var(--tag-gray-bg);
      color: var(--tag-gray-text);
      font: var(--text-label-01);
    }
    .detail {
      margin: 0;
      color: var(--text-secondary);
    }
  `,
})
export class ComingSoonScreen {
  protected readonly i18n = inject(I18n);
  readonly title = input.required<MessageKey>();
}
