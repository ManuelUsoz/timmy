import { ChangeDetectionStrategy, Component, booleanAttribute, inject, input, output } from '@angular/core';
import type { ProjectId } from '../../../shared/sessions/sessions.model';
import { I18n } from '../../core/i18n';
import { ButtonComponent } from '../../shared/ui/button/button';
import { ListRow } from '../../shared/ui/list-row/list-row';
import { ProjectsState } from './projects-state';

/**
 * The searchable list of projects and the way to add one. Collapsed, it is the rail of avatars (one per
 * project) and a button to add a project.
 */
@Component({
  selector: 'app-project-list',
  imports: [ButtonComponent, ListRow],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './project-list.html',
  styleUrl: './project-list.css',
})
export class ProjectList {
  protected readonly state = inject(ProjectsState);
  protected readonly i18n = inject(I18n);

  readonly collapsed = input(false, { transform: booleanAttribute });
  readonly opened = output<ProjectId>();
  readonly newProject = output<void>();

  /** What the collapsed rail draws for a project: "T" for timmy, "AP" for an acronym such as API de pagos. */
  protected initials(name: string): string {
    const first = name.trim().split(/[\s._-]+/)[0] ?? '';
    const head = /^[A-Z]{2,}$/.test(first) ? first.slice(0, 2) : first.slice(0, 1);
    return head.toUpperCase();
  }
}
