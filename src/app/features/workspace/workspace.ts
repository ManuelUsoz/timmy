import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { I18n } from '../../core/i18n';

/** The Workspace shown in Expanded: a rail of areas and the routed screen of the selected one. */
@Component({
  selector: 'app-workspace',
  imports: [RouterLink, RouterLinkActive, RouterOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './workspace.html',
  styleUrl: './workspace.css',
})
export class WorkspaceComponent {
  protected readonly i18n = inject(I18n);

  constructor() {
    // The first time the Workspace appears, navigation starts (it is disabled at bootstrap, see workspace.routes.ts).
    const router = inject(Router);
    if (!router.navigated) router.initialNavigation();
  }
}
