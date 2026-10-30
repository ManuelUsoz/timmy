import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/** The centred message that fills the main area when there is no project or session to show. */
@Component({
  selector: 'app-workspace-hero',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="hero">
      @switch (icon()) {
        @case ('chat') {
          <svg class="icon" viewBox="0 0 16 16" aria-hidden="true"><path d="M2 3h12v8H7l-3 2.5V11H2z" /></svg>
        }
        @case ('folder-error') {
          <svg class="icon error" viewBox="0 0 16 16" aria-hidden="true">
            <path d="M2 4.5a1 1 0 0 1 1-1h3l1.5 1.5H13a1 1 0 0 1 1 1V12a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1zM6.5 7.5l3 3M9.5 7.5l-3 3" />
          </svg>
        }
        @default {
          <svg class="icon" viewBox="0 0 16 16" aria-hidden="true">
            <path d="M2 4.5a1 1 0 0 1 1-1h3l1.5 1.5H13a1 1 0 0 1 1 1V12a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1z" />
          </svg>
        }
      }
      <h2>{{ title() }}</h2>
      <p>{{ detail() }}</p>
      <ng-content />
    </div>
  `,
  styles: `
    :host {
      display: flex;
      flex: 1;
      min-width: 0;
      height: 100%;
      align-items: center;
      justify-content: center;
    }
    .hero {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: var(--spacing-04);
      max-width: 480px;
      padding: var(--spacing-07);
    }
    .icon {
      width: 32px;
      height: 32px;
      fill: none;
      stroke: var(--text-helper);
      stroke-width: 1.2;
      stroke-linecap: round;
      stroke-linejoin: round;
    }
    .icon.error {
      stroke: var(--support-error);
    }
    h2 {
      margin: 0;
      font: var(--text-heading-04);
      letter-spacing: 0;
    }
    p {
      margin: 0;
      font: var(--text-body-02);
      color: var(--text-secondary);
    }
  `,
})
export class WorkspaceHero {
  readonly icon = input<'folder' | 'chat' | 'folder-error'>('folder');
  readonly title = input.required<string>();
  readonly detail = input.required<string>();
}
