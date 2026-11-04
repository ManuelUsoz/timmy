import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Schema } from 'effect';
import { I18n } from '../../core/i18n';
import { PanelTerminal } from './panel-terminal';
import { TerminalsState } from '../workspace/terminals-state';
import { WorkspaceComponent } from '../workspace/workspace';
import { AvatarComponent } from '../../shared/ui/avatar/avatar';
import { MenuComponent } from '../../shared/ui/menu/menu';
import { OptionComponent } from '../../shared/ui/menu/option';
import { PillComponent } from '../../shared/ui/pill/pill';
import { pillView } from './pill-view';
import { WindowMode } from '../../../shared/window/window.model';
import { WindowModeState } from './window-mode-state';

/** Picks the content for the current Window mode. Nothing here changes the mode on its own: only the switcher and double-clicks do. */
@Component({
  selector: 'app-shell',
  imports: [NgTemplateOutlet, PanelTerminal, WorkspaceComponent, PillComponent, AvatarComponent, MenuComponent, OptionComponent],
  templateUrl: './shell.html',
  styleUrl: './shell.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ShellComponent {
  protected readonly windowMode = inject(WindowModeState);
  protected readonly i18n = inject(I18n);
  private readonly terminals = inject(TerminalsState);
  protected readonly pill = computed(() => pillView(this.terminals.entries()));
  /** The Pill's state word and its sentence, translated here so the view model stays language-free. */
  protected readonly pillLabel = computed(() => this.i18n.t(({ Live: 'state.live', Idle: 'state.idle', Attention: 'activity.needsAttention' } as const)[this.pill().state]));
  protected readonly pillText = computed(() => {
    const { running, attention } = this.pill();
    if (attention > 0) return attention === 1 ? this.i18n.t('pill.attentionOne') : this.i18n.t('pill.attentionMany', { count: attention });
    if (running === 0) return this.i18n.t('pill.idle');
    return running === 1 ? this.i18n.t('pill.runningOne') : this.i18n.t('pill.runningMany', { count: running });
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
