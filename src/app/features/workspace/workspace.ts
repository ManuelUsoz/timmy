import { ChangeDetectionStrategy, Component, DestroyRef, inject } from '@angular/core';
import { Router, RouterOutlet } from '@angular/router';
import type { Project } from '../../../shared/projects/projects.model';
import { globalShortcut } from '../../core/shortcuts';
import { NewProjectDialog } from './new-project-dialog';
import { ProjectsState } from './projects-state';
import { SettingsDialog } from './settings-dialog';
import { SettingsDialogState } from './settings-dialog-state';
import { ToastHost } from './toast-host';
import { WorkspaceLayoutState } from './workspace-layout';
import { WorkspaceSidebar } from './workspace-sidebar';

/**
 * The Workspace shown in Expanded: the sidebar (Projects, Terminals, Settings), the routed screen beside it, and
 * Settings as a dialog over both. The global shortcuts (`shortcuts.ts`) work wherever the focus is, a Terminal included:
 * Ctrl+B collapses or expands the sidebar and Ctrl+, opens or closes Settings.
 */
@Component({
  selector: 'app-workspace',
  imports: [NewProjectDialog, RouterOutlet, SettingsDialog, ToastHost, WorkspaceSidebar],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './workspace.html',
  styleUrl: './workspace.css',
})
export class WorkspaceComponent {
  protected readonly projects = inject(ProjectsState);
  private readonly layout = inject(WorkspaceLayoutState);
  protected readonly settingsDialog = inject(SettingsDialogState);
  private readonly router = inject(Router);

  constructor() {
    // The first time the Workspace appears, navigation starts (it is disabled at bootstrap, see workspace.routes.ts).
    if (!this.router.navigated) this.router.initialNavigation();

    // Captured on the window, so a focused Terminal (whose xterm stops the event) does not swallow the shortcuts.
    const onKey = (event: KeyboardEvent) => this.shortcut(event);
    window.addEventListener('keydown', onKey, { capture: true });
    inject(DestroyRef).onDestroy(() => window.removeEventListener('keydown', onKey, { capture: true }));
  }

  private shortcut(event: KeyboardEvent): void {
    const shortcut = globalShortcut(event);
    if (shortcut === null) return;
    event.preventDefault();
    event.stopPropagation();
    if (shortcut === 'toggleSidebar') this.layout.toggleSidebar();
    else this.settingsDialog.toggle();
  }

  protected async created(project: Project): Promise<void> {
    this.projects.creating.set(false);
    await this.projects.refresh();
    await this.router.navigate(['/projects', project.projectId]);
  }
}
