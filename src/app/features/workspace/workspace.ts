import { ChangeDetectionStrategy, Component, DestroyRef, inject } from '@angular/core';
import { Router, RouterOutlet } from '@angular/router';
import type { Project } from '../../../shared/projects/projects.model';
import { globalShortcut } from '../../core/shortcuts';
import { NewProjectDialog } from './new-project-dialog';
import { ProjectsState } from './projects-state';
import { SettingsDialog } from './settings-dialog';
import { SettingsDialogState } from './settings-dialog-state';
import { tabPath } from './tabs';
import { TabsState } from './tabs-state';
import { ToastHost } from './toast-host';
import { WorkspaceLayoutState } from './workspace-layout';
import { WorkspaceSidebar } from './workspace-sidebar';

/**
 * The Workspace shown in Expanded: the sidebar (Projects, Terminals, Settings), the routed screen beside it, and
 * Settings as a dialog over both. The global shortcuts (`shortcuts.ts`) work wherever the focus is, a Terminal included:
 * Ctrl+B collapses or expands the sidebar, Ctrl+, opens or closes Settings, Ctrl+T opens a New Tab and Ctrl+1–9 goes to
 * the selected Project's Tab with that number.
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
  private readonly tabs = inject(TabsState);

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
    // The Tab shortcuts act on the screen behind a dialog (Settings, a confirmation), which the user cannot see: not then.
    if ((shortcut.id === 'newTab' || shortcut.id === 'goToTab') && document.querySelector('[aria-modal="true"]') !== null) return;
    event.preventDefault();
    event.stopPropagation();
    switch (shortcut.id) {
      case 'toggleSidebar':
        return this.layout.toggleSidebar();
      case 'toggleSettings':
        return this.settingsDialog.toggle();
      case 'newTab':
        return this.tabs.requestNewTab();
      case 'goToTab':
        return void this.goToTab(shortcut.number);
    }
  }

  /** Ctrl+number: the selected Project's Tab with that number, if it has one. */
  private async goToTab(number: number): Promise<void> {
    const projectId = this.projects.selectedId();
    const tab = projectId === undefined ? undefined : this.tabs.tabsOf(projectId)[number - 1];
    if (tab !== undefined) await this.router.navigate(tabPath(tab, this.tabs.layoutOf(tab)));
  }

  protected async created(project: Project): Promise<void> {
    this.projects.creating.set(false);
    await this.projects.refresh();
    await this.router.navigate(['/projects', project.projectId]);
  }
}
