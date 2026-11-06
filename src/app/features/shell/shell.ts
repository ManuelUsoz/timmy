import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Schema } from 'effect';
import { I18n } from '../../core/i18n';
import { NotificationsState } from './notifications-state';
import { PanelTerminal } from './panel-terminal';
import { ToastHost } from '../workspace/toast-host';
import { WorkspaceComponent } from '../workspace/workspace';
import { MascotComponent } from '../../shared/ui/mascot/mascot';
import { MenuComponent } from '../../shared/ui/menu/menu';
import { OptionComponent } from '../../shared/ui/menu/option';
import { PillComponent } from '../../shared/ui/pill/pill';
import { pillView, statusWordKey } from './pill-view';
import { WindowMode } from '../../../shared/window/window.model';
import { WindowModeState } from './window-mode-state';

/** Picks the content for the current Window mode. Nothing here changes the mode on its own: only the switcher and double-clicks do. */
@Component({
  selector: 'app-shell',
  imports: [NgTemplateOutlet, PanelTerminal, ToastHost, WorkspaceComponent, PillComponent, MascotComponent, MenuComponent, OptionComponent],
  templateUrl: './shell.html',
  styleUrl: './shell.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ShellComponent {
  protected readonly windowMode = inject(WindowModeState);
  protected readonly i18n = inject(I18n);
  private readonly notifications = inject(NotificationsState);
  protected readonly pill = computed(() => pillView(this.notifications.notifications()));
  /** The Pill's state word and its sentence, translated here so the view model stays language-free. */
  protected readonly pillLabel = computed(() =>
    this.i18n.t(statusWordKey[this.pill().status]),
  );
  protected readonly pillText = computed(() => {
    const { status, count } = this.pill();
    if (status === 'Idle') return this.i18n.t('pill.idle');
    const one = { Working: 'pill.runningOne', Waiting: 'pill.attentionOne', Done: 'pill.doneOne', Error: 'pill.errorOne' } as const;
    const many = { Working: 'pill.runningMany', Waiting: 'pill.attentionMany', Done: 'pill.doneMany', Error: 'pill.errorMany' } as const;
    return count === 1 ? this.i18n.t(one[status]) : this.i18n.t(many[status], { count });
  });
  protected readonly switcherOpen = signal(false);

  /** The Pill window is one row tall and would clip the menu, so there the button goes straight to the Panel. */
  protected toggleSwitcher(): void {
    if (this.windowMode.mode() === 'Pill') this.request('Panel');
    else this.switcherOpen.update((open) => !open);
  }

  protected pick(value: unknown): void {
    if (Schema.is(WindowMode)(value)) this.request(value);
  }

  protected close(): void {
    this.windowMode.close();
  }

  /** The empty stretch of the Expanded title bar maximizes or restores on double-click, as a system title bar does. */
  protected toggleMaximize(): void {
    this.windowMode.toggleMaximize();
  }

  protected request(mode: WindowMode): void {
    this.switcherOpen.set(false);
    this.windowMode.request(mode);
  }
}
