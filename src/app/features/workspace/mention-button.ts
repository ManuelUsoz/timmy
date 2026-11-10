import { ChangeDetectionStrategy, Component, ElementRef, afterNextRender, computed, inject, input, Injector, signal } from '@angular/core';
import { I18n } from '../../core/i18n';
import type { LineSelection } from './line-selection';
import { Mentions, type MentionTarget } from './mention';
import { statusKey } from './terminal-view';

/**
 * Mencionar (GLOSSARY: Mention) of a File View, in its header (the whole file, or its Line selection) and in the Line
 * selection's popover: a button that types the Mention into the default Terminal (the last focused agent of the Project
 * that is not Waiting), and beside it the picker of every agent of the Project that could take one, each as
 * `name · #n · Project · status`. A Waiting one is listed but disabled. With no agent it is disabled and says why; it
 * never opens a Terminal.
 */
@Component({
  selector: 'app-mention',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'mention',
    '[class.popover]': "place() === 'popover'",
    '(document:click)': 'closeOutside($event)',
  },
  styleUrl: './mention-button.css',
  template: `
    @let target = chosen();
    <button
      type="button"
      class="mention-go"
      [disabled]="target === undefined"
      [attr.aria-label]="target === undefined ? i18n.t('mention.mention') : i18n.t('mention.into', { name: target.entry.name, number: target.entry.number })"
      [attr.title]="hint()"
      (click)="go()"
    >
      <svg class="icon" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="2.5" /><path d="M10.5 8v1a2 2 0 004 0V8a6.5 6.5 0 10-2.5 5.1" /></svg>
      <span class="label">{{ place() === 'popover' && target !== undefined ? i18n.t('mention.into', { name: target.entry.name, number: target.entry.number }) : i18n.t('mention.mention') }}</span>
    </button>
    <button
      type="button"
      class="mention-pick"
      aria-haspopup="menu"
      [attr.aria-expanded]="open()"
      [attr.aria-label]="i18n.t('mention.choose')"
      [attr.title]="targets().length === 0 ? hint() : i18n.t('mention.choose')"
      [disabled]="targets().length === 0"
      (click)="toggle()"
    >
      <svg class="icon" viewBox="0 0 16 16" aria-hidden="true"><path d="M4 6l4 4 4-4" /></svg>
    </button>
    @if (open()) {
      <div class="mention-menu" role="menu" [attr.aria-label]="i18n.t('mention.picker')" (keydown)="key($event)">
        @for (each of targets(); track each.entry.id) {
          <button
            type="button"
            role="menuitem"
            class="mention-row"
            [class.default]="each.entry.id === target?.entry?.id"
            [disabled]="each.waiting"
            [attr.data-id]="each.entry.id"
            (click)="pick(each)"
          >
            <span class="row-name">{{ each.entry.name }}</span>
            <span class="sep">&nbsp;·&nbsp;</span>
            <span class="row-number">#{{ each.entry.number }}</span>
            <span class="sep">&nbsp;·&nbsp;</span>
            <span class="row-project">{{ projectName() }}</span>
            <span class="sep">&nbsp;·&nbsp;</span>
            <span class="row-status">{{ each.waiting ? i18n.t('mention.waiting') : i18n.t(status[each.status]) }}</span>
          </button>
        }
      </div>
    }
  `,
})
export class MentionButton {
  protected readonly i18n = inject(I18n);
  protected readonly status = statusKey;
  private readonly mentions = inject(Mentions);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);

  /** The Tab of the File View: its Project's agents are the ones offered. */
  readonly tabId = input.required<string>();
  /** The file, relative to the Project with `/`. */
  readonly path = input.required<string>();
  /** The Line selection to mention; the whole file without one. */
  readonly lines = input<LineSelection>();
  /** In the header the button says "Mencionar"; in the popover it names the agent it types into. */
  readonly place = input<'header' | 'popover'>('header');

  protected readonly open = signal(false);
  private readonly projectId = computed(() => this.mentions.projectOfTab(this.tabId()));
  protected readonly targets = computed((): ReadonlyArray<MentionTarget> => {
    const projectId = this.projectId();
    return projectId === undefined ? [] : this.mentions.targetsOf(projectId);
  });
  protected readonly chosen = computed(() => {
    const projectId = this.projectId();
    return projectId === undefined ? undefined : this.mentions.defaultOf(projectId);
  });
  protected readonly projectName = computed(() => {
    const projectId = this.projectId();
    return projectId === undefined ? '' : this.mentions.projectName(projectId);
  });

  /** What the button would do, or why it cannot. */
  protected readonly hint = computed(() => {
    const target = this.chosen();
    if (target !== undefined) return this.i18n.t('mention.hint', { name: target.entry.name, number: target.entry.number });
    return this.targets().length === 0 ? this.i18n.t('mention.none') : this.i18n.t('mention.allWaiting');
  });

  protected go(): void {
    const target = this.chosen();
    if (target !== undefined) void this.send(target);
  }

  protected pick(target: MentionTarget): void {
    this.open.set(false);
    void this.send(target);
  }

  private async send(target: MentionTarget): Promise<void> {
    const projectId = this.projectId();
    if (projectId !== undefined) await this.mentions.mention(projectId, target.entry.id, this.path(), this.lines());
  }

  /** Opens the picker on the default agent, so Enter mentions there and the arrows move to another. */
  protected toggle(): void {
    this.open.update((open) => !open);
    if (!this.open()) return;
    afterNextRender(() => (this.rows().find((row) => row.classList.contains('default')) ?? this.rows().find((row) => !row.disabled))?.focus(), { injector: this.injector });
  }

  private rows(): ReadonlyArray<HTMLButtonElement> {
    return Array.from(this.host.nativeElement.querySelectorAll<HTMLButtonElement>('.mention-row'));
  }

  /** Up and Down walk the agents that can take it; Esc closes the picker and gives the keyboard back to its button. */
  protected key(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.stopPropagation();
      this.open.set(false);
      this.host.nativeElement.querySelector<HTMLButtonElement>('.mention-pick')?.focus();
      return;
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    const rows = this.rows().filter((row) => !row.disabled);
    const at = rows.findIndex((row) => row === document.activeElement);
    const next = event.key === 'ArrowDown' ? Math.min(at + 1, rows.length - 1) : Math.max(at - 1, 0);
    rows[next]?.focus();
  }

  protected closeOutside(event: Event): void {
    if (!this.host.nativeElement.contains(event.target as Node)) this.open.set(false);
  }
}
