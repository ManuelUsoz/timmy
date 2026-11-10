import { ChangeDetectionStrategy, Component, DestroyRef, inject } from '@angular/core';
import { Router, RouterOutlet } from '@angular/router';
import type { Project } from '../../../shared/projects/projects.model';
import { globalShortcut } from '../../core/shortcuts';
import { WindowModeState } from '../shell/window-mode-state';
import { FilesBrowser } from './files-browser';
import { FilesSidebar } from './files-sidebar';
import { NewProjectDialog } from './new-project-dialog';
import { ProjectsState } from './projects-state';
import { QuickLook } from './quick-look';
import { QuickLookState } from './quick-look-state';
import { SettingsDialog } from './settings-dialog';
import { SettingsDialogState } from './settings-dialog-state';
import { Switcher } from './switcher';
import { isCtrlTab } from './switcher-keys';
import { SwitcherState } from './switcher-state';
import { tabPath, terminalPath } from './tabs';
import { TabsState } from './tabs-state';
import { TerminalsState } from './terminals-state';
import { ToastHost } from './toast-host';
import { WorkspaceLayoutState } from './workspace-layout';
import { WorkspaceSidebar } from './workspace-sidebar';

/**
 * The Workspace shown in Expanded: the sidebar (Projects, Terminals, Settings), the routed screen beside it, and
 * Settings as a dialog over both. The global shortcuts (`shortcuts.ts`) work wherever the focus is, a Terminal included:
 * Ctrl+B collapses or expands the sidebar, Ctrl+, opens or closes Settings, Ctrl+T opens a New Tab and Ctrl+1–9 goes to
 * the selected Project's Tab with that number. Ctrl+Tab opens the Switcher (see `SwitcherState`).
 */
@Component({
  selector: 'app-workspace',
  imports: [FilesSidebar, NewProjectDialog, QuickLook, RouterOutlet, SettingsDialog, Switcher, ToastHost, WorkspaceSidebar],
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
  protected readonly switcher = inject(SwitcherState);
  protected readonly files = inject(FilesBrowser);
  protected readonly quickLook = inject(QuickLookState);
  private readonly windowMode = inject(WindowModeState);
  private readonly terminals = inject(TerminalsState);

  constructor() {
    // The first time the Workspace appears, navigation starts (it is disabled at bootstrap, see workspace.routes.ts).
    if (!this.router.navigated) this.router.initialNavigation();
    // Coming from the Panel, it opens on the Terminal the Panel showed: its Tab, its Pane, expanded in its Stack.
    // This navigation replaces the initial one, if that is still pending.
    const revealed = this.windowMode.previous() === 'Panel' ? this.terminals.current() : undefined;
    if (revealed !== undefined) void this.router.navigate(terminalPath(revealed));

    // Captured on the window, so a focused Terminal (whose xterm stops the event) does not swallow the shortcuts.
    const onKey = (event: KeyboardEvent) => this.shortcut(event);
    // Releasing Ctrl confirms the Switcher.
    const onKeyUp = (event: KeyboardEvent) => {
      if (this.switcher.model() !== undefined && this.switcher.key(event)) event.preventDefault();
    };
    // Ctrl released in another window never comes back here: leaving the window cancels a Switcher held open by Ctrl.
    const onBlur = () => {
      if (this.switcher.model()?.sticky === false) this.switcher.close();
    };
    window.addEventListener('keydown', onKey, { capture: true });
    window.addEventListener('keyup', onKeyUp, { capture: true });
    window.addEventListener('blur', onBlur);
    inject(DestroyRef).onDestroy(() => {
      window.removeEventListener('keydown', onKey, { capture: true });
      window.removeEventListener('keyup', onKeyUp, { capture: true });
      window.removeEventListener('blur', onBlur);
      this.switcher.close();
    });
  }

  private shortcut(event: KeyboardEvent): void {
    // The Switcher takes its keys first. It does not open over another dialog. While it is open no other shortcut acts,
    // and no key reaches the screen behind it: only its own search, once the user is in it.
    const switching = this.switcher.model() !== undefined;
    const forSwitcher = switching || (isCtrlTab(event) && document.querySelector('[aria-modal="true"]') === null);
    if (forSwitcher && this.switcher.key(event)) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (switching) {
      if (!(event.target instanceof Element && event.target.closest('app-switcher') !== null)) {
        event.preventDefault();
        event.stopPropagation();
      }
      return;
    }
    const shortcut = globalShortcut(event);
    if (shortcut === null) return;
    // The Tab shortcuts act on the screen behind a dialog (Settings, a confirmation), which the user cannot see: not then.
    if ((shortcut.id === 'newTab' || shortcut.id === 'goToTab' || shortcut.id === 'files') && document.querySelector('[aria-modal="true"]') !== null) return;
    event.preventDefault();
    event.stopPropagation();
    switch (shortcut.id) {
      case 'toggleSidebar':
        return this.layout.toggleSidebar();
      case 'toggleSettings':
        return this.settingsDialog.toggle();
      case 'newTab':
        return this.tabs.requestNewTab();
      case 'files':
        return this.files.openWithFilter();
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
