import { ChangeDetectionStrategy, Component, ElementRef, booleanAttribute, computed, effect, inject, input, output, signal, viewChild } from '@angular/core';
import type { ProjectId } from '../../../shared/projects/projects.model';
import { I18n } from '../../core/i18n';
import { statusTone } from '../../shared/ui/mascot/mascot';
import { ListRow } from '../../shared/ui/list-row/list-row';
import { ModalComponent } from '../../shared/ui/modal/modal';
import { ProjectsState } from './projects-state';
import { closeNeedsConfirm } from './tabs';
import { TabsState } from './tabs-state';
import type { ProjectTally } from './workspace-sidebar-view';

/** The context menu of a project row, opened where the pointer was (or under the row, from the keyboard). */
interface ProjectMenu {
  readonly projectId: ProjectId;
  readonly x: number;
  readonly y: number;
}

/**
 * The Projects of the sidebar: one row per project with its avatar, its name and how many Terminals it has; the path
 * is only in the tooltip. Collapsed, it is the strip of avatars. A right click (or the context-menu key) on a project
 * opens its menu, from which it can be removed; that asks first only while one of its Terminals is Working or Waiting.
 */
@Component({
  selector: 'app-project-list',
  imports: [ListRow, ModalComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './project-list.html',
  styleUrl: './project-list.css',
  host: {
    '(document:click)': 'closeMenuOutside($event)',
    '(document:keydown.escape)': 'dismissMenu()',
    '(window:blur)': 'menu.set(undefined)',
    '(window:resize)': 'menu.set(undefined)',
  },
})
export class ProjectList {
  protected readonly state = inject(ProjectsState);
  protected readonly i18n = inject(I18n);
  private readonly tabs = inject(TabsState);

  readonly collapsed = input(false, { transform: booleanAttribute });
  /** How many Terminals each Project has, and the most urgent status among them. */
  readonly tallies = input<ReadonlyMap<ProjectId, ProjectTally>>(new Map());
  readonly opened = output<ProjectId>();
  /** The user removes this project (confirmed, when it had to be): the sidebar takes it out and closes its Terminals. */
  readonly removed = output<ProjectId>();

  protected readonly menu = signal<ProjectMenu | undefined>(undefined);
  protected readonly menuProject = computed(() => this.state.all().find((project) => project.projectId === this.menu()?.projectId));
  /** The project whose removal waits for the user. By id: the list may reload while the dialog is open. */
  private readonly confirmingId = signal<ProjectId | undefined>(undefined);
  protected readonly confirming = computed(() => this.state.all().find((project) => project.projectId === this.confirmingId()));
  private readonly menuElement = viewChild<ElementRef<HTMLElement>>('menu');
  /** The row the menu was opened on. */
  private opener: HTMLElement | undefined;

  constructor() {
    // The menu takes focus when it opens, so the keyboard can pick an item at once.
    effect(() => this.menuElement()?.nativeElement.querySelector<HTMLElement>('[role=menuitem]')?.focus());
  }

  /** What the avatar draws for a project: "T" for timmy, "AP" for an acronym such as API de pagos. */
  protected initials(name: string): string {
    const first = name.trim().split(/[\s._-]+/)[0] ?? '';
    const head = /^[A-Z]{2,}$/.test(first) ? first.slice(0, 2) : first.slice(0, 1);
    return head.toUpperCase();
  }

  protected tone(tally: ProjectTally): string {
    return `var(--support-${statusTone[tally.status]})`;
  }

  protected openMenu(event: MouseEvent, projectId: ProjectId): void {
    event.preventDefault();
    // From the keyboard (the context-menu key, Shift+F10) there is no pointer: the menu opens under the row.
    const fromKeyboard = event.clientX === 0 && event.clientY === 0;
    this.opener = event.currentTarget as HTMLElement;
    const row = this.opener.getBoundingClientRect();
    this.menu.set(fromKeyboard ? { projectId, x: row.left, y: row.bottom } : { projectId, x: event.clientX, y: event.clientY });
  }

  /** Esc closes the menu and gives focus back to the row it was opened on. */
  protected dismissMenu(): void {
    if (this.menu() === undefined) return;
    this.menu.set(undefined);
    this.opener?.focus();
  }

  protected closeMenuOutside(event: Event): void {
    const menu = this.menuElement()?.nativeElement;
    if (menu !== undefined && !menu.contains(event.target as Node)) this.menu.set(undefined);
  }

  protected askRemove(): void {
    const projectId = this.menu()?.projectId;
    this.menu.set(undefined);
    if (projectId === undefined) return;
    if (closeNeedsConfirm(this.tabs.projectStatuses(projectId))) this.confirmingId.set(projectId);
    else this.removed.emit(projectId);
  }

  protected confirmRemove(): void {
    const project = this.confirming();
    this.confirmingId.set(undefined);
    if (project !== undefined) this.removed.emit(project.projectId);
  }

  protected cancelRemove(): void {
    this.confirmingId.set(undefined);
  }
}
