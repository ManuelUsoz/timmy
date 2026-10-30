import { ChangeDetectionStrategy, Component, booleanAttribute, inject, input, output } from '@angular/core';
import type { ProjectId } from '../../../shared/sessions/sessions.model';
import { I18n } from '../../core/i18n';
import { AvatarComponent } from '../../shared/ui/avatar/avatar';
import { ButtonComponent } from '../../shared/ui/button/button';
import { ListRow } from '../../shared/ui/list-row/list-row';
import { StateComponent } from '../../shared/ui/state/state';
import { ProjectsState } from './projects-state';

/**
 * The searchable list of projects, with the badge of live sessions and the way to add one. Collapsed, it is the
 * rail of avatars (one per project, with a dot for live sessions) and a button to add a project.
 */
@Component({
  selector: 'app-project-list',
  imports: [AvatarComponent, ButtonComponent, ListRow, StateComponent],
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
}
