import { ChangeDetectionStrategy, Component, inject, output } from '@angular/core';
import type { ProjectId } from '../../../shared/sessions/sessions.model';
import { I18n } from '../../core/i18n';
import { ButtonComponent } from '../../shared/ui/button/button';
import { ListRow } from '../../shared/ui/list-row/list-row';
import { StateComponent } from '../../shared/ui/state/state';
import { ProjectsState } from './projects-state';

/** The searchable list of projects, with the badge of live sessions and the way to add one. */
@Component({
  selector: 'app-project-list',
  imports: [ButtonComponent, ListRow, StateComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './project-list.html',
  styleUrl: './project-list.css',
})
export class ProjectList {
  protected readonly state = inject(ProjectsState);
  protected readonly i18n = inject(I18n);

  readonly opened = output<ProjectId>();
  readonly newProject = output<void>();
}
