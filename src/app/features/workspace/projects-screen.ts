import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { I18n } from '../../core/i18n';
import { WorkspaceLayoutState } from './workspace-layout';

/**
 * Projects: the list, the content of the selected project and the open session. The columns follow the
 * layout state; what goes inside them arrives with the next ticket, so each holds a placeholder.
 */
@Component({
  selector: 'app-projects-screen',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './projects-screen.html',
  styleUrl: './projects-screen.css',
})
export class ProjectsScreen {
  protected readonly i18n = inject(I18n);
  protected readonly layout = inject(WorkspaceLayoutState);
}
