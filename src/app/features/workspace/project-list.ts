import { ChangeDetectionStrategy, Component, booleanAttribute, inject, input, output } from '@angular/core';
import type { ProjectId } from '../../../shared/projects/projects.model';
import { I18n } from '../../core/i18n';
import { statusTone } from '../../shared/ui/mascot/mascot';
import { ListRow } from '../../shared/ui/list-row/list-row';
import { ProjectsState } from './projects-state';
import type { ProjectTally } from './workspace-sidebar-view';

/**
 * The Projects of the sidebar: one row per project with its avatar, its name and how many Terminals it has; the path
 * is only in the tooltip. Collapsed, it is the strip of avatars.
 */
@Component({
  selector: 'app-project-list',
  imports: [ListRow],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './project-list.html',
  styleUrl: './project-list.css',
})
export class ProjectList {
  protected readonly state = inject(ProjectsState);
  protected readonly i18n = inject(I18n);

  readonly collapsed = input(false, { transform: booleanAttribute });
  /** How many Terminals each Project has, and the most urgent status among them. */
  readonly tallies = input<ReadonlyMap<ProjectId, ProjectTally>>(new Map());
  readonly opened = output<ProjectId>();

  /** What the avatar draws for a project: "T" for timmy, "AP" for an acronym such as API de pagos. */
  protected initials(name: string): string {
    const first = name.trim().split(/[\s._-]+/)[0] ?? '';
    const head = /^[A-Z]{2,}$/.test(first) ? first.slice(0, 2) : first.slice(0, 1);
    return head.toUpperCase();
  }

  protected tone(tally: ProjectTally): string {
    return `var(--support-${statusTone[tally.status]})`;
  }
}
